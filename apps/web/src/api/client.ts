import type {
  AttemptResult,
  AuthResponse,
  LessonDetail,
  LessonSummary,
  ProgressSummary,
} from './types';

const TOKEN_KEY = 'enlaza.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Error ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  register(email: string, password: string, displayName: string): Promise<AuthResponse> {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
  },
  login(email: string, password: string): Promise<AuthResponse> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  lessons(): Promise<{ lessons: LessonSummary[] }> {
    return request('/api/lessons?language=lsc');
  },
  lesson(id: string): Promise<LessonDetail> {
    return request(`/api/lessons/${encodeURIComponent(id)}`);
  },
  recordAttempt(signId: string, correct: boolean, score?: number): Promise<AttemptResult> {
    return request('/api/attempts', {
      method: 'POST',
      body: JSON.stringify({ signId, correct, score }),
    });
  },
  progress(): Promise<ProgressSummary> {
    return request('/api/me/progress');
  },
};
