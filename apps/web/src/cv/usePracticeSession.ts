import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionValidator } from '@enlaza/cv-model';
import type { ClassifyResult, HandFrame, SignTemplate, SignType } from '@enlaza/cv-model';
import { createDetector } from './detector';

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

function drawOverlay(canvas: HTMLCanvasElement, frame: HandFrame | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;

  const px = (x: number) => x * canvas.width;
  const py = (y: number) => y * canvas.height;

  ctx.strokeStyle = 'rgba(147, 182, 239, 0.85)';
  ctx.lineWidth = 3;
  for (const [a, b] of CONNECTIONS) {
    const pa = frame.landmarks[a];
    const pb = frame.landmarks[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(px(pa.x), py(pa.y));
    ctx.lineTo(px(pb.x), py(pb.y));
    ctx.stroke();
  }
  ctx.fillStyle = '#7FD3AE';
  for (const p of frame.landmarks) {
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

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

  const onFrame = useCallback(
    (validator: SessionValidator) => (frame: HandFrame | null) => {
      if (canvasRef.current) drawOverlay(canvasRef.current, frame);
      const verdict = frame ? validator.feed(frame) : validator.feedEmpty();
      setStatus(verdict.status);
      setBest(verdict.best);
      if (verdict.status === 'correct' && verdict.best) {
        setFinalScore(verdict.best.score);
      }
    },
    [],
  );

  useEffect(() => {
    if (!sign) return;

    const validator = new SessionValidator(sign.id, sign.type, templates);
    setHasTemplate(validator.hasTemplates());
    setStatus('waiting');
    setBest(null);
    setFinalScore(null);
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
      detector.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // `sign` is intentionally keyed by id/type only: the caller recreates the
    // object every render and we must not restart the camera on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sign?.id, sign?.type, templates, onFrame]);

  return { cameraState, cameraError, status, best, hasTemplate, videoRef, canvasRef, finalScore };
}
