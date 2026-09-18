import { useEffect, useRef, useState } from 'react';
import type { AvatarScene } from './scene';
import { createAvatarScene } from './scene';
import type { LandmarksFile } from './retarget';
import { createSignPlayer, type SignPlayer } from './retarget';
import { signAnimationFor } from './animations';
import styles from './SignAvatar.module.css';

const SETTLE_STEP = 1 / 60;

/**
 * Asienta la física del pelo antes del primer render. Sin esto, el brazo
 * salta en un frame de la T-pose a la seña, atraviesa los mechones y estos
 * quedan atrapados del lado equivocado de los colliders del brazo (en Por
 * favor el mechón quedaba flotando por fuera del antebrazo). En cambio se
 * simula lo que haría una persona: brazos abajo en reposo, pelo reiniciado y
 * asentado, y entrada gradual a la pose inicial de la seña.
 */
function settlePhysics(scene: AvatarScene, player: SignPlayer, startSeconds: number): void {
  player.update(startSeconds, 0);
  scene.simulate(0);
  scene.vrm.springBoneManager?.reset();
  const steps = (seconds: number) => Math.round(seconds / SETTLE_STEP);
  for (let i = 0; i < steps(1); i++) {
    player.update(startSeconds, 0);
    scene.simulate(SETTLE_STEP);
  }
  const blend = steps(0.6);
  for (let i = 1; i <= blend; i++) {
    const x = i / blend;
    player.update(startSeconds, x * x * (3 - 2 * x));
    scene.simulate(SETTLE_STEP);
  }
  for (let i = 0; i < steps(0.5); i++) {
    player.update(startSeconds);
    scene.simulate(SETTLE_STEP);
  }
}

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
  /** Ángulo de cámara en grados (0 = de frente). Solo para revisión. */
  cameraYaw?: number;
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
export function SignAvatar({
  signId,
  speed = 1,
  mirrored = false,
  freezeAt,
  cameraYaw = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speed);
  const freezeRef = useRef(freezeAt);
  const yawRef = useRef(cameraYaw);
  const [status, setStatus] = useState<'cargando' | 'listo' | 'error'>('cargando');

  // La velocidad se lee dentro del loop de animación, que no se reinicia al
  // cambiarla: así el cambio a cámara lenta no reinicia la seña.
  speedRef.current = speed;
  freezeRef.current = freezeAt;
  yawRef.current = cameraYaw;

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
        const player = createSignPlayer(scene.vrm, scene.rig, landmarks, {
          window: animation.window,
          face: animation.face,
        });
        canvas.dataset.duration = player.duration.toFixed(3);
        // Gancho de revisión en desarrollo (como __enlazaFakeDetector): permite
        // muestrear la animación desde tools/avatar sin depender del reloj.
        if (import.meta.env.DEV) {
          (window as unknown as { __enlazaAvatar?: unknown }).__enlazaAvatar = {
            player,
            vrm: scene.vrm,
            rig: scene.rig,
          };
        }
        settlePhysics(scene, player, freezeRef.current ?? 0);
        setStatus('listo');
        let last = performance.now();
        let signTime = 0;
        const loop = (now: number) => {
          const delta = (now - last) / 1000;
          last = now;
          signTime += delta * speedRef.current;
          player.update(freezeRef.current ?? signTime);
          scene!.setCameraYaw(yawRef.current);
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
