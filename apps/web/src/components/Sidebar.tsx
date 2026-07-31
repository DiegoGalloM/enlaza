import { NavLink } from 'react-router';
import { Logo } from './Logo';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import styles from './Sidebar.module.css';

const WEEK_LENGTH = 7;

const navItems = [
  { label: 'Mi ruta', to: '/' },
  { label: 'Progreso', to: '/progreso' },
  { label: 'Práctica libre', to: null },
  { label: 'Diccionario LSC', to: null },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const { data: progress } = useApi(() => api.progress());

  const streakDays = progress?.streakDays ?? 0;
  const activeDays = progress?.weekActivity.filter((d) => d.active).length ?? 0;

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
              className={({ isActive }: { isActive: boolean }) =>
                isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
              }
            >
              {({ isActive }: { isActive: boolean }) => (
                <>
                  <span className={isActive ? styles.dotActive : styles.dot} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ) : (
            <span
              key={item.label}
              className={`${styles.navItem} ${styles.navItemDisabled}`}
              title="Disponible próximamente"
            >
              <span className={styles.dot} />
              <span>{item.label}</span>
            </span>
          ),
        )}
      </nav>

      <div className={styles.streakCard}>
        <span className={styles.streakLabel}>Racha</span>
        <span className={styles.streakValue}>
          {streakDays} {streakDays === 1 ? 'día' : 'días'}
        </span>
        <div className={styles.streakBar}>
          {Array.from({ length: WEEK_LENGTH }, (_, i) => (
            <span
              key={i}
              className={i < activeDays ? styles.streakSegmentActive : styles.streakSegment}
            />
          ))}
        </div>
      </div>

      <div className={styles.profile}>
        <span className={styles.avatar}>{user ? initials(user.displayName) : '·'}</span>
        <div className={styles.profileText}>
          <span className={styles.profileName}>{user?.displayName ?? ''}</span>
          <button type="button" className={styles.logout} onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>
  );
}
