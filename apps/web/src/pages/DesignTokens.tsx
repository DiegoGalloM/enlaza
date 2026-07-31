import styles from './DesignTokens.module.css';

const tokens = [
  { hex: '#0E1014', label: 'lienzo', bg: '#0E1014', border: '1px solid #262B33' },
  { hex: '#14161B', label: 'pantalla', bg: '#14161B' },
  { hex: '#1B1E24', label: 'tarjeta', bg: '#1B1E24' },
  { hex: '#22262E', label: 'capa alta', bg: '#22262E' },
  { hex: '#93B6EF', label: 'azul +1', bg: '#93B6EF' },
  { hex: '#7FD3AE', label: 'verde +1', bg: '#7FD3AE' },
  { hex: '#F4A9C4', label: 'rosa igual', bg: '#F4A9C4' },
  { hex: '#F1EFEA', label: 'texto', bg: '#F1EFEA' },
];

/**
 * Internal reference page (not linked from the main nav): reproduces the
 * dark-theme token swatches and rules from "Enlaza - Modo oscuro.dc.html"
 * so the palette stays checkable against the design source as it evolves.
 */
export function DesignTokens() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.eyebrow}>Tokens oscuros</span>
        <div className={styles.grid}>
          {tokens.map((token) => (
            <div key={token.hex} className={styles.swatchWrap}>
              <span
                className={styles.swatch}
                style={{ background: token.bg, border: token.border }}
              />
              <span className={styles.swatchLabel}>
                {token.hex}
                <br />
                {token.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.rulesCard}>
        <span className={styles.rulesTitle}>Reglas del tema</span>
        <p className={styles.rulesBody}>
          Los pasteles nunca van como fondo grande en oscuro: solo trazo, píldora o relleno de
          nodo. Los botones primarios usan azul +1 con texto azul oscuro, no blanco. El estado
          bloqueado baja opacidad, nunca cambia de forma. La práctica con cámara es siempre
          oscura, en ambos temas.
        </p>
      </div>
    </div>
  );
}
