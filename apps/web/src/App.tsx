import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LearningPath } from './pages/LearningPath';
import { Lesson } from './pages/Lesson';
import { Progress } from './pages/Progress';
import { DesignTokens } from './pages/DesignTokens';
import { Login } from './pages/Login';
import { Practice } from './pages/Practice';
import { Calibration } from './pages/Calibration';
// Carga perezosa: three.js es pesado y solo lo usa la pantalla de prueba del avatar.
const AvatarPoc = lazy(() =>
  import('./pages/AvatarPoc').then((m) => ({ default: m.AvatarPoc })),
);

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/design-tokens" element={<DesignTokens />} />
          <Route
            path="/avatar-poc"
            element={
              <Suspense fallback={null}>
                <AvatarPoc />
              </Suspense>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <LearningPath />
              </RequireAuth>
            }
          />
          <Route
            path="/leccion/:lessonId"
            element={
              <RequireAuth>
                <Lesson />
              </RequireAuth>
            }
          />
          <Route
            path="/leccion/:lessonId/practica"
            element={
              <RequireAuth>
                <Practice />
              </RequireAuth>
            }
          />
          <Route
            path="/plantillas"
            element={
              <RequireAuth>
                <Calibration />
              </RequireAuth>
            }
          />
          <Route
            path="/progreso"
            element={
              <RequireAuth>
                <Progress />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
