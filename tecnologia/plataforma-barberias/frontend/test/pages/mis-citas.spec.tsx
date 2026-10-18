import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import type { components } from '../../src/api/schema-002';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T121 · Mis citas (/mis-citas, RF17): historial con estados, cancelar solo las citas activas futuras y
// vacío con EstadoVacio.

type Cita = components['schemas']['Cita'];

const SLUG = 'barberia-huamanga';
const HORA_MS = 60 * 60 * 1000;
const enLima = (instante: Date) =>
  `${new Date(instante.getTime() - 5 * HORA_MS).toISOString().slice(0, 19)}-05:00`;

const cita = (id: string, cambios: Partial<Cita>): Cita => ({
  id,
  barberia: 'Barbería Huamanga',
  servicio: 'Corte clásico',
  barbero: 'Carlos Ñaupa',
  inicio: enLima(new Date(Date.now() + 48 * HORA_MS)),
  fin: enLima(new Date(Date.now() + 48.5 * HORA_MS)),
  precio: '25.00',
  estado: 'CONFIRMADA',
  cancelacionTardia: false,
  cancelacionTardiaDesde: enLima(new Date(Date.now() + 46 * HORA_MS)),
  origen: 'EN_LINEA',
  ...cambios,
});

const pasado = enLima(new Date(Date.now() - 72 * HORA_MS));

function conSesionYCatalogo() {
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token-cliente',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: {
          id: '0190a1b2-0000-7000-8000-000000000009',
          nombre: 'Luis Huamán',
          correo: 'luis@prueba.pe',
          rol: 'CLIENTE',
          barberia: { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG },
        },
      }),
    ),
    http.get(`/api/v1/publico/${SLUG}`, () =>
      HttpResponse.json({
        barberia: {
          nombre: 'Barbería Huamanga',
          slug: SLUG,
          direccion: null,
          telefono: null,
          descripcion: null,
          zonaHoraria: 'America/Lima',
        },
        horario: { tramos: [] },
        servicios: [],
        barberos: [],
      }),
    ),
  );
}

function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/mis-citas']}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const filaDe = async (texto: string) => (await screen.findByText(texto)).closest('li') as HTMLElement;

afterEach(() => tokenEnMemoria.limpiar());

describe('Mis citas (/mis-citas)', () => {
  it('muestra el historial de la barbería de la sesión con el estado de cada cita', async () => {
    conSesionYCatalogo();
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({
          total: 3,
          pagina: 1,
          tamano: 10,
          elementos: [
            cita('c1', { servicio: 'Corte clásico' }),
            cita('c2', { servicio: 'Arreglo de barba', estado: 'CANCELADA', cancelacionTardia: true }),
            cita('c3', { servicio: 'Corte y lavado', inicio: pasado, fin: pasado, estado: 'COMPLETADA' }),
          ],
        }),
      ),
    );
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: /mis citas/i })).toBeInTheDocument();
    expect(screen.getAllByText(/barbería huamanga/i).length).toBeGreaterThan(0);
    expect(await filaDe('Corte clásico')).toHaveTextContent(/confirmada/i);
    const cancelada = await filaDe('Arreglo de barba');
    expect(cancelada).toHaveTextContent(/cancelada/i);
    expect(cancelada).toHaveTextContent(/cancelación tardía/i);
    expect(await filaDe('Corte y lavado')).toHaveTextContent(/completada/i);
  });

  it('solo las citas activas futuras se pueden cancelar; al confirmar, aparece cancelada', async () => {
    conSesionYCatalogo();
    let cancelada = false;
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({
          total: 3,
          pagina: 1,
          tamano: 10,
          elementos: [
            cita('futura', { servicio: 'Corte clásico', estado: cancelada ? 'CANCELADA' : 'CONFIRMADA' }),
            cita('pasada', { servicio: 'Corte y lavado', inicio: pasado, fin: pasado }),
            cita('hecha', {
              servicio: 'Arreglo de barba',
              inicio: pasado,
              fin: pasado,
              estado: 'COMPLETADA',
            }),
          ],
        }),
      ),
      http.post('/api/v1/citas/futura/cancelar', () => {
        cancelada = true;
        return HttpResponse.json(cita('futura', { estado: 'CANCELADA' }));
      }),
    );
    renderizar();
    const futura = await filaDe('Corte clásico');
    expect(
      within(await filaDe('Corte y lavado')).queryByRole('button', { name: /cancelar/i }),
    ).not.toBeInTheDocument();
    expect(
      within(await filaDe('Arreglo de barba')).queryByRole('button', { name: /cancelar/i }),
    ).not.toBeInTheDocument();

    const usuario = userEvent.setup();
    await usuario.click(within(futura).getByRole('button', { name: /cancelar/i }));
    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent(/no quedará como cancelación tardía/i);
    await usuario.click(within(modal).getByRole('button', { name: /sí, cancelar la cita/i }));
    await within(await filaDe('Corte clásico')).findByText(/cancelada/i);
    expect(
      within(await filaDe('Corte clásico')).queryByRole('button', { name: /cancelar/i }),
    ).not.toBeInTheDocument();
  });

  it('sin citas muestra un estado vacío con el enlace para reservar', async () => {
    conSesionYCatalogo();
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({ total: 0, pagina: 1, tamano: 10, elementos: [] }),
      ),
    );
    renderizar();
    expect(await screen.findByText(/aún no tienes citas/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reservar una cita/i })).toHaveAttribute('href', `/b/${SLUG}`);
  });

  it('pagina el historial: "Anteriores" pide la página siguiente', async () => {
    conSesionYCatalogo();
    const paginas: (string | null)[] = [];
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', ({ request }) => {
        const pagina = new URL(request.url).searchParams.get('pagina');
        paginas.push(pagina);
        return HttpResponse.json({
          total: 12,
          pagina: Number(pagina),
          tamano: 10,
          elementos: [cita(`c${pagina}`, { servicio: `Servicio de la página ${pagina}` })],
        });
      }),
    );
    renderizar();
    await screen.findByText('Servicio de la página 1');
    await userEvent.setup().click(screen.getByRole('button', { name: /anteriores/i }));
    expect(await screen.findByText('Servicio de la página 2')).toBeInTheDocument();
    expect(paginas).toEqual(['1', '2']);
    expect(screen.getByRole('button', { name: /anteriores/i })).toBeDisabled();
  });
});
