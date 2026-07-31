import { expect, test } from '@playwright/test';

/**
 * Injected before any page script runs: builds a deterministic hand pose,
 * stores its template (same normalization math as @enlaza/cv-model), and
 * installs a fake detector that "performs" that pose continuously.
 */
const INIT_SCRIPT = `
(() => {
  const pose = [{ x: 0.5, y: 0.6, z: 0 }];
  for (let i = 1; i < 21; i++) {
    pose.push({ x: 0.3 + ((i * 2) % 7) * 0.04, y: 0.55 - ((i * 5) % 5) * 0.05, z: 0 });
  }
  pose[9] = { x: 0.52, y: 0.45, z: 0 };

  const wrist = pose[0];
  const middle = pose[9];
  const scale = Math.hypot(middle.x - wrist.x, middle.y - wrist.y, middle.z - wrist.z) || 1;
  const vector = [];
  for (const p of pose) {
    vector.push((p.x - wrist.x) / scale, (p.y - wrist.y) / scale, (p.z - wrist.z) / scale);
  }

  const signId = 'lsc-alfabeto-1-0'; // letra A, estática
  localStorage.setItem(
    'enlaza.templates.lsc.v1',
    JSON.stringify({ version: 1, templates: [{ signId, type: 'static', vector }] }),
  );

  window.__enlazaFakeDetector = () => {
    let timer = null;
    return {
      needsCamera: false,
      start: async (_video, onFrame) => {
        let t = 0;
        timer = setInterval(() => {
          t += 33;
          onFrame({ landmarks: pose, handedness: 'Right', timestampMs: t });
        }, 33);
      },
      stop: () => {
        if (timer !== null) clearInterval(timer);
      },
    };
  };
})();
`;

test('registro → lección → práctica validada por CV → progreso', async ({ page }) => {
  await page.addInitScript(INIT_SCRIPT);

  // Registro de un usuario nuevo (DB en memoria: siempre limpio).
  await page.goto('/login');
  await page.getByRole('button', { name: /No tienes cuenta/ }).click();
  await page.getByLabel('Nombre').fill('Prueba E2E');
  await page.getByLabel('Correo').fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel('Contraseña').fill('secreta-e2e-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // Ruta de aprendizaje: saludo + primera lección desbloqueada.
  await expect(page.getByText('Hola de nuevo, Prueba')).toBeVisible();
  await expect(page.getByRole('link', { name: /Alfabeto I\b/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar: Alfabeto I' }).click();

  // Lección: seña A, con aviso de contenido provisional.
  await expect(page.getByRole('heading', { name: 'A', exact: true })).toBeVisible();
  await expect(page.getByText(/Contenido provisional/)).toBeVisible();
  await page.getByRole('button', { name: 'Practicar con cámara' }).click();

  // Práctica: el detector falso "hace" la seña y el validador la acepta.
  await expect(page.getByText(/¡Correcta! Seña A validada/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Siguiente seña: B/ })).toBeVisible();

  // Progreso: la seña dominada aparece en el resumen.
  await page.goto('/progreso');
  await expect(page.getByRole('heading', { name: /1 señas de LSC/ })).toBeVisible();
  await expect(page.getByText('Dominio por lección')).toBeVisible();
});
