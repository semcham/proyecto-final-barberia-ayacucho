import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, llamarApi, tokenEnMemoria } from '../../src/api/client';
import { servidor } from '../setup';

// Cliente HTTP (T053): token en memoria, una sola renovación ante 401 y errores tipados.

describe('llamarApi', () => {
  afterEach(() => tokenEnMemoria.limpiar());

  it('envía el token de acceso guardado en memoria', async () => {
    tokenEnMemoria.fijar('token-a');
    servidor.use(
      http.get('/api/v1/auth/yo', ({ request }) =>
        HttpResponse.json({ autorizacion: request.headers.get('Authorization') }),
      ),
    );
    await expect(llamarApi('/auth/yo')).resolves.toEqual({ autorizacion: 'Bearer token-a' });
  });

  it('ante un 401 renueva la sesión una sola vez y repite la llamada con el token nuevo', async () => {
    tokenEnMemoria.fijar('vencido');
    let renovaciones = 0;
    servidor.use(
      http.post('/api/v1/auth/refresh', () => {
        renovaciones += 1;
        return HttpResponse.json({ tokenAcceso: 'nuevo', tipo: 'Bearer', expiraEn: 900, usuario: {} });
      }),
      http.get('/api/v1/auth/yo', ({ request }) =>
        request.headers.get('Authorization') === 'Bearer nuevo'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ codigo: 'NO_AUTENTICADO', mensaje: 'x', detalles: [] }, { status: 401 }),
      ),
    );
    await expect(Promise.all([llamarApi('/auth/yo'), llamarApi('/auth/yo')])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(renovaciones).toBe(1);
    expect(tokenEnMemoria.obtener()).toBe('nuevo');
  });

  it('si la renovación falla, limpia el token y lanza NO_AUTENTICADO', async () => {
    tokenEnMemoria.fijar('vencido');
    servidor.use(
      http.get('/api/v1/auth/yo', () =>
        HttpResponse.json(
          { codigo: 'NO_AUTENTICADO', mensaje: 'Inicia sesión para continuar.', detalles: [] },
          { status: 401 },
        ),
      ),
    );
    await expect(llamarApi('/auth/yo')).rejects.toMatchObject({ estado: 401, codigo: 'NO_AUTENTICADO' });
    expect(tokenEnMemoria.obtener()).toBeNull();
  });

  it('convierte el formato de error del contrato en ApiError, con Retry-After', async () => {
    servidor.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Espera.', detalles: [] },
          { status: 429, headers: { 'Retry-After': '60' } },
        ),
      ),
    );
    const error = await llamarApi('/auth/login', { metodo: 'POST', cuerpo: {}, sinRenovar: true }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ estado: 429, codigo: 'DEMASIADOS_INTENTOS', reintentarEnSegundos: 60 });
  });

  it('devuelve undefined en respuestas 204', async () => {
    servidor.use(http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })));
    await expect(llamarApi('/auth/logout', { metodo: 'POST' })).resolves.toBeUndefined();
  });
});
