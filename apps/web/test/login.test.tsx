import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { apiMock } from './mocks';
import { AuthProvider } from '../src/auth/AuthContext';
import { Login } from '../src/pages/Login';

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('Login', () => {
  it('submits credentials and stores the session', async () => {
    apiMock.login.mockResolvedValue({
      token: 'tok-1',
      user: { id: 'u1', email: 'demo@enlaza.app', displayName: 'Mariana C.' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Correo'), 'demo@enlaza.app');
    await user.type(screen.getByLabelText('Contraseña'), 'enlaza-demo');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(apiMock.login).toHaveBeenCalledWith('demo@enlaza.app', 'enlaza-demo');
  });

  it('shows the API error when credentials are wrong', async () => {
    apiMock.login.mockRejectedValue(new Error('Correo o contraseña incorrectos'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Correo'), 'demo@enlaza.app');
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta-1');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeInTheDocument();
  });

  it('switches to registration mode with a name field', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /No tienes cuenta/ }));
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeInTheDocument();
  });
});
