import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { LessonNode } from '../components/LessonNode';
import styles from './LearningPath.module.css';

interface MapNode {
  id: string;
  title: string;
  subtitle: string;
  state: 'completed' | 'in-progress' | 'locked';
  percent?: number;
  left: string;
  top: string;
}

const nodes: MapNode[] = [
  { id: 'alfabeto-1', title: 'Alfabeto I', subtitle: 'A – M', state: 'completed', left: '12%', top: '28%' },
  { id: 'alfabeto-2', title: 'Alfabeto II', subtitle: 'N – Z', state: 'completed', left: '36%', top: '20%' },
  { id: 'saludos', title: 'Saludos', subtitle: '8 señas', state: 'completed', left: '60%', top: '28%' },
  {
    id: 'numeros',
    title: 'Números 1 – 20',
    subtitle: '12 de 20 · en curso',
    state: 'in-progress',
    percent: 60,
    left: '84%',
    top: '20%',
  },
  { id: 'preguntas', title: 'Preguntas esenciales', subtitle: 'bloqueada', state: 'locked', left: '76%', top: '74%' },
  { id: 'salud', title: 'Salud y atención', subtitle: 'bloqueada', state: 'locked', left: '50%', top: '82%' },
  { id: 'emociones', title: 'Emociones', subtitle: 'bloqueada', state: 'locked', left: '24%', top: '74%' },
];

const completedCount = nodes.filter((n) => n.state === 'completed').length;

export function LearningPath() {
  const navigate = useNavigate();

  return (
    <AppShell>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.eyebrow}>Nivel 1 · Fundamentos</span>
          <h1 className={styles.title}>Hola de nuevo, Mariana</h1>
          <span className={styles.subtitle}>
            Vas por la mitad del alfabeto. Sigue con Saludos cuando quieras.
          </span>
        </div>
        <div className={styles.headerActions}>
          <Button variant="primary" size="lg" onClick={() => navigate('/leccion/numeros')}>
            Continuar: Números
          </Button>
          <div className={styles.statCard}>
            <div className={styles.stat}>
              <span className={styles.statValue}>
                {completedCount}
                <span className={styles.statValueMuted}>/{nodes.length}</span>
              </span>
              <span className={styles.statLabel}>Lecciones</span>
            </div>
            <span className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>48</span>
              <span className={styles.statLabel}>Señas validadas</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.map}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 900 520"
          preserveAspectRatio="none"
          className={styles.mapPath}
          aria-hidden="true"
        >
          <path
            d="M108,146 C170,146 200,104 324,104 C420,104 440,146 540,146"
            fill="none"
            stroke="#3E7F66"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M540,146 C620,146 660,104 756,104"
            fill="none"
            stroke="var(--color-blue)"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M756,104 C850,104 872,200 856,270 C838,350 780,385 684,385 C580,385 540,426 450,426 C370,426 320,385 216,385"
            fill="none"
            stroke="#2E333C"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray="2 18"
          />
        </svg>

        {nodes.map((node) => {
          const content = (
            <LessonNode
              state={node.state}
              title={node.title}
              subtitle={node.subtitle}
              percent={node.percent}
            />
          );
          return node.state === 'locked' ? (
            <div key={node.id} className={styles.nodeSlot} style={{ left: node.left, top: node.top }}>
              {content}
            </div>
          ) : (
            <Link
              key={node.id}
              to={`/leccion/${node.id}`}
              className={styles.nodeSlot}
              style={{ left: node.left, top: node.top }}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
