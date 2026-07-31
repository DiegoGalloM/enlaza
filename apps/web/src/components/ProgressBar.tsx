import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  /** 0–100 */
  percent: number;
  color?: 'blue' | 'green';
  height?: number;
  trackColor?: string;
}

export function ProgressBar({ percent, color = 'blue', height = 8, trackColor }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={styles.track} style={{ height, background: trackColor }}>
      <div
        className={color === 'green' ? styles.fillGreen : styles.fillBlue}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
