import { Link, useNavigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { LessonNode } from '../components/LessonNode';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import type { LessonSummary } from '../api/types';
import styles from './LearningPath.module.css';

/** Fixed map slots for the 7 MVP lessons, matching the design mockup. */
const NODE_SLOTS = [
  { left: '12%', top: '28%' },
  { left: '36%', top: '20%' },
  { left: '60%', top: '28%' },
  { left: '84%', top: '20%' },
  { left: '76%', top: '74%' },
  { left: '50%', top: '82%' },
  { left: '24%', top: '74%' },
];

function nodeState(lesson: LessonSummary): 'completed' | 'in-progress' | 'locked' {
  if (lesson.status === 'completed') return 'completed';
  if (lesson.status === 'locked') return 'locked';
  return 'in-progress';
}

function nodeSubtitle(lesson: LessonSummary): string {
  if (lesson.status === 'locked') return 'bloqueada';
  if (lesson.status === 'completed') return lesson.subtitle ?? `${lesson.signCount} señas`;
  if (lesson.masteredCount > 0) {
    return `${lesson.masteredCount} de ${lesson.signCount} · en curso`;
  }
  return lesson.subtitle ?? `${lesson.signCount} señas`;
}

export function LearningPath() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error } = useApi(() => api.lessons());

  const lessons = data?.lessons ?? [];
  const completedCount = lessons.filter((l) => l.status === 'completed').length;
  const totalMastered = lessons.reduce((sum, l) => sum + l.masteredCount, 0);
  const nextLesson =
    lessons.find((l) => l.status === 'unlocked') ?? lessons.find((l) => l.status !== 'completed');

  const firstName = user?.displayName.split(/\s+/)[0] ?? '';

  return (
    <AppShell>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.eyebrow}>Nivel 1 · Fundamentos</span>
          <h1 className={styles.title}>Hola de nuevo, {firstName}</h1>
          <span className={styles.subtitle}>
            {nextLesson
              ? `Tu siguiente lección es ${nextLesson.title}. Practica a tu ritmo.`
              : '¡Completaste todas las lecciones del nivel 1!'}
          </span>
        </div>
        <div className={styles.headerActions}>
          {nextLesson && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate(`/leccion/${nextLesson.id}`)}
            >
              Continuar: {nextLesson.title}
            </Button>
          )}
          <div className={styles.statCard}>
            <div className={styles.stat}>
              <span className={styles.statValue}>
                {completedCount}
                <span className={styles.statValueMuted}>/{lessons.length || 7}</span>
              </span>
              <span className={styles.statLabel}>Lecciones</span>
            </div>
            <span className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>{totalMastered}</span>
              <span className={styles.statLabel}>Señas validadas</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.map}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 900 520"
          preserveAspectRatio="none"
          className={styles.mapPath}
          aria-hidden="true"
        >
          <path
            d="M108,146 C170,146 200,104 324,104 C420,104 440,146 540,146"
            fill="none"
            stroke="#3E7F66"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M540,146 C620,146 660,104 756,104"
            fill="none"
            stroke="var(--color-blue)"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M756,104 C850,104 872,200 856,270 C838,350 780,385 684,385 C580,385 540,426 450,426 C370,426 320,385 216,385"
            fill="none"
            stroke="#2E333C"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray="2 18"
          />
        </svg>

        {loading && <p className={styles.mapMessage}>Cargando tu ruta…</p>}
        {error && <p className={styles.mapMessage}>{error}</p>}

        {lessons.map((lesson, i) => {
          const slot = NODE_SLOTS[i] ?? NODE_SLOTS[NODE_SLOTS.length - 1]!;
          const state = nodeState(lesson);
          const content = (
            <LessonNode
              state={state}
              title={lesson.title}
              subtitle={nodeSubtitle(lesson)}
              percent={
                lesson.signCount === 0
                  ? 0
                  : Math.round((lesson.masteredCount / lesson.signCount) * 100)
              }
            />
          );
          return state === 'locked' ? (
            <div key={lesson.id} className={styles.nodeSlot} style={slot}>
              {content}
            </div>
          ) : (
            <Link key={lesson.id} to={`/leccion/${lesson.id}`} className={styles.nodeSlot} style={slot}>
              {content}
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
