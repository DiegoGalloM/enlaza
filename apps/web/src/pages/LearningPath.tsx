import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Link, useNavigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { LessonNode } from '../components/LessonNode';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import type { LessonSummary } from '../api/types';
import { pathColumns, pathLayout } from './pathLayout';
import styles from './LearningPath.module.css';

/** Colores de los tramos del camino, como en el mockup. */
const SEGMENT_DONE = '#3E7F66';
const SEGMENT_LOCKED = '#2E333C';

/**
 * Ancho del mapa en píxeles, para elegir cuántas columnas caben. Sin
 * ResizeObserver (jsdom) se queda en el ancho de escritorio.
 */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(1000);
  // Medir antes de pintar: sin esto, un celular ve un instante el mapa de 4 columnas.
  useLayoutEffect(() => {
    const measured = ref.current?.getBoundingClientRect().width;
    if (measured) setWidth(measured);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

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

  const [mapRef, mapWidth] = useWidth<HTMLDivElement>();
  const columns = pathColumns(mapWidth);
  const layout = pathLayout(lessons.length, columns);

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

      <div
        ref={mapRef}
        className={styles.map}
        style={
          {
            '--path-columns': columns,
            aspectRatio: lessons.length > 0 ? `${layout.width} / ${layout.height}` : undefined,
          } as CSSProperties
        }
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className={styles.mapPath}
          aria-hidden="true"
        >
          {layout.segments.map((d, i) => {
            // El tramo hacia una lección completa es verde; hacia la que está
            // en curso, azul; hacia las bloqueadas, punteado.
            const to = lessons[i + 1]!.status;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={
                  to === 'completed'
                    ? SEGMENT_DONE
                    : to === 'unlocked'
                      ? 'var(--color-blue)'
                      : SEGMENT_LOCKED
                }
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={to === 'locked' ? '2 18' : undefined}
              />
            );
          })}
        </svg>

        {loading && <p className={styles.mapMessage}>Cargando tu ruta…</p>}
        {error && <p className={styles.mapMessage}>{error}</p>}

        {lessons.map((lesson, i) => {
          const node = layout.nodes[i]!;
          const slot = {
            left: `${(node.x / layout.width) * 100}%`,
            top: `${(node.y / layout.height) * 100}%`,
          };
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
