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
    'enlaza.templates.lsc.v2',
    JSON.stringify({ version: 2, templates: [{ signId, type: 'static', vector }] }),
  );

  window.__enlazaFakeDetector = () => {
    let timer = null;
    return {
      needsCamera: false,
      aspect: 1,
      start: async (_video, onFrame) => {
        let t = 0;
        timer = setInterval(() => {
          t += 33;
          onFrame({ landmarks: pose, handedness: 'Right', timestampMs: t, aspect: 1 });
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

  // Ruta de aprendizaje: la primera lección del orden ICAL es el bautizo.
  await expect(page.getByText('Hola de nuevo, Prueba')).toBeVisible();
  await expect(page.getByRole('link', { name: /Bautizo/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar: Bautizo' }).click();

  // Bautizo: el nombre-seña es personal (sin plantilla incluida), así que la
  // práctica ofrece el camino sin validación.
  await expect(page.getByRole('heading', { name: 'Mi nombre-seña' })).toBeVisible();
  await page.getByRole('button', { name: 'Practicar con cámara' }).click();
  await page.getByRole('button', { name: /Marcar practicada/ }).click();
  await expect(page.getByRole('button', { name: 'Volver a la lección' })).toBeVisible();

  // Completar el bautizo desbloquea la lección de cortesía (orden ICAL).
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continuar: Normas de cortesía' })).toBeVisible();

  // Lección de abecedario: seña A, con aviso de contenido provisional.
  await page.goto('/leccion/lsc-alfabeto-1');
  await expect(page.getByRole('heading', { name: 'A', exact: true })).toBeVisible();
  await expect(page.getByText(/Contenido provisional/)).toBeVisible();
  await page.getByRole('button', { name: 'Practicar con cámara' }).click();

  // Práctica: el detector falso "hace" la seña y el validador la acepta.
  await expect(page.getByText(/¡Correcta! Seña A validada/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Siguiente seña: B/ })).toBeVisible();

  // Progreso: bautizo + letra A dominadas aparecen en el resumen.
  await page.goto('/progreso');
  await expect(page.getByRole('heading', { name: /2 señas de LSC/ })).toBeVisible();
  await expect(page.getByText('Dominio por lección')).toBeVisible();
});
