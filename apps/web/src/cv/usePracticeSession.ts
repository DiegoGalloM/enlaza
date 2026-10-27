import { useCallback, useEffect, useRef, useState } from 'react';
import { FeedbackGate, SessionValidator, dynamicFeedback, feedbackGraceMs } from '@enlaza/cv-model';
import type {
  ClassifyResult,
  DynamicFeedback,
  HandsFrame,
  Landmark,
  SignTemplate,
  SignType,
} from '@enlaza/cv-model';
import { cameraAspect, createDetector } from './detector';
import { legacyTemplateIds, mergeTemplates, migrateLegacyTemplates } from './templates';

export type CameraState = 'starting' | 'ready' | 'error';
export type PracticeStatus = 'waiting' | 'tracking' | 'correct' | 'retry';

interface PracticeSession {
  cameraState: CameraState;
  cameraError: string | null;
  status: PracticeStatus;
  hasTemplate: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Confirmed score when status === 'correct'. */
  finalScore: number | null;
  /**
   * Proporción (ancho/alto) de la imagen de la cámara, para que el recuadro
   * la muestre entera y el esqueleto dibujado calce con la mano (D47). Un
   * celular en vertical suele dar 3:4; una laptop, 16:9.
   */
  aspect: number;
  /**
   * Seña dinámica que aún no valida: el mejor intento reciente de la seña
   * buscada, con su desglose, y qué corregir (D40). null si no hay intento.
   */
  attempt: { result: ClassifyResult; feedback: DynamicFeedback } | null;
  /**
   * Ya pasó el tiempo de gracia de intento (D46): recién ahora la práctica
   * dice que la seña aún no sale. Antes, solo acompaña.
   */
  feedbackOpen: boolean;
  /** Otra seña que se reconoció hace poco, para nombrarla en el aviso (D46). */
  identifiedSignId: string | null;
  /**
   * Vuelve a empezar la seña con la cámara ya abierta: limpia la validación
   * (incluida la ventana de frames de las dinámicas) para intentarla de nuevo.
   */
  retry: () => void;
  /**
   * Descarga los últimos segundos de landmarks (sin imagen) como JSON, para
   * reproducir el intento con tools/content/replay-attempt.mjs (D45). Solo se
   * ofrece con ?detalle=1, y el archivo queda en el equipo de quien lo baja.
   */
  downloadAttempt: () => void;
}

/** Milisegundos de landmarks que se guardan para descargar un intento. */
const RECORDING_MS = 10000;

/** Frame tal como lo entrega el detector, para reproducirlo fuera de la app. */
interface RecordedFrame {
  t: number;
  hands: HandsFrame['hands'];
  aspect?: number;
  face?: HandsFrame['face'];
}

/** MediaPipe hand skeleton (pairs of landmark indices). */
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function drawHand(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  landmarks: Landmark[],
  colors: { bone: string; joint: string },
): void {
  const px = (x: number) => x * canvas.width;
  const py = (y: number) => y * canvas.height;

  ctx.strokeStyle = colors.bone;
  ctx.lineWidth = 3;
  for (const [a, b] of CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(px(pa.x), py(pa.y));
    ctx.lineTo(px(pb.x), py(pb.y));
    ctx.stroke();
  }
  ctx.fillStyle = colors.joint;
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Dibuja las manos detectadas: en color la que se está validando y tenue la
 * otra (la de apoyo en señas de dos manos, D38), para que se vea cuál se lee.
 */
function drawOverlay(
  canvas: HTMLCanvasElement,
  frame: HandsFrame | null,
  tracked: Landmark[] | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;
  for (const hand of frame.hands) {
    if (hand.landmarks === tracked) continue;
    drawHand(ctx, canvas, hand.landmarks, {
      bone: 'rgba(200, 200, 200, 0.35)',
      joint: 'rgba(200, 200, 200, 0.5)',
    });
  }
  if (tracked) {
    drawHand(ctx, canvas, tracked, { bone: 'rgba(147, 182, 239, 0.85)', joint: '#7FD3AE' });
  }
}

/** Proporción mientras la cámara no abre: la que se le pide en una laptop. */
const DEFAULT_ASPECT = 16 / 9;

/** Lado mayor del lienzo del esqueleto: más no se ve mejor y cuesta más dibujar. */
const OVERLAY_MAX_SIDE = 960;

/**
 * Lo que se le pide a la cámara. En un celular en vertical se pide una imagen
 * vertical (3:4), que encuadra cabeza, pecho y manos sin desperdiciar los
 * lados; las features no dependen de la proporción (D33). Son valores
 * "ideal": la cámara entrega lo más cercano que tenga.
 */
function cameraConstraints(): MediaTrackConstraints {
  const portrait =
    typeof window !== 'undefined' && window.matchMedia?.('(orientation: portrait)').matches;
  return portrait
    ? { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 }, aspectRatio: { ideal: 3 / 4 } }
    : { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } };
}

/** El lienzo del esqueleto toma la proporción de la cámara (para que calce con la mano). */
function sizeOverlay(canvas: HTMLCanvasElement | null, aspect: number): void {
  if (!canvas) return;
  const width = aspect >= 1 ? OVERLAY_MAX_SIDE : Math.round(OVERLAY_MAX_SIDE * aspect);
  const height = aspect >= 1 ? Math.round(OVERLAY_MAX_SIDE / aspect) : OVERLAY_MAX_SIDE;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** Tiempo durante el que se considera "reciente" un intento para la indicación, en ms. */
const FEEDBACK_WINDOW_MS = 2500;

export function usePracticeSession(
  sign: { id: string; type: SignType } | null,
  templates: SignTemplate[],
): PracticeSession {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [status, setStatus] = useState<PracticeStatus>('waiting');
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [attempt, setAttempt] = useState<PracticeSession['attempt']>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [identifiedSignId, setIdentifiedSignId] = useState<string | null>(null);
  const validatorRef = useRef<SessionValidator | null>(null);
  const gateRef = useRef<FeedbackGate | null>(null);
  /** Resultados recientes de la seña buscada, para la indicación de qué corregir. */
  const recentTargets = useRef<{ t: number; result: ClassifyResult }[]>([]);
  /** Últimos RECORDING_MS de frames del detector, para downloadAttempt. */
  const recording = useRef<RecordedFrame[]>([]);
  const signIdRef = useRef<string | null>(null);
  signIdRef.current = sign?.id ?? null;

  const downloadAttempt = useCallback(() => {
    const payload = {
      kind: 'enlaza-intento',
      signId: signIdRef.current,
      recordedAt: new Date().toISOString(),
      frames: recording.current,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `intento-${signIdRef.current ?? 'sena'}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const retry = useCallback(() => {
    validatorRef.current?.reset();
    gateRef.current?.reset();
    recentTargets.current = [];
    setStatus('waiting');
    setFinalScore(null);
    setAttempt(null);
    setFeedbackOpen(false);
    setIdentifiedSignId(null);
  }, []);

  const onFrame = useCallback(
    (validator: SessionValidator, gate: FeedbackGate) => (frame: HandsFrame | null) => {
      const t = frame?.timestampMs ?? performance.now();
      // Se agrega al final y se descarta lo viejo del principio: sin copiar
      // la lista entera en cada cuadro (D49).
      const recorded = recording.current;
      recorded.push(
        frame
          ? { t, hands: frame.hands, aspect: frame.aspect, ...(frame.face ? { face: frame.face } : {}) }
          : { t, hands: [] },
      );
      let stale = 0;
      while (stale < recorded.length && t - recorded[stale]!.t > RECORDING_MS) stale++;
      if (stale > 0) recorded.splice(0, stale);
      // Solo se valida la mano que hace la seña, no la de apoyo (D38).
      const verdict = validator.feedHands(frame);
      if (canvasRef.current) drawOverlay(canvasRef.current, frame, verdict.hand?.landmarks ?? null);
      const gateState = gate.feed(t, verdict.hand !== null, verdict);
      setFeedbackOpen(gateState.open);
      setIdentifiedSignId(gateState.identifiedSignId);
      // Solo estados que cambian poco: React no vuelve a dibujar la página
      // en cada cuadro si el valor es el mismo (D49).
      setStatus(verdict.status);
      if (verdict.status === 'correct' && verdict.best) {
        setFinalScore(verdict.best.score);
        setAttempt(null);
      } else if (verdict.target?.detail && frame) {
        // El mejor intento de los últimos segundos: una comparación suelta a
        // media seña no dice nada útil.
        const now = frame.timestampMs;
        const recent = recentTargets.current.filter((r) => now - r.t <= FEEDBACK_WINDOW_MS);
        recent.push({ t: now, result: verdict.target });
        recentTargets.current = recent;
        const top = recent.reduce((a, b) => (b.result.score > a.result.score ? b : a)).result;
        setAttempt((prev) =>
          prev?.result === top ? prev : { result: top, feedback: dynamicFeedback(top.detail!) },
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!sign) return;
    const { id: signId, type: signType } = sign;

    // Mientras abre la cámara: una plantilla v1 pendiente de migrar también cuenta.
    setHasTemplate(
      templates.some((t) => t.signId === signId) || legacyTemplateIds().has(signId),
    );
    setStatus('waiting');
    setFinalScore(null);
    setAttempt(null);
    setFeedbackOpen(false);
    setIdentifiedSignId(null);
    recentTargets.current = [];
    recording.current = [];
    setCameraState('starting');
    setCameraError(null);

    const detector = createDetector();
    const videoEl = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function boot() {
      const video = videoRef.current;
      if (!video) return;
      try {
        if (detector.needsCamera) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: cameraConstraints(),
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
          await video.play();
        }
        // Con la cámara abierta ya se conoce su proporción: las plantillas
        // grabadas antes de corregirla se migran aquí, una sola vez.
        const aspect = cameraAspect(video, detector);
        const migrated = aspect ? migrateLegacyTemplates(aspect) : [];
        if (cancelled) return;
        if (aspect) {
          setAspect(aspect);
          sizeOverlay(canvasRef.current, aspect);
        }
        // Al girar el celular la cámara cambia de proporción a media práctica.
        video.onresize = () => {
          const current = cameraAspect(video, detector);
          if (!current) return;
          setAspect(current);
          sizeOverlay(canvasRef.current, current);
        };
        const validator = new SessionValidator(
          signId,
          signType,
          migrated.length > 0 ? mergeTemplates(templates, migrated) : templates,
        );
        validatorRef.current = validator;
        const gate = new FeedbackGate(feedbackGraceMs(signType, validator.windowMs));
        gateRef.current = gate;
        setHasTemplate(validator.hasTemplates());
        await detector.start(video, onFrame(validator, gate));
        if (!cancelled) setCameraState('ready');
      } catch (err) {
        if (!cancelled) {
          setCameraState('error');
          setCameraError(
            err instanceof Error && err.name === 'NotAllowedError'
              ? 'Necesitamos acceso a tu cámara para validar la seña. Revisa los permisos del navegador.'
              : 'No pudimos iniciar la cámara o el detector de manos.',
          );
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      validatorRef.current = null;
      gateRef.current = null;
      if (videoEl) videoEl.onresize = null;
      detector.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // `sign` is intentionally keyed by id/type only: the caller recreates the
    // object every render and we must not restart the camera on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sign?.id, sign?.type, templates, onFrame]);

  return {
    cameraState,
    cameraError,
    status,
    hasTemplate,
    videoRef,
    canvasRef,
    finalScore,
    aspect,
    attempt,
    feedbackOpen,
    identifiedSignId,
    retry,
    downloadAttempt,
  };
}
