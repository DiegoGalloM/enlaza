import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { ProgressBar } from '../components/ProgressBar';
import styles from './Lesson.module.css';

const steps = [
  {
    number: 1,
    chipBg: 'var(--color-blue-chip-bg)',
    chipText: 'var(--color-blue-chip-text)',
    label: 'Forma:',
    text: 'índice, medio y pulgar extendidos; los otros dos recogidos.',
  },
  {
    number: 2,
    chipBg: 'var(--color-green-chip-bg)',
    chipText: 'var(--color-green-chip-text)',
    label: 'Ubicación:',
    text: 'a la altura del pecho, ligeramente al centro.',
  },
  {
    number: 3,
    chipBg: 'var(--color-pink-chip-bg)',
    chipText: 'var(--color-pink)',
    label: 'Movimiento:',
    text: 'dos flexiones de muñeca hacia abajo, sin mover el brazo.',
  },
];

export function Lesson() {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => navigate('/')}
            aria-label="Volver a la ruta de aprendizaje"
          >
            ←
          </button>
          <div className={styles.progressBlock}>
            <div className={styles.progressLabels}>
              <span className={styles.lessonName}>Números 1 – 20</span>
              <span className={styles.signCount}>seña 13 de 20</span>
            </div>
            <ProgressBar percent={60} />
          </div>
          <span className={styles.timeless}>Sin límite de tiempo</span>
        </div>

        <div className={styles.body}>
          <div className={styles.videoPanel}>
            <div className={styles.videoFrame}>
              <span className={styles.playButton}>
                <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
                  <polygon points="3,2 20,13 3,24" fill="var(--color-screen)" />
                </svg>
              </span>
              <span className={styles.videoCaption}>video de referencia — modelo sordo/a señante</span>
              <span className={styles.videoTime}>0:04 · velocidad 0.5×</span>
            </div>
            <div className={styles.videoActions}>
              <Button variant="tinted">Ver en cámara lenta</Button>
              <Button variant="outline">Vista de espejo</Button>
              <Button variant="outline">Repetir</Button>
            </div>
          </div>

          <div className={styles.detail}>
            <div className={styles.signIntro}>
              <span className={styles.eyebrow}>Seña</span>
              <h1 className={styles.signWord}>Trece</h1>
              <p className={styles.signDescription}>
                Mano dominante al frente, palma hacia ti. Muestra tres dedos y baja la muñeca dos
                veces con un movimiento corto.
              </p>
            </div>

            <div className={styles.buildCard}>
              <span className={styles.eyebrow}>Cómo se construye</span>
              {steps.map((step) => (
                <div key={step.number} className={styles.step}>
                  <span
                    className={styles.stepNumber}
                    style={{ background: step.chipBg, color: step.chipText }}
                  >
                    {step.number}
                  </span>
                  <span className={styles.stepText}>
                    <strong className={styles.stepLabel}>{step.label}</strong> {step.text}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.tipCard}>
              <span className={styles.tipDot} />
              <span className={styles.tipText}>
                En LSC los números 11 a 15 comparten esta flexión de muñeca. Reconocerla te ahorra
                memorizar cinco señas por separado.
              </span>
            </div>

            <Button variant="primary" size="lg" className={styles.practiceButton}>
              Practicar con cámara
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
