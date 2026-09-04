import { Suspense, lazy, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Button } from '../components/Button';
import { ProgressBar } from '../components/ProgressBar';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import { hasSignAnimation } from '../avatar/animations';
import styles from './Lesson.module.css';

// Carga perezosa: three.js solo se descarga en lecciones con avatar.
const SignAvatar = lazy(() =>
  import('../avatar/SignAvatar').then((m) => ({ default: m.SignAvatar })),
);

const SLOW_MOTION_SPEED = 0.35;

export function Lesson() {
  const navigate = useNavigate();
  const { lessonId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { data, loading, error } = useApi(() => api.lesson(lessonId), [lessonId]);
  const [slowMotion, setSlowMotion] = useState(false);
  const [mirrored, setMirrored] = useState(false);

  if (loading || error || !data) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.stateMessage}>{error ?? 'Cargando lección…'}</p>
        </div>
      </div>
    );
  }

  const { lesson, signs } = data;
  const requestedSignId = searchParams.get('sign');
  const currentSign =
    signs.find((s) => s.id === requestedSignId) ?? signs.find((s) => !s.mastered) ?? signs[0];

  if (!currentSign) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.stateMessage}>Esta lección aún no tiene señas.</p>
        </div>
      </div>
    );
  }

  const masteredCount = signs.filter((s) => s.mastered).length;
  const currentIndex = signs.findIndex((s) => s.id === currentSign.id);
  const hasAvatar = hasSignAnimation(currentSign.id);

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
              <span className={styles.lessonName}>{lesson.title}</span>
              <span className={styles.signCount}>
                seña {currentIndex + 1} de {signs.length}
              </span>
            </div>
            <ProgressBar percent={(masteredCount / signs.length) * 100} />
          </div>
          <span className={styles.timeless}>Sin límite de tiempo</span>
        </div>

        <div className={styles.body}>
          <div className={styles.videoPanel}>
            {hasAvatar ? (
              <div className={styles.avatarFrame}>
                <Suspense fallback={null}>
                  <SignAvatar
                    signId={currentSign.id}
                    speed={slowMotion ? SLOW_MOTION_SPEED : 1}
                    mirrored={mirrored}
                  />
                </Suspense>
              </div>
            ) : (
              <div className={styles.videoFrame}>
                <span className={styles.playButton}>
                  <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
                    <polygon points="3,2 20,13 3,24" fill="var(--color-screen)" />
                  </svg>
                </span>
                <span className={styles.videoCaption}>
                  seña sin avatar todavía — pendiente de procesar su video de referencia
                </span>
              </div>
            )}
            <div className={styles.videoActions}>
              <Button
                variant="tinted"
                disabled={!hasAvatar}
                aria-pressed={slowMotion}
                onClick={() => setSlowMotion((v) => !v)}
              >
                {slowMotion ? 'Velocidad normal' : 'Ver en cámara lenta'}
              </Button>
              <Button
                variant="outline"
                disabled={!hasAvatar}
                aria-pressed={mirrored}
                onClick={() => setMirrored((v) => !v)}
              >
                {mirrored ? 'Vista normal' : 'Vista de espejo'}
              </Button>
            </div>
          </div>

          <div className={styles.detail}>
            <div className={styles.signIntro}>
              <span className={styles.eyebrow}>
                Seña · {currentSign.signType === 'static' ? 'estática' : 'dinámica'}
              </span>
              <h1 className={styles.signWord}>{currentSign.gloss}</h1>
              <p className={styles.signDescription}>{currentSign.description}</p>
            </div>

            {!currentSign.validated && (
              <div className={styles.tipCard}>
                <span className={styles.tipDot} />
                <span className={styles.tipText}>
                  Contenido provisional: esta seña aún no ha sido validada con ICAL ni con
                  personas sordas señantes de LSC. No la tomes como referencia definitiva.
                </span>
              </div>
            )}

            <div className={styles.signList}>
              {signs.map((sign) => (
                <button
                  key={sign.id}
                  type="button"
                  onClick={() => navigate(`/leccion/${lessonId}?sign=${sign.id}`)}
                  className={[
                    styles.signChip,
                    sign.mastered ? styles.signChipMastered : '',
                    sign.id === currentSign.id ? styles.signChipActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {sign.gloss}
                </button>
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              className={styles.practiceButton}
              onClick={() => navigate(`/leccion/${lessonId}/practica?sign=${currentSign.id}`)}
            >
              Practicar con cámara
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
