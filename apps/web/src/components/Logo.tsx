import styles from './Logo.module.css';

interface LogoProps {
  size?: 'sm' | 'md';
  withWordmark?: boolean;
}

/** The "enlazado" mark: two overlapping circles, entwined ring + filled lune. */
export function Logo({ size = 'md', withWordmark = true }: LogoProps) {
  const dims = size === 'sm' ? { width: 40, height: 27 } : { width: 54, height: 37 };
  const clipInId = `dc-in-${size}`;
  const clipWId = `dc-w-${size}`;

  return (
    <span className={styles.wrap}>
      <svg width={dims.width} height={dims.height} viewBox="0 0 240 160" aria-hidden="true">
        <defs>
          <clipPath id={clipInId}>
            <circle cx="88" cy="80" r="52" />
          </clipPath>
          <clipPath id={clipWId}>
            <rect x="0" y="80" width="240" height="80" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipInId})`}>
          <circle cx="152" cy="80" r="52" fill="var(--color-pink)" />
        </g>
        <circle cx="88" cy="80" r="52" fill="none" stroke="var(--color-blue)" strokeWidth="18" />
        <circle cx="152" cy="80" r="52" fill="none" stroke="var(--color-green)" strokeWidth="18" />
        <g clipPath={`url(#${clipWId})`}>
          <circle cx="88" cy="80" r="52" fill="none" stroke="var(--color-blue)" strokeWidth="18" />
        </g>
      </svg>
      {withWordmark && (
        <span className={size === 'sm' ? styles.wordmarkSm : styles.wordmark}>Enlaza</span>
      )}
    </span>
  );
}
