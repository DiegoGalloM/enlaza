import { useSearchParams } from 'react-router';
import { SignAvatar } from '../avatar/SignAvatar';
import { listSignAnimations, signAnimationFor } from '../avatar/animations';
import styles from './AvatarPoc.module.css';

const DEFAULT_SIGN_ID = 'lsc-cortesia-5'; // Hola

/**
 * Pantalla de prueba del avatar 3D (sin auth, como /design-tokens): el mismo
 * componente que usa la lección, aislado para revisarlo sin pasar por login.
 * `?sena=lsc-cortesia-4` elige la seña (por defecto Hola) y `?t=1.2` la congela
 * en ese instante para revisarla cuadro por cuadro. `?angulo=90` gira la cámara
 * para ver de lado si una mano toca el cuerpo.
 */
export function AvatarPoc() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('sena');
  const signId = requested && signAnimationFor(requested) ? requested : DEFAULT_SIGN_ID;
  const gloss = signAnimationFor(signId)!.gloss;
  const t = params.get('t');
  const freezeAt = t !== null && Number.isFinite(Number(t)) ? Number(t) : undefined;
  const angle = Number(params.get('angulo') ?? 0);
  return (
    <main className={styles.page}>
      <h1>PoC avatar 3D</h1>
      <p className={styles.note}>
        Pantalla de prueba — seña «{gloss}» retargeteada desde el video de referencia de ICAL a un
        modelo de muestra del consorcio VRM. Contenido sin validar por ICAL.
      </p>
      <p>
        {listSignAnimations().map((sign) => (
          <button
            key={sign.signId}
            type="button"
            aria-pressed={sign.signId === signId}
            onClick={() => setParams({ sena: sign.signId })}
          >
            {sign.gloss}
          </button>
        ))}
      </p>
      <div className={styles.stage}>
        <SignAvatar
          signId={signId}
          freezeAt={freezeAt}
          cameraYaw={Number.isFinite(angle) ? angle : 0}
        />
      </div>
    </main>
  );
}
