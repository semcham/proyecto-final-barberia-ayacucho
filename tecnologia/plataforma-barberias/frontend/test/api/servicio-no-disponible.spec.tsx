import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ApiError, llamarApi } from '../../src/api/client';
import CatalogoPublico from '../../src/pages/publico/CatalogoPublico';
import { servidor } from '../setup';

// T021 · FR-007 de 006 (ADR-030): cuando ninguna réplica responde, el balanceador devuelve 503
// SERVICIO_NO_DISPONIBLE con Retry-After; la interfaz lo muestra como tal, no como un error inesperado.

const MENSAJE = 'El servicio no está disponible en este momento. Intenta de nuevo en unos segundos.';

const respuestaDelBalanceador = () =>
  HttpResponse.json(
    { codigo: 'SERVICIO_NO_DISPONIBLE', mensaje: MENSAJE, detalles: [] },
    { status: 503, headers: { 'Retry-After': '5' } },
  );

describe('503 SERVICIO_NO_DISPONIBLE del balanceador', () => {
  it('llega como ApiError con su código, su mensaje y el tiempo de espera', async () => {
    servidor.use(http.get('/api/v1/publico/:slug', respuestaDelBalanceador));
    const error = await llamarApi('/publico/barberia-huamanga', { sinRenovar: true }).catch(
      (causa: unknown) => causa,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      estado: 503,
      codigo: 'SERVICIO_NO_DISPONIBLE',
      message: MENSAJE,
      reintentarEnSegundos: 5,
    });
  });

  it('la página pública muestra el mensaje del balanceador, no un error inesperado', async () => {
    servidor.use(http.get('/api/v1/publico/:slug', respuestaDelBalanceador));
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/b/barberia-huamanga']}>
          <Routes>
            <Route path="/b/:slug" element={<CatalogoPublico />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(MENSAJE)).toBeInTheDocument();
    expect(screen.queryByText(/barbería no disponible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ocurrió un error inesperado/i)).not.toBeInTheDocument();
  });
});
