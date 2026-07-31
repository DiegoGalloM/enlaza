import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { apiMock, lessonsFixture, progressFixture, signInStorage } from './mocks';
import { AuthProvider } from '../src/auth/AuthContext';
import { LearningPath } from '../src/pages/LearningPath';

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <LearningPath />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LearningPath', () => {
  it('renders lesson nodes with their statuses from the API', async () => {
    signInStorage();
    apiMock.lessons.mockResolvedValue(lessonsFixture);
    apiMock.progress.mockResolvedValue(progressFixture);

    renderPage();

    expect(await screen.findByText('Alfabeto I')).toBeInTheDocument();
    expect(screen.getByText('Alfabeto II')).toBeInTheDocument();
    // Locked lesson shows "bloqueada" and is not a link.
    expect(screen.getByText('bloqueada')).toBeInTheDocument();
    expect(screen.getByText('Saludos').closest('a')).toBeNull();
    // Unlocked lesson IS a link to its lesson page.
    expect(screen.getByText('Alfabeto II').closest('a')).toHaveAttribute('href', '/leccion/l2');
    // Header: 1 completed of 3, 18 mastered signs, greeting with first name.
    expect(screen.getByText('Señas validadas').previousSibling).toHaveTextContent('18');
    expect(screen.getByText(/Hola de nuevo, Mariana/)).toBeInTheDocument();
    // Continue button targets the first unlocked lesson.
    expect(screen.getByRole('button', { name: /Continuar: Alfabeto II/ })).toBeInTheDocument();
  });

  it('shows the sidebar streak from the progress endpoint', async () => {
    signInStorage();
    apiMock.lessons.mockResolvedValue(lessonsFixture);
    apiMock.progress.mockResolvedValue(progressFixture);

    renderPage();

    expect(await screen.findByText('6 días')).toBeInTheDocument();
  });
});
