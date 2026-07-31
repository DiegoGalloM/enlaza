import type { ReactNode } from 'react';
import styles from './ProgressRing.module.css';

interface ProgressRingProps {
  /** 0–100 */
  percent: number;
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
  fillColor?: string;
  children?: ReactNode;
}

export function ProgressRing({
  percent,
  size = 116,
  strokeWidth = 12,
  trackColor = 'var(--color-border-strong)',
  fillColor = 'var(--color-blue)',
  children,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = size / 2 - strokeWidth / 2 - 2;
  const center = size / 2;

  return (
    <div className={styles.wrap} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clamped} ${100 - clamped}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      {children && <div className={styles.center}>{children}</div>}
    </div>
  );
}
