import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionValidator, dynamicFeedback } from '@enlaza/cv-model';
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
  best: ClassifyResult | null;
  hasTemplate: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Confirmed score when status === 'correct'. */
  finalScore: number | null;
  /**
   * Seña dinámica que aún no valida: el mejor intento reciente de la seña
   * buscada, con su desglose, y qué corregir (D40). null si no hay intento.
   */
  attempt: { result: ClassifyResult; feedback: DynamicFeedback } | null;
  /**
   * Vuelve a empezar la seña con la cámara ya abierta: limpia la validación
   * (incluida la ventana de frames de las dinámicas) para intentarla de nuevo.
   */
  retry: () => void;
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
  const [best, setBest] = useState<ClassifyResult | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [attempt, setAttempt] = useState<PracticeSession['attempt']>(null);
  const validatorRef = useRef<SessionValidator | null>(null);
  /** Resultados recientes de la seña buscada, para la indicación de qué corregir. */
  const recentTargets = useRef<{ t: number; result: ClassifyResult }[]>([]);

  const retry = useCallback(() => {
    validatorRef.current?.reset();
    recentTargets.current = [];
    setStatus('waiting');
    setBest(null);
    setFinalScore(null);
    setAttempt(null);
  }, []);

  const onFrame = useCallback(
    (validator: SessionValidator) => (frame: HandsFrame | null) => {
      // Solo se valida la mano que hace la seña, no la de apoyo (D38).
      const verdict = validator.feedHands(frame);
      if (canvasRef.current) drawOverlay(canvasRef.current, frame, verdict.hand?.landmarks ?? null);
      setStatus(verdict.status);
      setBest(verdict.best);
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
    setBest(null);
    setFinalScore(null);
    setAttempt(null);
    recentTargets.current = [];
    setCameraState('starting');
    setCameraError(null);

    const detector = createDetector();
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function boot() {
      const video = videoRef.current;
      if (!video) return;
      try {
        if (detector.needsCamera) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
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
        const validator = new SessionValidator(
          signId,
          signType,
          migrated.length > 0 ? mergeTemplates(templates, migrated) : templates,
        );
        validatorRef.current = validator;
        setHasTemplate(validator.hasTemplates());
        await detector.start(video, onFrame(validator));
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
    best,
    hasTemplate,
    videoRef,
    canvasRef,
    finalScore,
    attempt,
    retry,
  };
}
