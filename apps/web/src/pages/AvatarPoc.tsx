import { SignAvatar } from '../avatar/SignAvatar';
import styles from './AvatarPoc.module.css';

const SIGN_ID = 'lsc-cortesia-5'; // Hola

/**
 * Pantalla de prueba del avatar 3D (sin auth, como /design-tokens): el mismo
 * componente que usa la lección, aislado para revisarlo sin pasar por login.
 */
export function AvatarPoc() {
  return (
    <main className={styles.page}>
      <h1>PoC avatar 3D</h1>
      <p className={styles.note}>
        Pantalla de prueba — seña «Hola» retargeteada desde el video de referencia de ICAL a un
        modelo de muestra del consorcio VRM. Contenido sin validar por ICAL.
      </p>
      <div className={styles.stage}>
        <SignAvatar signId={SIGN_ID} />
      </div>
    </main>
  );
}
