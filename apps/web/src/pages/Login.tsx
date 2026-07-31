import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { useAuth } from '../auth/AuthContext';
import styles from './Login.module.css';

type Mode = 'login' | 'register';

export function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo salió mal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Logo />
        </div>
        <p className={styles.tagline}>
          Aprende Lengua de Señas Colombiana practicando de verdad — no solo mirando.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label className={styles.field}>
              <span className={styles.label}>Nombre</span>
              <input
                className={styles.input}
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label className={styles.field}>
            <span className={styles.label}>Correo</span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Contraseña</span>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <Button variant="primary" size="lg" type="submit" disabled={busy}>
            {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </Button>
        </form>

        <button
          type="button"
          className={styles.switchMode}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? '¿No tienes cuenta? Crea una' : '¿Ya tienes cuenta? Entra'}
        </button>

        <p className={styles.demoHint}>
          Cuenta de demostración: <code>demo@enlaza.app</code> / <code>enlaza-demo</code>
          <br />
          (ejecuta <code>npm run seed</code> primero)
        </p>
      </div>
    </div>
  );
}
