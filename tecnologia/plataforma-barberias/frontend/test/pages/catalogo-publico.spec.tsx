import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import type { components } from '../../src/api/schema-002';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import CatalogoPublico from '../../src/pages/publico/CatalogoPublico';
import { diasDeAtencion } from '../../src/pages/publico/horario-atencion';
import { ultimaBarberia } from '../../src/ultima-barberia';
import { servidor } from '../setup';

// Presentación pública de la barbería (/b/:slug; RF10; decisión de producto del 2026-11-24): sin sesión de cliente
// solo se ve la barbería (datos, horario de atención, servicios y equipo). Los horarios libres y la reserva están en el
// panel del cliente: aquí solo se invita a ingresar o crear la cuenta, y nunca se piden horarios libres.

type Catalogo = components['schemas']['CatalogoPublico'];

const SLUG = 'barberia-huamanga';
const CORTE = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBA = '0190a1b2-c3d4-7e5f-8a9b-000000000003';
const CARLOS = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const ROSA = '0190a1b2-c3d4-7e5f-8a9b-000000000004';
const ZONA = 'America/Lima';

const CATALOGO: Catalogo = {
  barberia: {
    nombre: 'Barbería Huamanga',
    slug: SLUG,
    direccion: 'Jr. Asamblea 120, Ayacucho',
    telefono: '066 312345',
    descripcion: 'Cortes clásicos y modernos.',
    zonaHoraria: ZONA,
  },
  horario: {
    tramos: [
      { diaSemana: 2, inicio: '15:00', fin: '19:00' },
      { diaSemana: 2, inicio: '09:00', fin: '13:00' },
      { diaSemana: 6, inicio: '09:00', fin: '18:00' },
    ],
  },
  servicios: [
    {
      id: CORTE,
      nombre: 'Corte clásico',
      descripcion: 'Con tijera y máquina.',
      precio: '25.00',
      duracionMinutos: 30,
    },
    { id: BARBA, nombre: 'Arreglo de barba', descripcion: null, precio: '15.00', duracionMinutos: 15 },
  ],
  barberos: [
    { id: CARLOS, nombre: 'Carlos Ñaupa', servicioIds: [CORTE, BARBA] },
    { id: ROSA, nombre: 'Rosa Quispe', servicioIds: [CORTE] },
  ],
};

const sesionCliente = (slug = SLUG) => ({
  tokenAcceso: 'token-cliente',
  tipo: 'Bearer',
  expiraEn: 900,
  usuario: {
    correoVerificado: true,
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    nombre: 'Luis Huamán',
    correo: 'luis@prueba.pe',
    rol: 'CLIENTE',
    barberia: { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Otra o esta', slug },
  },
});

function RutaActual() {
  const { pathname, search } = useLocation();
  return <span data-testid="ruta">{pathname + search}</span>;
}

function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/b/${SLUG}`]}>
        <SesionProvider>
          <Routes>
            <Route path="/b/:slug" element={<CatalogoPublico />} />
            <Route path="/b/:slug/registro" element={<h1>Registro de cliente</h1>} />
            <Route path="/b/:slug/ingresar" element={<h1>Ingreso de cliente</h1>} />
            <Route path="/b/:slug/reservar" element={<h1>Reserva</h1>} />
            <Route path="/mis-citas" element={<h1>Mis citas</h1>} />
          </Routes>
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** El catálogo de prueba; cuenta las solicitudes de horarios libres (la presentación no debe pedir ninguna). */
function simularApi(catalogo: Catalogo = CATALOGO) {
  const horarios: string[] = [];
  servidor.use(
    http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(catalogo)),
    http.get(`/api/v1/publico/${SLUG}/horarios`, ({ request }) => {
      horarios.push(request.url);
      return HttpResponse.json({});
    }),
  );
  return horarios;
}

const titulo = () => screen.findByRole('heading', { level: 1, name: 'Barbería Huamanga' });

afterEach(() => {
  tokenEnMemoria.limpiar();
  ultimaBarberia.olvidar();
});

describe('Presentación pública (/b/:slug) sin sesión', () => {
  it('muestra la barbería, sus datos, el horario de atención, los servicios y el equipo', async () => {
    indicadorSesion.quitar();
    simularApi();
    renderizar();
    await titulo();
    expect(screen.getByText('Cortes clásicos y modernos.')).toBeInTheDocument();
    const contacto = screen.getByRole('list', { name: 'Datos de contacto' });
    expect(contacto).toHaveTextContent('Jr. Asamblea 120, Ayacucho');
    expect(within(contacto).getByRole('link', { name: '066 312345' })).toHaveAttribute(
      'href',
      'tel:066312345',
    );

    const servicios = screen.getByRole('region', { name: 'Servicios' });
    expect(within(servicios).getByRole('heading', { name: 'Corte clásico' })).toBeInTheDocument();
    expect(servicios).toHaveTextContent('S/ 25.00');
    expect(servicios).toHaveTextContent('30 min');
    expect(servicios).toHaveTextContent('Con tijera y máquina.');

    const equipo = screen.getByRole('region', { name: 'Nuestro equipo' });
    expect(equipo).toHaveTextContent('Carlos Ñaupa');
    expect(equipo).toHaveTextContent('CÑ');
    expect(equipo).toHaveTextContent('Corte clásico · Arreglo de barba');

    const horario = screen.getByRole('region', { name: 'Horario de atención' });
    expect(horario).toHaveTextContent('Martes');
    expect(horario).toHaveTextContent('09:00 – 13:00');
    expect(horario).toHaveTextContent('15:00 – 19:00');
    expect(horario).toHaveTextContent('Cerrado');
  });

  it('no muestra el formulario de reserva ni pide horarios libres', async () => {
    indicadorSesion.quitar();
    const horarios = simularApi();
    renderizar();
    await titulo();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/fecha/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Horas libres' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(horarios).toEqual([]);
  });

  it('invita a ingresar o crear la cuenta de ESTA barbería', async () => {
    indicadorSesion.quitar();
    simularApi();
    renderizar();
    await titulo();
    expect(
      screen.getByRole('heading', { name: 'Para reservar tu cita, ingresa o crea tu cuenta' }),
    ).toBeInTheDocument();
    for (const enlace of screen.getAllByRole('link', { name: /Ingresar para reservar/ })) {
      expect(enlace).toHaveAttribute('href', `/b/${SLUG}/ingresar`);
    }
    for (const enlace of screen.getAllByRole('link', { name: 'Crear cuenta' })) {
      expect(enlace).toHaveAttribute('href', `/b/${SLUG}/registro`);
    }
    await userEvent.setup().click(screen.getAllByRole('link', { name: /Ingresar para reservar/ })[0]);
    expect(await screen.findByRole('heading', { name: 'Ingreso de cliente' })).toBeInTheDocument();
  });

  it('sin servicios: "Esta barbería está preparando su catálogo. Vuelve pronto."', async () => {
    indicadorSesion.quitar();
    simularApi({ ...CATALOGO, servicios: [], barberos: [] });
    renderizar();
    await titulo();
    expect(screen.getByText('Esta barbería está preparando su catálogo. Vuelve pronto.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nuestro equipo' })).not.toBeInTheDocument();
  });

  it('sin horario en la API no inventa uno', async () => {
    indicadorSesion.quitar();
    simularApi({ ...CATALOGO, horario: { tramos: [] } });
    renderizar();
    await titulo();
    expect(screen.queryByRole('region', { name: 'Horario de atención' })).not.toBeInTheDocument();
  });

  it('un 404 muestra "Barbería no disponible"', async () => {
    indicadorSesion.quitar();
    servidor.use(
      http.get(`/api/v1/publico/${SLUG}`, () =>
        HttpResponse.json({ codigo: 'BARBERIA_NO_DISPONIBLE', mensaje: 'x', detalles: [] }, { status: 404 }),
      ),
    );
    renderizar();
    expect(await screen.findByRole('heading', { name: 'Barbería no disponible' })).toBeInTheDocument();
  });

  it('recuerda esta barbería (solo enlace y nombre) para ofrecer "Ingresar" desde /mis-citas', async () => {
    indicadorSesion.quitar();
    simularApi();
    renderizar();
    await titulo();
    expect(ultimaBarberia.leer()).toEqual({ slug: SLUG, nombre: 'Barbería Huamanga' });
  });
});

describe('Presentación pública (/b/:slug) con sesión de cliente', () => {
  it('de esta barbería: "Reservar una cita" al panel y "Ir a mis citas"', async () => {
    simularApi();
    servidor.use(http.post('/api/v1/auth/refresh', () => HttpResponse.json(sesionCliente())));
    renderizar();
    await titulo();
    const reservar = await screen.findAllByRole('link', { name: 'Reservar una cita' });
    expect(reservar[0]).toHaveAttribute('href', `/b/${SLUG}/reservar`);
    expect(screen.getAllByRole('link', { name: 'Ir a mis citas' })[0]).toHaveAttribute('href', '/mis-citas');
    expect(screen.queryByRole('link', { name: /Ingresar para reservar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('de otra barbería: "Reservar aquí" (la unión pide su consentimiento en la reserva), sin sus citas de la otra', async () => {
    simularApi();
    servidor.use(http.post('/api/v1/auth/refresh', () => HttpResponse.json(sesionCliente('otra-barberia'))));
    renderizar();
    await titulo();
    expect((await screen.findAllByRole('link', { name: 'Reservar aquí' }))[0]).toHaveAttribute(
      'href',
      `/b/${SLUG}/reservar`,
    );
    expect(screen.queryByRole('link', { name: 'Ir a mis citas' })).not.toBeInTheDocument();
  });

  it('"Cerrar sesión" vuelve a "Ingresar" y deja el foco en él', async () => {
    simularApi();
    servidor.use(
      http.post('/api/v1/auth/refresh', () => HttpResponse.json(sesionCliente())),
      http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );
    renderizar();
    await titulo();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    const ingresar = await screen.findByRole('link', { name: 'Ingresar' });
    expect(ingresar).toHaveFocus();
  });
});

describe('Horario de atención (helper)', () => {
  it('ordena de lunes a domingo, une los tramos de cada día y marca hoy en la zona de la barbería', () => {
    // Un martes a las 23:30 en Lima ya es miércoles en UTC: "hoy" sigue siendo martes.
    const dias = diasDeAtencion(CATALOGO.horario.tramos, ZONA, new Date('2026-11-25T04:30:00Z'));
    expect(dias.map((d) => d.nombre)).toEqual([
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ]);
    expect(dias[1]).toEqual({
      dia: 2,
      nombre: 'Martes',
      tramos: ['09:00 – 13:00', '15:00 – 19:00'],
      esHoy: true,
    });
    expect(dias[0].tramos).toEqual([]);
    expect(diasDeAtencion([], ZONA)).toEqual([]);
  });
});
