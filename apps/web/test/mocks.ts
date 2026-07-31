import { vi } from 'vitest';
import type { LessonDetail, LessonSummary, ProgressSummary } from '../src/api/types';

/**
 * Module mock for the API client: tests drive the UI against canned data,
 * never a live backend (README §7 — frontend tests mock the network/CV).
 */
export const apiMock = {
  login: vi.fn(),
  register: vi.fn(),
  lessons: vi.fn(),
  lesson: vi.fn(),
  recordAttempt: vi.fn(),
  progress: vi.fn(),
};

vi.mock('../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getToken: () => localStorage.getItem('enlaza.token'),
  setToken: (token: string | null) => {
    if (token === null) localStorage.removeItem('enlaza.token');
    else localStorage.setItem('enlaza.token', token);
  },
  api: apiMock,
}));

export function signInStorage(displayName = 'Mariana C.'): void {
  localStorage.setItem('enlaza.token', 'test-token');
  localStorage.setItem(
    'enlaza.user',
    JSON.stringify({ id: 'u1', email: 'test@example.com', displayName }),
  );
}

export const lessonsFixture: { lessons: LessonSummary[] } = {
  lessons: [
    { id: 'l1', slug: 'alfabeto-1', title: 'Alfabeto I', subtitle: 'A – M', position: 0, signCount: 13, masteredCount: 13, status: 'completed' },
    { id: 'l2', slug: 'alfabeto-2', title: 'Alfabeto II', subtitle: 'N – Z', position: 1, signCount: 14, masteredCount: 5, status: 'unlocked' },
    { id: 'l3', slug: 'saludos', title: 'Saludos', subtitle: '8 señas', position: 2, signCount: 8, masteredCount: 0, status: 'locked' },
  ],
};

export const progressFixture: ProgressSummary = {
  displayName: 'Mariana C.',
  totalMastered: 18,
  totalSigns: 73,
  streakDays: 6,
  weekActivity: [
    { date: '2026-07-27', active: true },
    { date: '2026-07-28', active: true },
    { date: '2026-07-29', active: true },
    { date: '2026-07-30', active: true },
    { date: '2026-07-31', active: true },
    { date: '2026-08-01', active: true },
    { date: '2026-08-02', active: false },
  ],
  lessons: [
    { id: 'l1', title: 'Alfabeto I', signCount: 13, masteredCount: 13, percent: 100 },
    { id: 'l2', title: 'Alfabeto II', signCount: 14, masteredCount: 5, percent: 36 },
  ],
  achievements: [
    { id: 'alfabeto-completo', title: 'Alfabeto completo', detail: '27 letras validadas', earned: false },
    { id: 'primera-semana', title: 'Primera semana', detail: '6 días de práctica', earned: true },
    { id: 'conversacion-basica', title: 'Conversación básica', detail: 'al terminar el nivel 1', earned: false },
  ],
};

export const lessonDetailFixture: LessonDetail = {
  lesson: { id: 'l1', slug: 'alfabeto-1', title: 'Alfabeto I', subtitle: 'A – M', position: 0 },
  signs: [
    { id: 's1', gloss: 'A', description: 'Seña de "A" en LSC.', signType: 'static', position: 0, validated: false, mastered: false },
    { id: 's2', gloss: 'B', description: 'Seña de "B" en LSC.', signType: 'static', position: 1, validated: false, mastered: false },
  ],
};
