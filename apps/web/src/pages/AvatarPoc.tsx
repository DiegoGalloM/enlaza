import { useEffect, useRef, useState } from 'react';
import type { AvatarScene } from '../avatar/scene';
import { createAvatarScene } from '../avatar/scene';
import styles from './AvatarPoc.module.css';

/**
 * Pantalla de prueba del PoC de avatar 3D (sin auth, como /design-tokens).
 * No forma parte del flujo de lección todavía.
 */
export function AvatarPoc() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<AvatarScene | null>(null);
  const [status, setStatus] = useState<'cargando' | 'listo' | 'error'>('cargando');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let rafId = 0;

    createAvatarScene(canvas)
      .then((scene) => {
        if (disposed) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        scene.resize(canvas.clientWidth, canvas.clientHeight);
        setStatus('listo');
        let last = performance.now();
        const loop = (now: number) => {
          scene.render((now - last) / 1000);
          last = now;
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
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <main className={styles.page}>
      <h1>PoC avatar 3D</h1>
      <p className={styles.note}>
        Pantalla de prueba — modelo de muestra del consorcio VRM, contenido sin validar por ICAL.
      </p>
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} data-status={status} />
        {status === 'cargando' && <p className={styles.overlay}>Cargando modelo…</p>}
        {status === 'error' && <p className={styles.overlay}>No se pudo cargar el modelo 3D.</p>}
      </div>
    </main>
  );
}
