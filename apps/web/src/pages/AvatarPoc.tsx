import { useSearchParams } from 'react-router';
import { SignAvatar } from '../avatar/SignAvatar';
import styles from './AvatarPoc.module.css';

const SIGN_ID = 'lsc-cortesia-5'; // Hola

/**
 * Pantalla de prueba del avatar 3D (sin auth, como /design-tokens): el mismo
 * componente que usa la lección, aislado para revisarlo sin pasar por login.
 * `?t=1.2` congela la seña en ese instante para revisarla cuadro por cuadro.
 */
export function AvatarPoc() {
  const [params] = useSearchParams();
  const t = params.get('t');
  const freezeAt = t !== null && Number.isFinite(Number(t)) ? Number(t) : undefined;
  return (
    <main className={styles.page}>
      <h1>PoC avatar 3D</h1>
      <p className={styles.note}>
        Pantalla de prueba — seña «Hola» retargeteada desde el video de referencia de ICAL a un
        modelo de muestra del consorcio VRM. Contenido sin validar por ICAL.
      </p>
      <div className={styles.stage}>
        <SignAvatar signId={SIGN_ID} freezeAt={freezeAt} />
      </div>
    </main>
  );
}
