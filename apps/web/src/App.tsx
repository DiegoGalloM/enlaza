import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LearningPath } from './pages/LearningPath';
import { Lesson } from './pages/Lesson';
import { Progress } from './pages/Progress';
import { DesignTokens } from './pages/DesignTokens';
import { Login } from './pages/Login';

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
