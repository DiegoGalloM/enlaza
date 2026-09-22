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
    emit: (frame) => {
      listener?.(frame);
    },
    starts: () => starts,
  };
}

function renderPractice() {
  return render(
    <MemoryRouter initialEntries={['/leccion/l1/practica?sign=s1']}>
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

  it('suggests a retry when the user holds the wrong sign', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);

    renderPractice();
    await screen.findByText(/Muestra tu mano/);
    await waitFor(() =>
      expect(screen.queryByText(/Iniciando cámara/)).not.toBeInTheDocument(),
    );

    // Hold the WRONG sign (s2 = "B") past retryFrames (default 20).
    await act(async () => {
      for (let i = 0; i < 21; i++) {
        detector.emit({ landmarks: poseB, handedness: 'Right', timestampMs: i * 33, aspect: ASPECT });
      }
    });

    expect(await screen.findByText(/parece "B"/)).toBeInTheDocument();
    expect(apiMock.recordAttempt).not.toHaveBeenCalled();
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
