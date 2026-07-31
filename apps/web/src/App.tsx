import { BrowserRouter, Route, Routes } from 'react-router';
import { LearningPath } from './pages/LearningPath';
import { Lesson } from './pages/Lesson';
import { Progress } from './pages/Progress';
import { DesignTokens } from './pages/DesignTokens';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LearningPath />} />
        <Route path="/leccion/:lessonId" element={<Lesson />} />
        <Route path="/progreso" element={<Progress />} />
        <Route path="/design-tokens" element={<DesignTokens />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
