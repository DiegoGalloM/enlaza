import { NavLink } from 'react-router-dom';
import { Logo } from './Logo';
import styles from './Sidebar.module.css';

const STREAK_DAYS = 6;
const STREAK_WEEK_LENGTH = 7;

const navItems = [
  { label: 'Mi ruta', to: '/' },
  { label: 'Progreso', to: '/progreso' },
  { label: 'Práctica libre', to: null },
  { label: 'Diccionario LSC', to: null },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Logo size="sm" />
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) =>
          item.to ? (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? styles.dotActive : styles.dot} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ) : (
            <span key={item.label} className={`${styles.navItem} ${styles.navItemDisabled}`}>
              <span className={styles.dot} />
              <span>{item.label}</span>
            </span>
          ),
        )}
      </nav>

      <div className={styles.streakCard}>
        <span className={styles.streakLabel}>Racha</span>
        <span className={styles.streakValue}>{STREAK_DAYS} días</span>
        <div className={styles.streakBar}>
          {Array.from({ length: STREAK_WEEK_LENGTH }, (_, i) => (
            <span
              key={i}
              className={i < STREAK_DAYS ? styles.streakSegmentActive : styles.streakSegment}
            />
          ))}
        </div>
      </div>

      <div className={styles.profile}>
        <span className={styles.avatar}>MC</span>
        <div className={styles.profileText}>
          <span className={styles.profileName}>Mariana C.</span>
          <span className={styles.profileRole}>Enfermería · Nivel 1</span>
        </div>
      </div>
    </aside>
  );
}
