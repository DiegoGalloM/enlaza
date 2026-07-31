import { AppShell } from '../components/AppShell';
import { ProgressBar } from '../components/ProgressBar';
import { ProgressRing } from '../components/ProgressRing';
import styles from './Progress.module.css';

const weekDays = [
  { label: 'L', done: true },
  { label: 'M', done: true },
  { label: 'M', done: true },
  { label: 'J', done: true },
  { label: 'V', done: true },
  { label: 'S', done: true },
  { label: 'D', done: false },
];

const mastery = [
  { label: 'Alfabeto I', percent: 96, color: 'green' as const },
  { label: 'Alfabeto II', percent: 88, color: 'green' as const },
  { label: 'Saludos', percent: 91, color: 'green' as const },
  { label: 'Números 1 – 20', percent: 60, color: 'blue' as const },
];

const achievements = [
  {
    title: 'Alfabeto completo',
    detail: '27 letras validadas',
    state: 'earned' as const,
    accent: 'var(--color-green-chip-bg)',
    dot: 'var(--color-green)',
  },
  {
    title: 'Primera semana',
    detail: '6 días de práctica',
    state: 'earned' as const,
    accent: 'var(--color-pink-chip-bg)',
    dot: 'var(--color-pink)',
  },
  {
    title: 'Conversación básica',
    detail: 'al terminar el nivel 1',
    state: 'locked' as const,
  },
];

export function Progress() {
  return (
    <AppShell>
      <div className={styles.headerText}>
        <span className={styles.eyebrow}>Tu progreso</span>
        <h1 className={styles.title}>48 señas de LSC, en seis días</h1>
      </div>

      <div className={styles.row}>
        <div className={styles.card} style={{ flex: '1 1 320px' }}>
          <div className={styles.levelCard}>
            <ProgressRing percent={43} size={116} strokeWidth={12}>
              <span className={styles.levelPercent}>43%</span>
              <span className={styles.levelLabel}>nivel 1</span>
            </ProgressRing>
            <div className={styles.levelText}>
              <span className={styles.cardTitle}>Fundamentos de LSC</span>
              <span className={styles.cardBody}>
                3 de 7 lecciones completas. Te faltan 4 para conversar lo básico.
              </span>
            </div>
          </div>
        </div>

        <div className={styles.card} style={{ flex: '1 1 300px', flexDirection: 'column', gap: 16 }}>
          <div className={styles.streakHeader}>
            <span className={styles.streakNumber}>6</span>
            <span className={styles.cardBody}>días seguidos practicando</span>
          </div>
          <div className={styles.week}>
            {weekDays.map((day, i) => (
              <div key={i} className={styles.weekDay}>
                <span className={day.done ? styles.weekBarActive : styles.weekBarPending} />
                <span className={styles.weekLabel}>{day.label}</span>
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
          <span className={styles.milestoneBody}>Nombre, saludo y una pregunta. Te faltan 2 lecciones.</span>
          <div className={styles.milestoneBar}>
            <ProgressBar percent={64} height={8} trackColor="rgba(198, 217, 247, 0.2)" />
          </div>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.card} style={{ flex: '1 1 620px', flexDirection: 'column', gap: 18 }}>
          <span className={styles.eyebrow}>Dominio por lección</span>
          <div className={styles.masteryList}>
            {mastery.map((item) => (
              <div key={item.label} className={styles.masteryRow}>
                <span className={styles.masteryLabel}>{item.label}</span>
                <div className={styles.masteryBarTrack}>
                  <ProgressBar percent={item.percent} color={item.color} height={10} />
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
          {achievements.map((a) => (
            <div key={a.title} className={styles.achievementRow}>
              {a.state === 'earned' ? (
                <span className={styles.achievementIcon} style={{ background: a.accent }}>
                  <span className={styles.achievementDot} style={{ background: a.dot }} />
                </span>
              ) : (
                <span className={styles.achievementIconLocked} />
              )}
              <div className={styles.achievementText}>
                <span className={a.state === 'earned' ? styles.achievementTitle : styles.achievementTitleLocked}>
                  {a.title}
                </span>
                <span className={a.state === 'earned' ? styles.achievementDetail : styles.achievementDetailLocked}>
                  {a.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
