import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_EXPIRED_EVENT, api, getToken, setToken } from '../src/api/client';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('api client (D50)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('con el token vencido cierra la sesión y avisa a la app', async () => {
    setToken('vencido');
    vi.stubGlobal('fetch', respond(401, { error: 'No autenticado' }));
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);

    await expect(api.progress()).rejects.toThrow('No autenticado');
    expect(getToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it('un 401 sin sesión (contraseña equivocada) no dispara el aviso', async () => {
    vi.stubGlobal('fetch', respond(401, { error: 'Correo o contraseña incorrectos' }));
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);

    await expect(api.login('a@b.co', 'equivocada')).rejects.toThrow('Correo o contraseña incorrectos');
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it('por defecto llama al API en el mismo dominio', async () => {
    const fetchMock = respond(200, { lessons: [] });
    vi.stubGlobal('fetch', fetchMock);
    await api.lessons();
    expect(fetchMock).toHaveBeenCalledWith('/api/lessons?language=lsc', expect.anything());
  });
});
