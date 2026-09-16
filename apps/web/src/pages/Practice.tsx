import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button } from '../components/Button';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import { fetchBundledTemplates, loadTemplates, mergeTemplates } from '../cv/templates';
import { usePracticeSession } from '../cv/usePracticeSession';
import styles from './Practice.module.css';
import { SCORE_LEVEL_LABEL, scoreLevel } from '@enlaza/cv-model';
import type { SignTemplate } from '@enlaza/cv-model';

const NO_TEMPLATES: SignTemplate[] = [];

/**
 * Plantillas disponibles para practicar: las empaquetadas con la app
 * (derivadas de los videos de ICAL) más las grabadas en este dispositivo,
 * que tienen prioridad. `null` mientras cargan, para no arrancar la sesión
 * de práctica con una lista incompleta y reiniciar la cámara después.
 */
function useAllTemplates(): SignTemplate[] | null {
  const [templates, setTemplates] = useState<SignTemplate[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBundledTemplates().then((bundled) => {
      if (!cancelled) setTemplates(mergeTemplates(bundled, loadTemplates()));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return templates;
}

export function Practice() {
  const navigate = useNavigate();
  const { lessonId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { data, reload } = useApi(() => api.lesson(lessonId), [lessonId]);
  const templates = useAllTemplates();
  const [attemptSaved, setAttemptSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const requestedSignId = searchParams.get('sign');
  const signs = useMemo(() => data?.signs ?? [], [data]);
  const currentSign = signs.find((s) => s.id === requestedSignId) ?? signs[0] ?? null;

  const session = usePracticeSession(
    currentSign && templates ? { id: currentSign.id, type: currentSign.signType } : null,
    templates ?? NO_TEMPLATES,
  );

  const glossById = useMemo(() => new Map(signs.map((s) => [s.id, s.gloss])), [signs]);

  async function recordAttempt(score: number | null) {
    if (!currentSign || attemptSaved) return;
    try {
      await api.recordAttempt(currentSign.id, true, score ?? undefined);
      setAttemptSaved(true);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar el intento');
    }
  }

  // Persist the attempt once, as soon as the validator confirms the sign.
  useEffect(() => {
    if (session.status === 'correct' && !attemptSaved && !saveError) {
      void recordAttempt(session.finalScore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  // Reset per-sign state when moving to another sign.
  useEffect(() => {
    setAttemptSaved(false);
    setSaveError(null);
  }, [currentSign?.id]);

  const nextSign = currentSign
    ? signs.find((s) => !s.mastered && s.id !== currentSign.id)
    : null;

  if (!currentSign) {
    return (
      <div className={styles.page}>
        <p className={styles.stateMessage}>Cargando…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate(`/leccion/${lessonId}?sign=${currentSign.id}`)}
          aria-label="Volver a la lección"
        >
          ←
        </button>
        <div className={styles.topText}>
          <span className={styles.eyebrow}>
            Práctica · {currentSign.signType === 'static' ? 'seña estática' : 'seña dinámica'}
          </span>
          <span className={styles.gloss}>{currentSign.gloss}</span>
        </div>
      </div>

      <div className={styles.videoCard}>
        <div
          className={[
            styles.videoFrame,
            session.status === 'correct' ? styles.videoFrameCorrect : '',
            session.status === 'retry' ? styles.videoFrameRetry : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <video ref={session.videoRef} className={styles.video} playsInline muted />
          <canvas ref={session.canvasRef} className={styles.overlay} width={960} height={540} />

          {session.cameraState === 'starting' && (
            <div className={styles.videoNotice}>Iniciando cámara y detector de manos…</div>
          )}
          {session.cameraState === 'error' && (
            <div className={styles.videoNotice}>{session.cameraError}</div>
          )}
        </div>

        <div className={styles.statusRow}>
          {session.status === 'correct' ? (
            <div className={`${styles.statusPill} ${styles.statusCorrect}`}>
              ¡Correcta! Seña {currentSign.gloss} validada
              {session.finalScore !== null &&
                ` · ${SCORE_LEVEL_LABEL[scoreLevel(session.finalScore, currentSign.signType)]}`}
            </div>
          ) : session.status === 'retry' ? (
            <div className={`${styles.statusPill} ${styles.statusRetry}`}>
              Casi
              {session.best && glossById.get(session.best.signId)
                ? ` — parece "${glossById.get(session.best.signId)}"`
                : ''}
              . Revisa la forma y vuelve a intentarlo.
            </div>
          ) : session.status === 'tracking' ? (
            <div className={styles.statusPill}>
              Te vemos — haz la seña {currentSign.gloss}
              {currentSign.signType === 'static' ? ' y mantenla un momento' : ''}
            </div>
          ) : (
            <div className={styles.statusPill}>Muestra tu mano a la cámara</div>
          )}
        </div>

        {session.status === 'correct' && (
          <div className={styles.actions}>
            {saveError && <p className={styles.error}>{saveError}</p>}
            {nextSign ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigate(`/leccion/${lessonId}/practica?sign=${nextSign.id}`)}
              >
                Siguiente seña: {nextSign.gloss}
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => navigate(`/leccion/${lessonId}`)}>
                ¡Lección completa! Volver
              </Button>
            )}
          </div>
        )}

        {!session.hasTemplate && session.status !== 'correct' && (
          <div className={styles.noTemplate}>
            <p className={styles.noTemplateText}>
              Esta seña aún no tiene plantilla de referencia en este dispositivo, así que la
              cámara no puede validarla. Puedes grabar una en{' '}
              <Link to={`/plantillas?lesson=${lessonId}`}>calibración</Link>, o continuar sin
              validación.
            </p>
            <Button variant="outline" onClick={() => void recordAttempt(null)}>
              Marcar practicada (sin validación)
            </Button>
            {attemptSaved && (
              <Button variant="primary" onClick={() => navigate(`/leccion/${lessonId}`)}>
                Volver a la lección
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
