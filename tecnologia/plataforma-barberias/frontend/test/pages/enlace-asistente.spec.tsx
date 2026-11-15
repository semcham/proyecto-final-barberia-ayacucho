import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T039 de 005 · FR-016 y FR-030: el enlace "Preguntar al asistente" se suma SOLO en Mis citas y en el catálogo público,
// y solo con sesión de CLIENTE en esa barbería. Para un visitante sin sesión, un propietario, un barbero o un cliente de
// otra barbería, esas pantallas quedan exactamente como antes (sin el enlace). Sus pruebas existentes
// (mis-citas.spec.tsx y catalogo-publico.spec.tsx) siguen pasando sin tocarlas.

const SLUG = 'barberia-huamanga';
const ENLACE = 'Preguntar al asistente';

function sesion(rol: 'CLIENTE' | 'PROPIETARIO' | 'BARBERO', slug = SLUG) {
  return http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-0000-7000-8000-000000000009',
        nombre: 'Luis Huamán',
        correo: 'luis@prueba.pe',
        rol,
        barberia: { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería', slug },
      },
    }),
  );
}

const catalogo = http.get(`/api/v1/publico/${SLUG}`, () =>
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
    servicios: [
      { id: 's1', nombre: 'Corte clásico', descripcion: null, precio: '25.00', duracionMinutos: 30 },
    ],
    barberos: [],
  }),
);

const historial = http.get('/api/v1/clientes/yo/citas', () =>
  HttpResponse.json({ total: 0, pagina: 1, tamano: 10, elementos: [] }),
);

function renderizar(ruta: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Enlace "Preguntar al asistente" (T039)', () => {
  it('en Mis citas, para el cliente con sesión, lleva a /asistente', async () => {
    servidor.use(sesion('CLIENTE'), catalogo, historial);
    renderizar('/mis-citas');
    expect(await screen.findByRole('link', { name: ENLACE })).toHaveAttribute('href', '/asistente');
  });

  it('en el catálogo de SU barbería, para el cliente con sesión, lleva a /asistente', async () => {
    servidor.use(sesion('CLIENTE'), catalogo);
    renderizar(`/b/${SLUG}`);
    expect(await screen.findByRole('link', { name: ENLACE })).toHaveAttribute('href', '/asistente');
  });

  it('un visitante sin sesión ve el catálogo como antes, sin el enlace', async () => {
    servidor.use(catalogo);
    renderizar(`/b/${SLUG}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Barbería Huamanga' })).toBeInTheDocument();
    expect(await screen.findByText('Corte clásico')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ENLACE })).not.toBeInTheDocument();
    expect(screen.queryByText(ENLACE)).not.toBeInTheDocument();
  });

  it.each([
    ['un propietario', sesion('PROPIETARIO')],
    ['un barbero', sesion('BARBERO')],
    ['un cliente de otra barbería', sesion('CLIENTE', 'otra-barberia')],
  ])('%s ve el catálogo sin el enlace', async (_caso, manejadorDeSesion) => {
    servidor.use(manejadorDeSesion, catalogo);
    renderizar(`/b/${SLUG}`);
    expect(await screen.findByText('Corte clásico')).toBeInTheDocument();
    expect(screen.queryByText(ENLACE)).not.toBeInTheDocument();
  });

  it('lo demás del catálogo no cambia: el visitante y el cliente ven lo mismo, salvo el enlace y el botón de reserva', async () => {
    servidor.use(catalogo);
    const { container: visitante, unmount } = renderizar(`/b/${SLUG}`);
    await screen.findByText('Corte clásico');
    const encabezadosVisitante = [...visitante.querySelectorAll('h1, h2')].map((h) => h.textContent);
    unmount();
    tokenEnMemoria.limpiar();
    // El 401 de la renovación del visitante quitó la marca de sesión: el cliente vuelve a tenerla.
    indicadorSesion.marcar();
    servidor.use(sesion('CLIENTE'), catalogo);
    const { container: cliente } = renderizar(`/b/${SLUG}`);
    await screen.findByRole('link', { name: ENLACE });
    expect([...cliente.querySelectorAll('h1, h2')].map((h) => h.textContent)).toEqual(encabezadosVisitante);
    expect(cliente.querySelectorAll('a[href="/asistente"]')).toHaveLength(1);
  });
});
