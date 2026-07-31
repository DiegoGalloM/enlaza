import { ProgressRing } from './ProgressRing';
import styles from './LessonNode.module.css';

interface LessonNodeProps {
  state: 'completed' | 'in-progress' | 'locked';
  title: string;
  subtitle: string;
  percent?: number;
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline
        points="4 12.5 9.5 18 20 6.5"
        stroke="var(--color-green-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LessonNode({ state, title, subtitle, percent = 0 }: LessonNodeProps) {
  return (
    <div className={styles.node}>
      {state === 'completed' && (
        <div className={styles.completedCircle}>
          <CheckIcon />
        </div>
      )}
      {state === 'in-progress' && (
        <ProgressRing percent={percent} size={90} strokeWidth={8} trackColor="var(--color-border-strong)">
          <div className={styles.percentBadge}>{percent}%</div>
        </ProgressRing>
      )}
      {state === 'locked' && (
        <div className={styles.lockedCircle}>
          <span className={styles.lockedDot} />
        </div>
      )}
      <span
        className={state === 'locked' ? styles.labelLocked : styles.label}
      >
        {title}
        <br />
        <span className={state === 'locked' ? styles.sublabelLocked : styles.sublabel}>
          {subtitle}
        </span>
      </span>
    </div>
  );
}
