import { useEffect, useRef, useState } from 'react';
import type { AvatarScene } from './scene';
import { createAvatarScene } from './scene';
import type { LandmarksFile } from './retarget';
import { createSignPlayer } from './retarget';
import { signAnimationFor } from './animations';
import styles from './SignAvatar.module.css';

interface Props {
  signId: string;
  /** Multiplicador de velocidad: <1 reproduce más lento (cámara lenta). */
  speed?: number;
  /** Vista de espejo: voltea la imagen para que el usuario pueda copiar de frente. */
  mirrored?: boolean;
  /**
   * Congela la seña en este instante (segundos dentro del ciclo). Solo para
   * revisión cuadro por cuadro en /avatar-poc; el pelo sigue simulándose.
   */
  freezeAt?: number;
}

/**
 * Avatar 3D reproduciendo una seña en bucle.
 *
 * El movimiento sale de los landmarks extraídos del video de referencia de
 * ICAL y se retargetea a un modelo humanoide genérico (ver retarget.ts). Es
 * una aproximación con límites anatómicos, no una captura fiel de la
 * configuración manual, y NO debe presentarse como referencia validada — la
 * lección ya muestra el aviso de contenido provisional.
 */
export function SignAvatar({ signId, speed = 1, mirrored = false, freezeAt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speed);
  const freezeRef = useRef(freezeAt);
  const [status, setStatus] = useState<'cargando' | 'listo' | 'error'>('cargando');

  // La velocidad se lee dentro del loop de animación, que no se reinicia al
  // cambiarla: así el cambio a cámara lenta no reinicia la seña.
  speedRef.current = speed;
  freezeRef.current = freezeAt;

  useEffect(() => {
    const canvas = canvasRef.current;
    const animation = signAnimationFor(signId);
    if (!canvas || !animation) return;
    const { url } = animation;

    let disposed = false;
    let rafId = 0;
    let scene: AvatarScene | null = null;
    setStatus('cargando');

    const observer = new ResizeObserver(() => {
      if (scene && canvas.clientWidth > 0) scene.resize(canvas.clientWidth, canvas.clientHeight);
    });

    Promise.all([
      createAvatarScene(canvas),
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`No se pudo cargar ${url}`);
        return r.json() as Promise<LandmarksFile>;
      }),
    ])
      .then(([created, landmarks]) => {
        if (disposed) {
          created.dispose();
          return;
        }
        scene = created;
        scene.resize(canvas.clientWidth, canvas.clientHeight);
        observer.observe(canvas);
        const player = createSignPlayer(scene.vrm, scene.rig, landmarks, { window: animation.window });
        canvas.dataset.duration = player.duration.toFixed(3);
        // Gancho de revisión en desarrollo (como __enlazaFakeDetector): permite
        // muestrear la animación desde tools/avatar sin depender del reloj.
        if (import.meta.env.DEV) {
          (window as unknown as { __enlazaAvatar?: unknown }).__enlazaAvatar = {
            player,
            vrm: scene.vrm,
          };
        }
        setStatus('listo');
        let last = performance.now();
        let signTime = 0;
        const loop = (now: number) => {
          const delta = (now - last) / 1000;
          last = now;
          signTime += delta * speedRef.current;
          player.update(freezeRef.current ?? signTime);
          scene!.render(delta);
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      })
      .catch((err) => {
        console.error('No se pudo cargar el avatar', err);
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      observer.disconnect();
      scene?.dispose();
    };
  }, [signId]);

  return (
    <div className={styles.stage}>
      <canvas
        ref={canvasRef}
        className={mirrored ? `${styles.canvas} ${styles.mirrored}` : styles.canvas}
        data-status={status}
      />
      {status !== 'listo' && (
        <p className={styles.overlay}>
          {status === 'cargando' ? 'Cargando avatar…' : 'No se pudo cargar el avatar.'}
        </p>
      )}
    </div>
  );
}
