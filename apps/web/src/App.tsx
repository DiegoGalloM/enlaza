import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LearningPath } from './pages/LearningPath';
import { Lesson } from './pages/Lesson';
import { Progress } from './pages/Progress';
import { Login } from './pages/Login';
import { Practice } from './pages/Practice';
// Carga perezosa: three.js es pesado y solo lo usa la pantalla de prueba del
// avatar; calibración y tokens son herramientas del equipo, no del flujo de
// quien aprende (D49).
const AvatarPoc = lazy(() =>
  import('./pages/AvatarPoc').then((m) => ({ default: m.AvatarPoc })),
);
const Calibration = lazy(() =>
  import('./pages/Calibration').then((m) => ({ default: m.Calibration })),
);
const DesignTokens = lazy(() =>
  import('./pages/DesignTokens').then((m) => ({ default: m.DesignTokens })),
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
          <Route
            path="/design-tokens"
            element={
              <Suspense fallback={null}>
                <DesignTokens />
              </Suspense>
            }
          />
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
                <Suspense fallback={null}>
                  <Calibration />
                </Suspense>
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
