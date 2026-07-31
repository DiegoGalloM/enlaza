import { AppShell } from '../components/AppShell';
import { ProgressBar } from '../components/ProgressBar';
import { ProgressRing } from '../components/ProgressRing';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import styles from './Progress.module.css';

const WEEK_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const ACHIEVEMENT_COLORS: Record<string, { accent: string; dot: string }> = {
  'alfabeto-completo': { accent: 'var(--color-green-chip-bg)', dot: 'var(--color-green)' },
  'primera-semana': { accent: 'var(--color-pink-chip-bg)', dot: 'var(--color-pink)' },
  'conversacion-basica': { accent: 'var(--color-blue-chip-bg)', dot: 'var(--color-blue)' },
};

export function Progress() {
  const { data, loading, error } = useApi(() => api.progress());

  if (loading || error || !data) {
    return (
      <AppShell>
        <p className={styles.stateMessage}>{error ?? 'Cargando tu progreso…'}</p>
      </AppShell>
    );
  }

  const percent =
    data.totalSigns === 0 ? 0 : Math.round((data.totalMastered / data.totalSigns) * 100);
  const completedLessons = data.lessons.filter((l) => l.masteredCount >= l.signCount).length;
  const remaining = data.lessons.length - completedLessons;
  const startedLessons = data.lessons.filter((l) => l.masteredCount > 0);

  return (
    <AppShell>
      <div className={styles.headerText}>
        <span className={styles.eyebrow}>Tu progreso</span>
        <h1 className={styles.title}>
          {data.totalMastered} señas de LSC
          {data.streakDays > 1 ? `, en ${data.streakDays} días seguidos` : ''}
        </h1>
      </div>

      <div className={styles.row}>
        <div className={styles.card} style={{ flex: '1 1 320px' }}>
          <div className={styles.levelCard}>
            <ProgressRing percent={percent} size={116} strokeWidth={12}>
              <span className={styles.levelPercent}>{percent}%</span>
              <span className={styles.levelLabel}>nivel 1</span>
            </ProgressRing>
            <div className={styles.levelText}>
              <span className={styles.cardTitle}>Fundamentos de LSC</span>
              <span className={styles.cardBody}>
                {completedLessons} de {data.lessons.length} lecciones completas.
                {remaining > 0
                  ? ` Te faltan ${remaining} para conversar lo básico.`
                  : ' ¡Nivel completo!'}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.card} style={{ flex: '1 1 300px', flexDirection: 'column', gap: 16 }}>
          <div className={styles.streakHeader}>
            <span className={styles.streakNumber}>{data.streakDays}</span>
            <span className={styles.cardBody}>
              {data.streakDays === 1 ? 'día practicando' : 'días seguidos practicando'}
            </span>
          </div>
          <div className={styles.week}>
            {data.weekActivity.map((day, i) => (
              <div key={day.date} className={styles.weekDay}>
                <span className={day.active ? styles.weekBarActive : styles.weekBarPending} />
                <span className={styles.weekLabel}>{WEEK_LABELS[i]}</span>
              </div>
            ))}
          </div>
          <span className={styles.caption}>
            Practicar 5 minutos cuenta. No pierdes nada si un día no puedes.
          </span>
        </div>

        <div className={styles.milestoneCard} style={{ flex: '1 1 280px' }}>
          <span className={styles.milestoneEyebrow}>Siguiente hito</span>
          <span className={styles.milestoneTitle}>Presentarte completo en LSC</span>
          <span className={styles.milestoneBody}>
            Nombre, saludo y una pregunta.
            {remaining > 0 ? ` Te faltan ${remaining} lecciones.` : ' ¡Conseguido!'}
          </span>
          <div className={styles.milestoneBar}>
            <ProgressBar percent={percent} height={8} trackColor="rgba(198, 217, 247, 0.2)" />
          </div>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.card} style={{ flex: '1 1 620px', flexDirection: 'column', gap: 18 }}>
          <span className={styles.eyebrow}>Dominio por lección</span>
          <div className={styles.masteryList}>
            {(startedLessons.length > 0 ? startedLessons : data.lessons.slice(0, 1)).map((item) => (
              <div key={item.id} className={styles.masteryRow}>
                <span className={styles.masteryLabel}>{item.title}</span>
                <div className={styles.masteryBarTrack}>
                  <ProgressBar
                    percent={item.percent}
                    color={item.percent >= 100 ? 'green' : 'blue'}
                    height={10}
                  />
                </div>
                <span className={styles.masteryPercent}>{item.percent}%</span>
              </div>
            ))}
          </div>
          <span className={styles.caption}>
            Las señas con menor dominio vuelven a aparecer en la práctica libre.
          </span>
        </div>

        <div className={styles.card} style={{ flex: '1 1 340px', flexDirection: 'column', gap: 16 }}>
          <span className={styles.eyebrow}>Logros</span>
          {data.achievements.map((a) => {
            const colors = ACHIEVEMENT_COLORS[a.id] ?? {
              accent: 'var(--color-blue-chip-bg)',
              dot: 'var(--color-blue)',
            };
            return (
              <div key={a.id} className={styles.achievementRow}>
                {a.earned ? (
                  <span className={styles.achievementIcon} style={{ background: colors.accent }}>
                    <span className={styles.achievementDot} style={{ background: colors.dot }} />
                  </span>
                ) : (
                  <span className={styles.achievementIconLocked} />
                )}
                <div className={styles.achievementText}>
                  <span className={a.earned ? styles.achievementTitle : styles.achievementTitleLocked}>
                    {a.title}
                  </span>
                  <span
                    className={a.earned ? styles.achievementDetail : styles.achievementDetailLocked}
                  >
                    {a.detail}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
