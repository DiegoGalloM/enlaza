export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type LessonStatus = 'completed' | 'unlocked' | 'locked';

export interface LessonSummary {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  position: number;
  signCount: number;
  masteredCount: number;
  status: LessonStatus;
}

export interface Sign {
  id: string;
  gloss: string;
  description: string;
  signType: 'static' | 'dynamic';
  position: number;
  validated: boolean;
  mastered: boolean;
}

export interface LessonDetail {
  lesson: { id: string; slug: string; title: string; subtitle: string | null; position: number };
  signs: Sign[];
}

export interface AttemptResult {
  signId: string;
  mastered: boolean;
  lesson: { id: string; masteredCount: number; signCount: number; completed: boolean };
}

export interface ProgressSummary {
  displayName: string;
  totalMastered: number;
  totalSigns: number;
  streakDays: number;
  weekActivity: { date: string; active: boolean }[];
  lessons: { id: string; title: string; signCount: number; masteredCount: number; percent: number }[];
  achievements: { id: string; title: string; detail: string; earned: boolean }[];
}
