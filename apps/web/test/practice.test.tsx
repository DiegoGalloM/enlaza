/**
 * Lesson-flow test with the CV pipeline mocked (README §7): a fake detector
 * feeds scripted hand frames, so the full practice loop — detect → validate
 * → record attempt → offer next sign — runs without a camera.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { buildStaticTemplate, euclideanDistance, toFeatureVector } from '@enlaza/cv-model';
import type { HandFrame, Landmark } from '@enlaza/cv-model';
import { apiMock, lessonDetailFixture, signInStorage } from './mocks';
import type { FrameListener } from '../src/cv/detector';
import { Practice } from '../src/pages/Practice';

function makePose(seed: number): Landmark[] {
  const wrist = { x: 0.5, y: 0.6, z: 0 };
  const pose: Landmark[] = [wrist];
  for (let i = 1; i < 21; i++) {
    pose.push({
      x: 0.3 + ((i * seed) % 7) * 0.04,
      y: 0.55 - ((i * (seed + 3)) % 5) * 0.05,
      z: 0,
    });
  }
  pose[9] = { x: 0.52, y: 0.45, z: 0 };
  return pose;
}

const poseA = makePose(2);
const poseB = makePose(5);
/** Proporción de la "cámara" del detector falso (la que pide la app). */
const ASPECT = 16 / 9;

function installTemplates(): void {
  const templates = [
    buildStaticTemplate('s1', [toFeatureVector(poseA, 'Right', ASPECT)]),
    buildStaticTemplate('s2', [toFeatureVector(poseB, 'Right', ASPECT)]),
  ];
  localStorage.setItem(
    'enlaza.templates.lsc.v2',
    JSON.stringify({ version: 2, templates }),
  );
}

/** Plantillas grabadas antes de corregir la proporción (features v1). */
function installLegacyTemplates(): void {
  const templates = [
    buildStaticTemplate('s1', [toFeatureVector(poseA, 'Right', 1)]),
    buildStaticTemplate('s2', [toFeatureVector(poseB, 'Right', 1)]),
  ];
  localStorage.setItem(
    'enlaza.templates.lsc.v1',
    JSON.stringify({ version: 1, templates }),
  );
}

function installFakeDetector(): {
  emit: (frame: HandFrame | null) => void;
  starts: () => number;
} {
  let listener: FrameListener | null = null;
  let starts = 0;
  window.__enlazaFakeDetector = () => ({
    needsCamera: false,
    aspect: ASPECT,
    start: async (_video, onFrame) => {
      starts++;
      listener = onFrame;
    },
    stop: () => {
      listener = null;
    },
  });
  return {
    // El detector entrega todas las manos del frame (D38); aquí, siempre una.
    emit: (frame) => {
      listener?.(
        frame
          ? {
              hands: [{ landmarks: frame.landmarks, handedness: frame.handedness }],
              timestampMs: frame.timestampMs,
              aspect: frame.aspect,
            }
          : null,
      );
    },
    starts: () => starts,
  };
}

function renderPractice(url = '/leccion/l1/practica?sign=s1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/leccion/:lessonId/practica" element={<Practice />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Practice', () => {
  it('validates a held static sign and records the attempt', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);
    apiMock.recordAttempt.mockResolvedValue({
      signId: 's1',
      mastered: true,
      lesson: { id: 'l1', masteredCount: 1, signCount: 2, completed: false },
    });

    renderPractice();
    await screen.findByText(/Muestra tu mano/);
    // Las plantillas empaquetadas cargan async: esperar a que el detector
    // arranque (el aviso de cámara desaparece) antes de emitir frames.
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );

    // Hold the target sign for the required frames (default holdFrames = 8).
    await act(async () => {
      for (let i = 0; i < 9; i++) {
        detector.emit({ landmarks: poseA, handedness: 'Right', timestampMs: i * 33, aspect: ASPECT });
      }
    });

    const verdict = await screen.findByText(/¡Correcta! Seña A validada/);
    // El puntaje se muestra como nivel en palabras, no como porcentaje.
    expect(verdict).toHaveTextContent(/· (Bien|Muy bien|Excelente)$/);
    expect(verdict).not.toHaveTextContent('%');
    await waitFor(() => {
      expect(apiMock.recordAttempt).toHaveBeenCalledWith('s1', true, expect.any(Number));
    });
    // Offers the next unmastered sign of the lesson.
    expect(await screen.findByRole('button', { name: /Siguiente seña: B/ })).toBeInTheDocument();
  });

  it('permite reintentar la seña validada sin reiniciar la cámara', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);
    apiMock.recordAttempt.mockResolvedValue({
      signId: 's1',
      mastered: true,
      lesson: { id: 'l1', masteredCount: 1, signCount: 2, completed: false },
    });

    renderPractice();
    await screen.findByText(/Muestra tu mano/);
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );
    const holdSign = async () => {
      await act(async () => {
        for (let i = 0; i < 9; i++) {
          detector.emit({ landmarks: poseA, handedness: 'Right', timestampMs: i * 33, aspect: ASPECT });
        }
      });
    };

    await holdSign();
    await screen.findByText(/¡Correcta! Seña A validada/);
    await waitFor(() => expect(apiMock.recordAttempt).toHaveBeenCalledTimes(1));

    await act(async () => {
      screen.getByRole('button', { name: 'Reintentar la seña' }).click();
    });
    // Vuelve a esperar la seña: ya no dice "Correcta" ni ofrece reintentar.
    expect(await screen.findByText(/Muestra tu mano/)).toBeInTheDocument();
    expect(screen.queryByText(/¡Correcta!/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar la seña' })).not.toBeInTheDocument();

    // Un solo frame no basta: la validación empezó de cero.
    await act(async () => {
      detector.emit({ landmarks: poseA, handedness: 'Right', timestampMs: 0, aspect: ASPECT });
    });
    expect(screen.queryByText(/¡Correcta!/)).not.toBeInTheDocument();

    await holdSign();
    await screen.findByText(/¡Correcta! Seña A validada/);
    // Cada acierto es un intento propio, y la cámara nunca se reinició.
    await waitFor(() => expect(apiMock.recordAttempt).toHaveBeenCalledTimes(2));
    expect(detector.starts()).toBe(1);
  });

  it('con la seña equivocada no avisa nada durante la gracia de intento (D46)', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);

    renderPractice();
    await screen.findByText(/Muestra tu mano/);
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );

    // La seña equivocada (s2 = "B") sostenida más que retryFrames (20), pero
    // menos que la gracia: el validador ya la reconoce, la práctica todavía calla.
    await act(async () => {
      for (let i = 0; i < 60; i++) {
        detector.emit({ landmarks: poseB, handedness: 'Right', timestampMs: i * 33, aspect: ASPECT });
      }
    });

    expect(screen.getByText(/Te vemos — haz la seña A/)).toBeInTheDocument();
    expect(screen.queryByText(/Se parece a/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver la seña otra vez' })).not.toBeInTheDocument();
  });

  it('pasada la gracia, nombra en amarillo la seña que reconoció (D46)', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);

    renderPractice();
    await screen.findByText(/Muestra tu mano/);
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );

    // Más de 5 s de intento con la seña equivocada.
    await act(async () => {
      for (let i = 0; i < 160; i++) {
        detector.emit({ landmarks: poseB, handedness: 'Right', timestampMs: i * 33, aspect: ASPECT });
      }
    });

    const nudge = await screen.findByText(/Se parece a "B" — intenta otra vez A/);
    expect(nudge.className).toMatch(/statusNudge/);
    expect(screen.getByRole('button', { name: 'Ver la seña otra vez' })).toBeInTheDocument();
    expect(apiMock.recordAttempt).not.toHaveBeenCalled();
  });

  it('con ?detalle=1 descarga el intento con los frames del detector (D45)', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);

    renderPractice('/leccion/l1/practica?sign=s1&detalle=1');
    await screen.findByText(/Muestra tu mano/);
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );
    await act(async () => {
      detector.emit({ landmarks: poseB, handedness: 'Right', timestampMs: 0, aspect: ASPECT });
      detector.emit({ landmarks: poseB, handedness: 'Right', timestampMs: 33, aspect: ASPECT });
    });

    let blob: Blob | null = null;
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blob = b;
        return 'blob:intento';
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    screen.getByRole('button', { name: /Descargar intento/ }).click();

    expect(click).toHaveBeenCalledOnce();
    const payload = JSON.parse(await blob!.text());
    expect(payload).toMatchObject({ kind: 'enlaza-intento', signId: 's1' });
    expect(payload.frames).toHaveLength(2);
    expect(payload.frames[0]).toMatchObject({ t: 0, aspect: ASPECT, hands: [{ handedness: 'Right' }] });
    // Las plantillas de esta prueba están en localStorage: grabadas en el dispositivo.
    expect(screen.getByText(/Plantilla grabada en este dispositivo/)).toBeInTheDocument();
    click.mockRestore();
  });

  it('sin ?detalle=1 no ofrece descargar el intento', async () => {
    signInStorage();
    installTemplates();
    installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);

    renderPractice();
    await screen.findByText(/Muestra tu mano/);
    expect(screen.queryByRole('button', { name: /Descargar intento/ })).not.toBeInTheDocument();
  });

  it('migra al abrir la cámara las plantillas grabadas antes de corregir la proporción', async () => {
    signInStorage();
    installLegacyTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);
    apiMock.recordAttempt.mockResolvedValue({
      signId: 's1',
      mastered: true,
      lesson: { id: 'l1', masteredCount: 1, signCount: 2, completed: false },
    });

    renderPractice();
    // La plantilla v1 cuenta como existente: no se ofrece el camino sin validación.
    await screen.findByText(/Muestra tu mano/);
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );

    await act(async () => {
      for (let i = 0; i < 9; i++) {
        detector.emit({ landmarks: poseA, handedness: 'Right', timestampMs: i * 33, aspect: ASPECT });
      }
    });

    expect(await screen.findByText(/¡Correcta! Seña A validada/)).toBeInTheDocument();
    // Quedan guardadas como v2 y la copia v1 desaparece.
    expect(localStorage.getItem('enlaza.templates.lsc.v1')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('enlaza.templates.lsc.v2')!);
    expect(stored.version).toBe(2);
    expect(stored.templates.map((t: { signId: string }) => t.signId).sort()).toEqual(['s1', 's2']);
    // Y migradas con la proporción de la cámara: iguales a grabarlas hoy con ella.
    const s1 = stored.templates.find((t: { signId: string }) => t.signId === 's1');
    const expected = toFeatureVector(poseA, 'Right', ASPECT);
    expect(euclideanDistance(s1.vector, expected)).toBeLessThan(1e-9);
  });

  it('offers the no-validation path when the sign has no template', async () => {
    signInStorage();
    // No templates installed.
    installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);
    apiMock.recordAttempt.mockResolvedValue({
      signId: 's1',
      mastered: true,
      lesson: { id: 'l1', masteredCount: 1, signCount: 2, completed: false },
    });

    renderPractice();

    const button = await screen.findByRole('button', {
      name: /Marcar practicada \(sin validación\)/,
    });
    await act(async () => {
      button.click();
    });
    await waitFor(() => {
      expect(apiMock.recordAttempt).toHaveBeenCalledWith('s1', true, undefined);
    });
  });
});
