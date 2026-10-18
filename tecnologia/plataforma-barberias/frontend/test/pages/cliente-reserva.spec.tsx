import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { clavesConsulta } from '../../src/api/claves';
import { tokenEnMemoria } from '../../src/api/client';
import type { components } from '../../src/api/schema-002';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { VERSION_POLITICA_DATOS } from '../../src/legal';
import IngresarBarberia from '../../src/pages/publico/IngresarBarberia';
import RegistroCliente from '../../src/pages/publico/RegistroCliente';
import { ReservarProtegida } from '../../src/pages/publico/Reservar';
import { servidor } from '../setup';

// T082 · Pantallas de la cuenta de cliente y de la reserva (US3): registro con consentimiento, ingreso desde el
// enlace con unión, Idempotency-Key estable entre reintentos, 409 que vuelve a los horarios y confirmación.

type Sesion = components['schemas']['SesionResponse'];
type Catalogo = components['schemas']['CatalogoPublico'];
type Cita = components['schemas']['Cita'];

const SLUG = 'barberia-huamanga';
const SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
// 10:00 en Lima (UTC-5) del martes 20 de octubre de 2026.
const INICIO = '2026-10-20T15:00:00Z';
const SELECCION = `servicio=${SERVICIO}&barbero=${BARBERO}&inicio=${encodeURIComponent(INICIO)}`;

const sesionCliente = (slug = SLUG, nombre = 'Barbería Huamanga'): Sesion => ({
  tokenAcceso: `token-${slug}`,
  tipo: 'Bearer',
  expiraEn: 900,
  usuario: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    nombre: 'Luis Huamán',
    correo: 'luis@prueba.pe',
    rol: 'CLIENTE',
    barberia: { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre, slug },
  },
});

const CATALOGO: Catalogo = {
  barberia: {
    nombre: 'Barbería Huamanga',
    slug: SLUG,
    direccion: 'Jr. Asamblea 120, Ayacucho',
    telefono: null,
    descripcion: null,
    zonaHoraria: 'America/Lima',
  },
  horario: { tramos: [{ diaSemana: 2, inicio: '09:00', fin: '19:00' }] },
  servicios: [
    { id: SERVICIO, nombre: 'Corte clásico', descripcion: null, precio: '25.00', duracionMinutos: 30 },
  ],
  barberos: [{ id: BARBERO, nombre: 'Carlos Ñaupa', servicioIds: [SERVICIO] }],
};

const CITA: Cita = {
  id: '0190a1b2-c3d4-7e5f-8a9b-000000000099',
  barberia: 'Barbería Huamanga',
  servicio: 'Corte clásico',
  barbero: 'Carlos Ñaupa',
  inicio: INICIO,
  fin: '2026-10-20T15:30:00Z',
  precio: '25.00',
  estado: 'CONFIRMADA',
  cancelacionTardia: false,
  origen: 'EN_LINEA',
};

const error = (estado: number, codigo: string, mensaje: string) =>
  HttpResponse.json({ codigo, mensaje, detalles: [] }, { status: estado });

function RutaActual() {
  const { pathname, search } = useLocation();
  return <output data-testid="ruta">{pathname + search}</output>;
}

/** Simula que el cliente vuelve al catálogo y elige otra hora (el catálogo es de US2). */
function OtraHora() {
  const navegar = useNavigate();
  const otra = encodeURIComponent('2026-10-20T16:00:00Z');
  return (
    <button
      type="button"
      onClick={() => navegar(`/b/${SLUG}/reservar?servicio=${SERVICIO}&barbero=${BARBERO}&inicio=${otra}`)}
    >
      elegir otra hora
    </button>
  );
}

function renderizar(
  ruta: string,
  clienteConsultas = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  render(
    <QueryClientProvider client={clienteConsultas}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <Routes>
            <Route path="/b/:slug" element={<h1>Catálogo de la barbería</h1>} />
            <Route path="/b/:slug/registro" element={<RegistroCliente />} />
            <Route path="/b/:slug/ingresar" element={<IngresarBarberia />} />
            <Route path="/b/:slug/reservar" element={<ReservarProtegida />} />
            <Route path="/mis-citas" element={<h1>Mis citas</h1>} />
          </Routes>
          <RutaActual />
          <OtraHora />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return clienteConsultas;
}

const rutaActual = () => screen.getByTestId('ruta').textContent;

afterEach(() => tokenEnMemoria.limpiar());

describe('Registro de cliente desde el enlace (/b/:slug/registro)', () => {
  it('pide solo los datos mínimos y exige aceptar la política de datos, sin llamar a la API', async () => {
    indicadorSesion.quitar();
    renderizar(`/b/${SLUG}/registro`);
    const formulario = await screen.findByRole('form', { name: /crea tu cuenta/i });
    // Nombre, correo, teléfono, contraseña y la casilla de la política: nada más (minimización, FR-023).
    expect(formulario.querySelectorAll('input')).toHaveLength(5);
    expect(screen.getByLabelText(/política de tratamiento de datos/i)).not.toBeChecked();
    expect(screen.getByText(new RegExp(`versión ${VERSION_POLITICA_DATOS}`))).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /crear mi cuenta/i }));
    expect(await screen.findByText(/debes aceptar la política de tratamiento de datos/i)).toBeInTheDocument();
    expect(screen.getByText(/ingresa un teléfono válido/i)).toBeInTheDocument();
  });

  it('con datos válidos registra en esa barbería, guarda el token y vuelve al catálogo', async () => {
    indicadorSesion.quitar();
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/clientes/registro', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json(sesionCliente(), { status: 201 });
      }),
    );
    renderizar(`/b/${SLUG}/registro`);
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText(/tu nombre/i), 'Luis Huamán');
    await usuario.type(screen.getByLabelText(/correo/i), 'luis@prueba.pe');
    await usuario.type(screen.getByLabelText(/teléfono/i), '966 123 456');
    await usuario.type(screen.getByLabelText(/contraseña/i), 'mi corte de los sabados');
    await usuario.click(screen.getByLabelText(/política de tratamiento de datos/i));
    await usuario.click(screen.getByRole('button', { name: /crear mi cuenta/i }));

    expect(await screen.findByRole('heading', { name: /catálogo de la barbería/i })).toBeInTheDocument();
    expect(rutaActual()).toBe(`/b/${SLUG}`);
    expect(tokenEnMemoria.obtener()).toBe(`token-${SLUG}`);
    expect(cuerpo).toEqual({
      barberia: SLUG,
      nombre: 'Luis Huamán',
      correo: 'luis@prueba.pe',
      telefono: '966 123 456',
      contrasena: 'mi corte de los sabados',
      aceptaPoliticaDatos: true,
      versionPoliticaDatos: VERSION_POLITICA_DATOS,
    });
  });

  it('ante CORREO_NO_DISPONIBLE invita a iniciar sesión desde el mismo enlace', async () => {
    indicadorSesion.quitar();
    servidor.use(
      http.post('/api/v1/clientes/registro', () =>
        error(409, 'CORREO_NO_DISPONIBLE', 'Ese correo no está disponible.'),
      ),
    );
    renderizar(`/b/${SLUG}/registro`);
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText(/tu nombre/i), 'Luis Huamán');
    await usuario.type(screen.getByLabelText(/correo/i), 'luis@prueba.pe');
    await usuario.type(screen.getByLabelText(/teléfono/i), '966123456');
    await usuario.type(screen.getByLabelText(/contraseña/i), 'mi corte de los sabados');
    await usuario.click(screen.getByLabelText(/política de tratamiento de datos/i));
    await usuario.click(screen.getByRole('button', { name: /crear mi cuenta/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/ya tienes una cuenta/i);
    expect(within(alerta).getByRole('link', { name: /inicia sesión/i })).toHaveAttribute(
      'href',
      `/b/${SLUG}/ingresar`,
    );
    expect(tokenEnMemoria.obtener()).toBeNull();
  });
});

describe('Ingreso desde el enlace (/b/:slug/ingresar)', () => {
  it('si la cuenta no es cliente de esta barbería, pide el consentimiento y el teléfono y se une', async () => {
    indicadorSesion.quitar();
    const cuerpos: Record<string, unknown>[] = [];
    servidor.use(
      http.post('/api/v1/auth/login', async ({ request }) => {
        const cuerpo = (await request.json()) as Record<string, unknown>;
        cuerpos.push(cuerpo);
        return cuerpo.aceptaPoliticaDatos
          ? HttpResponse.json(sesionCliente())
          : error(409, 'UNIRSE_REQUIERE_CONSENTIMIENTO', 'Para reservar aquí, acepta la política de datos.');
      }),
    );
    renderizar(`/b/${SLUG}/ingresar`);
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText(/correo/i), 'luis@prueba.pe');
    await usuario.type(screen.getByLabelText(/contraseña/i), 'mi corte de los sabados');
    await usuario.click(screen.getByRole('button', { name: /^ingresar$/i }));

    // Paso de unión: la casilla no viene marcada y sin ella no se envía nada.
    const casilla = await screen.findByLabelText(/política de tratamiento de datos/i);
    expect(casilla).not.toBeChecked();
    await usuario.click(screen.getByRole('button', { name: /unirme y continuar/i }));
    expect(await screen.findByText(/debes aceptar la política de tratamiento de datos/i)).toBeInTheDocument();
    expect(cuerpos).toHaveLength(1);

    await usuario.type(screen.getByLabelText(/teléfono/i), '966123456');
    await usuario.click(casilla);
    await usuario.click(screen.getByRole('button', { name: /unirme y continuar/i }));

    expect(await screen.findByRole('heading', { name: /catálogo de la barbería/i })).toBeInTheDocument();
    expect(cuerpos).toEqual([
      { correo: 'luis@prueba.pe', contrasena: 'mi corte de los sabados', barberia: SLUG },
      {
        correo: 'luis@prueba.pe',
        contrasena: 'mi corte de los sabados',
        barberia: SLUG,
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: VERSION_POLITICA_DATOS,
        telefono: '966123456',
      },
    ]);
    expect(tokenEnMemoria.obtener()).toBe(`token-${SLUG}`);
  });

  it('una cuenta del personal recibe el aviso de CUENTA_DE_PERSONAL y no se une', async () => {
    indicadorSesion.quitar();
    servidor.use(
      http.post('/api/v1/auth/login', () =>
        error(409, 'CUENTA_DE_PERSONAL', 'Esta cuenta pertenece al personal de una barbería.'),
      ),
    );
    renderizar(`/b/${SLUG}/ingresar`);
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText(/correo/i), 'rosa@prueba.pe');
    await usuario.type(screen.getByLabelText(/contraseña/i), 'mi barberia en huamanga');
    await usuario.click(screen.getByRole('button', { name: /^ingresar$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/personal de una barbería/i);
    expect(screen.queryByLabelText(/política de tratamiento de datos/i)).not.toBeInTheDocument();
  });
});

describe('Reserva (/b/:slug/reservar)', () => {
  const conSesionYCatalogo = (sesion: Sesion = sesionCliente()) =>
    servidor.use(
      http.post('/api/v1/auth/refresh', () => HttpResponse.json(sesion)),
      http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(CATALOGO)),
    );

  it('sin sesión lleva al ingreso de esa barbería', async () => {
    indicadorSesion.quitar();
    renderizar(`/b/${SLUG}/reservar?${SELECCION}`);
    expect(await screen.findByRole('button', { name: /^ingresar$/i })).toBeInTheDocument();
    expect(rutaActual()).toBe(`/b/${SLUG}/ingresar`);
  });

  it('la confirmación muestra todos los datos de la selección en la hora de la barbería', async () => {
    conSesionYCatalogo();
    renderizar(`/b/${SLUG}/reservar?${SELECCION}`);
    const resumen = await screen.findByRole('region', { name: /confirma tu cita/i });
    expect(resumen).toHaveTextContent('Barbería Huamanga');
    expect(resumen).toHaveTextContent('Corte clásico');
    expect(resumen).toHaveTextContent('Carlos Ñaupa');
    expect(resumen).toHaveTextContent(/martes,? 20 de octubre/i);
    expect(resumen).toHaveTextContent('10:00 (hora de la barbería)');
    expect(resumen).toHaveTextContent('30 min');
    expect(resumen).toHaveTextContent('S/ 25.00');
  });

  it('reutiliza la Idempotency-Key en los reintentos y muestra la cita confirmada', async () => {
    conSesionYCatalogo();
    const claves: (string | null)[] = [];
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/citas', async ({ request }) => {
        claves.push(request.headers.get('Idempotency-Key'));
        cuerpo = await request.json();
        // El primer intento se pierde (sin respuesta); el segundo crea la cita.
        return claves.length === 1 ? HttpResponse.error() : HttpResponse.json(CITA, { status: 201 });
      }),
    );
    renderizar(`/b/${SLUG}/reservar?${SELECCION}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /confirmar reserva/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos conectar/i);
    await usuario.click(screen.getByRole('button', { name: /confirmar reserva/i }));

    const hecho = await screen.findByRole('region', { name: /tu cita está confirmada/i });
    expect(claves).toHaveLength(2);
    expect(claves[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(claves[1]).toBe(claves[0]);
    expect(cuerpo).toEqual({ servicioId: SERVICIO, barberoId: BARBERO, inicio: INICIO });
    expect(hecho).toHaveTextContent('Corte clásico');
    expect(hecho).toHaveTextContent('Carlos Ñaupa');
    expect(hecho).toHaveTextContent('10:00 (hora de la barbería)');
    expect(hecho).toHaveTextContent('S/ 25.00');
    expect(within(hecho).getByRole('link', { name: /ver mis citas/i })).toHaveAttribute('href', '/mis-citas');
  });

  it('cambia la Idempotency-Key si cambia la selección', async () => {
    conSesionYCatalogo();
    const claves: (string | null)[] = [];
    servidor.use(
      http.post('/api/v1/citas', ({ request }) => {
        claves.push(request.headers.get('Idempotency-Key'));
        return error(500, 'ERROR_INTERNO', 'Ocurrió un error inesperado. Intenta de nuevo.');
      }),
    );
    renderizar(`/b/${SLUG}/reservar?${SELECCION}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /confirmar reserva/i }));
    await screen.findByRole('alert');
    await usuario.click(screen.getByRole('button', { name: /elegir otra hora/i }));
    expect(await screen.findByText('11:00 (hora de la barbería)')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /confirmar reserva/i }));
    await screen.findByRole('alert');

    expect(claves).toHaveLength(2);
    expect(claves[1]).not.toBe(claves[0]);
  });

  it('ante 409 HORARIO_NO_DISPONIBLE vuelve al catálogo del mismo día y pide de nuevo los horarios', async () => {
    conSesionYCatalogo();
    servidor.use(
      http.post('/api/v1/citas', () =>
        error(409, 'HORARIO_NO_DISPONIBLE', 'Ese horario acaba de ocuparse. Elige otro.'),
      ),
    );
    const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const claveHorarios = clavesConsulta.horarios(SLUG, SERVICIO, '2026-10-20');
    consultas.setQueryData(claveHorarios, { horas: [] });
    renderizar(`/b/${SLUG}/reservar?${SELECCION}`, consultas);
    await userEvent.setup().click(await screen.findByRole('button', { name: /confirmar reserva/i }));

    expect(await screen.findByRole('heading', { name: /catálogo de la barbería/i })).toBeInTheDocument();
    expect(rutaActual()).toBe(`/b/${SLUG}?servicio=${SERVICIO}&fecha=2026-10-20`);
    // Los horarios guardados de ese día quedan vencidos: el catálogo los vuelve a pedir al montarse.
    expect(consultas.getQueryState(claveHorarios)?.isInvalidated).toBe(true);
  });

  it('con la sesión en otra barbería cambia de barbería; si no es cliente de ella, pide unirse', async () => {
    conSesionYCatalogo(sesionCliente('otra-barberia', 'Otra Barbería'));
    const cuerpos: Record<string, unknown>[] = [];
    servidor.use(
      http.post('/api/v1/auth/barberia', async ({ request }) => {
        const cuerpo = (await request.json()) as Record<string, unknown>;
        cuerpos.push(cuerpo);
        return cuerpo.aceptaPoliticaDatos
          ? HttpResponse.json(sesionCliente())
          : error(409, 'UNIRSE_REQUIERE_CONSENTIMIENTO', 'Para reservar aquí, acepta la política de datos.');
      }),
    );
    renderizar(`/b/${SLUG}/reservar?${SELECCION}`);
    const usuario = userEvent.setup();
    const casilla = await screen.findByLabelText(/política de tratamiento de datos/i);
    await usuario.type(screen.getByLabelText(/teléfono/i), '966123456');
    await usuario.click(casilla);
    await usuario.click(screen.getByRole('button', { name: /unirme y continuar/i }));

    expect(await screen.findByRole('region', { name: /confirma tu cita/i })).toBeInTheDocument();
    expect(cuerpos).toEqual([
      { barberia: SLUG },
      {
        barberia: SLUG,
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: VERSION_POLITICA_DATOS,
        telefono: '966123456',
      },
    ]);
    expect(tokenEnMemoria.obtener()).toBe(`token-${SLUG}`);
  });
});
