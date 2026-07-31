/**
 * Lesson-flow test with the CV pipeline mocked (README §7): a fake detector
 * feeds scripted hand frames, so the full practice loop — detect → validate
 * → record attempt → offer next sign — runs without a camera.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { buildStaticTemplate, toFeatureVector } from '@enlaza/cv-model';
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

function installTemplates(): void {
  const templates = [
    buildStaticTemplate('s1', [toFeatureVector(poseA, 'Right')]),
    buildStaticTemplate('s2', [toFeatureVector(poseB, 'Right')]),
  ];
  localStorage.setItem(
    'enlaza.templates.lsc.v1',
    JSON.stringify({ version: 1, templates }),
  );
}

function installFakeDetector(): { emit: (frame: HandFrame | null) => void } {
  let listener: FrameListener | null = null;
  window.__enlazaFakeDetector = () => ({
    needsCamera: false,
    start: async (_video, onFrame) => {
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

    // Hold the target sign for the required frames (default holdFrames = 8).
    await act(async () => {
      for (let i = 0; i < 9; i++) {
        detector.emit({ landmarks: poseA, handedness: 'Right', timestampMs: i * 33 });
      }
    });

    expect(await screen.findByText(/¡Correcta! Seña A validada/)).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMock.recordAttempt).toHaveBeenCalledWith('s1', true, expect.any(Number));
    });
    // Offers the next unmastered sign of the lesson.
    expect(await screen.findByRole('button', { name: /Siguiente seña: B/ })).toBeInTheDocument();
  });

  it('suggests a retry when the user holds the wrong sign', async () => {
    signInStorage();
    installTemplates();
    const detector = installFakeDetector();
    apiMock.lesson.mockResolvedValue(lessonDetailFixture);

    renderPractice();
    await screen.findByText(/Muestra tu mano/);

    // Hold the WRONG sign (s2 = "B") past retryFrames (default 20).
    await act(async () => {
      for (let i = 0; i < 21; i++) {
        detector.emit({ landmarks: poseB, handedness: 'Right', timestampMs: i * 33 });
      }
    });

    expect(await screen.findByText(/parece "B"/)).toBeInTheDocument();
    expect(apiMock.recordAttempt).not.toHaveBeenCalled();
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
