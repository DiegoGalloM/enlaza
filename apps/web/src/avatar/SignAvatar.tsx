import { useEffect, useRef, useState } from 'react';
import type { AvatarScene } from './scene';
import { createAvatarScene } from './scene';
import type { LandmarksFile } from './retarget';
import { createSignPlayer } from './retarget';
import { animationUrlFor } from './animations';
import styles from './SignAvatar.module.css';

interface Props {
  signId: string;
  /** Multiplicador de velocidad: <1 reproduce más lento (cámara lenta). */
  speed?: number;
  /** Vista de espejo: voltea la imagen para que el usuario pueda copiar de frente. */
  mirrored?: boolean;
}

/**
 * Avatar 3D reproduciendo una seña en bucle.
 *
 * El movimiento sale de los landmarks extraídos del video de referencia de
 * ICAL y se retargetea a un modelo humanoide genérico (ver retarget.ts). Es
 * una aproximación: no modela abducción de dedos ni el eje real del pulgar,
 * así que la configuración manual no es fiel al detalle y NO debe presentarse
 * como referencia validada — la lección ya muestra el aviso de contenido
 * provisional.
 */
export function SignAvatar({ signId, speed = 1, mirrored = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speed);
  const [status, setStatus] = useState<'cargando' | 'listo' | 'error'>('cargando');

  // La velocidad se lee dentro del loop de animación, que no se reinicia al
  // cambiarla: así el cambio a cámara lenta no reinicia la seña.
  speedRef.current = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    const url = animationUrlFor(signId);
    if (!canvas || !url) return;

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
        setStatus('listo');

        const player = createSignPlayer(scene.vrm, landmarks);
        let last = performance.now();
        let signTime = 0;
        const loop = (now: number) => {
          const delta = (now - last) / 1000;
          last = now;
          signTime += delta * speedRef.current;
          player.update(signTime);
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
