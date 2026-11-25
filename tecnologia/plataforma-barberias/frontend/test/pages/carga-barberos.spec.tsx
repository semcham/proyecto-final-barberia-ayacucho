import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T041 de 011 · Pantalla "Agregar varios barberos" (US2; contracts/pantallas.md): cupo visible, pegar nombres, servicios
// activos como casillas y "Todos", aviso ámbar de nombre repetido que deja guardar, cupo superado, sin servicios
// activos y teclado.

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'barberia-huamanga',
};
const RUTA = '/app/barberos/agregar-varios';
const CORTE = '0190a1b2-0000-7000-8000-0000000000c1';
const BARBA = '0190a1b2-0000-7000-8000-0000000000c2';
const TINTE = '0190a1b2-0000-7000-8000-0000000000c3';
const SERVICIOS = [
  { id: CORTE, nombre: 'Corte', descripcion: null, precio: '25.00', duracionMinutos: 30, activo: true },
  { id: BARBA, nombre: 'Barba', descripcion: null, precio: '15.00', duracionMinutos: 20, activo: true },
  { id: TINTE, nombre: 'Tinte', descripcion: null, precio: '40.00', duracionMinutos: 60, activo: false },
];
const EXISTENTES = [
  { id: 'b1', nombre: 'Luis', activo: true, servicioIds: [CORTE], usuarioId: null },
  { id: 'b2', nombre: 'Rocío', activo: true, servicioIds: [], usuarioId: null },
  { id: 'b3', nombre: 'Antiguo', activo: false, servicioIds: [], usuarioId: null },
];

type Fila = { nombre: string; servicioIds: string[] };

function revisar(filas: Fila[], maximo: number) {
  const activos = EXISTENTES.filter((b) => b.activo).length;
  const errores: { fila: number | null; campo: string; problema: string }[] = [];
  const advertencias: { fila: number; campo: string; problema: string }[] = [];
  let conDatos = 0;
  filas.forEach((f, i) => {
    if (f.nombre.trim() === '' && f.servicioIds.length === 0) return;
    conDatos += 1;
    if (f.nombre.trim().length < 2) errores.push({ fila: i + 1, campo: 'nombre', problema: 'longitud' });
    if (EXISTENTES.some((b) => b.nombre.toLowerCase() === f.nombre.trim().toLowerCase())) {
      advertencias.push({ fila: i + 1, campo: 'nombre', problema: 'ya_existe' });
    }
  });
  if (activos + conDatos > maximo) errores.push({ fila: null, campo: 'filas', problema: 'supera_cupo' });
  return {
    filas: conDatos,
    errores,
    advertencias,
    cupo: { maximo, activos, disponibles: Math.max(0, maximo - activos) },
  };
}

function servidorDeCarga(opciones: { maximo?: number; servicios?: typeof SERVICIOS } = {}) {
  const maximo = opciones.maximo ?? 5;
  const registro = { guardados: [] as { filas: Fila[]; clave: string | null }[] };
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: {
          correoVerificado: true,
          id: '0190a1b2-0000-7000-8000-000000000001',
          nombre: 'Rosa Quispe',
          correo: 'rosa@prueba.pe',
          rol: 'PROPIETARIO',
          barberia: BARBERIA,
        },
      }),
    ),
    http.get('/api/v1/servicios', () => HttpResponse.json(opciones.servicios ?? SERVICIOS)),
    http.get('/api/v1/barberos', () => HttpResponse.json(EXISTENTES)),
    http.get('/api/v1/suscripcion', () =>
      HttpResponse.json({
        estado: 'TRIAL',
        plan: {
          id: '0190a1b2-0000-7000-8000-0000000000a0',
          codigo: 'TRIAL',
          nombre: 'Prueba gratuita',
          precioCentimos: 0,
          moneda: 'PEN',
          maxUsuarios: 5,
          maxBarberos: maximo,
          mediosDisponibles: [],
        },
        iniciaEn: '2026-10-20T15:00:00.000Z',
        finPrueba: '2026-11-03T15:00:00.000Z',
        finCobertura: '2026-11-03T15:00:00.000Z',
        finGracia: null,
        diasRestantes: 6,
        proximoPeriodo: null,
        limites: { maxUsuarios: 5, maxBarberos: maximo },
        motivoSuspension: null,
        pagoAbierto: null,
        avisos: [],
      }),
    ),
    http.post('/api/v1/barberos/lote/revision', async ({ request }) => {
      const { filas } = (await request.json()) as { filas: Fila[] };
      return HttpResponse.json(revisar(filas, maximo));
    }),
    http.post('/api/v1/barberos/lote', async ({ request }) => {
      const { filas } = (await request.json()) as { filas: Fila[] };
      registro.guardados.push({ filas, clave: request.headers.get('Idempotency-Key') });
      const creados = revisar(filas, maximo).filas;
      return HttpResponse.json({ tipo: 'BARBEROS', creados, ids: [] }, { status: 201 });
    }),
  );
  return registro;
}

function RutaActual() {
  return <output data-testid="ruta">{useLocation().pathname}</output>;
}

function renderizar(ruta = RUTA) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lista = () => screen.findByRole('list', { name: 'Barberos por agregar' });
const nombre = (fila: number) => screen.getByLabelText(`Nombre visible, fila ${fila}`);
const servicios = (fila: number) => screen.getByRole('group', { name: `Servicios que ofrece, fila ${fila}` });

afterEach(() => tokenEnMemoria.limpiar());

describe('Agregar varios barberos (/app/barberos/agregar-varios)', () => {
  it('muestra el cupo del plan y solo los servicios activos como casillas', async () => {
    servidorDeCarga();
    renderizar();
    await lista();
    expect(await screen.findByText(/Tu plan permite/)).toHaveTextContent(
      'Tu plan permite 5 barberos activos. Tienes 2. Puedes agregar 3.',
    );
    const grupo = servicios(1);
    expect(within(grupo).getByRole('checkbox', { name: 'Corte' })).not.toBeChecked();
    expect(within(grupo).getByRole('checkbox', { name: 'Barba' })).toBeInTheDocument();
    expect(within(grupo).queryByRole('checkbox', { name: 'Tinte' })).not.toBeInTheDocument();
  });

  it('pega nombres, marca servicios con "Todos" y guarda con el teclado', async () => {
    const registro = servidorDeCarga();
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Pegar nombres' }));
    fireEvent.change(screen.getByLabelText('Nombres copiados de la hoja de cálculo'), {
      target: { value: 'Nombre\nCarlos Ñaupa\nAna Pillaca' },
    });
    await usuario.click(screen.getByRole('button', { name: 'Agregar a la tabla' }));
    expect(nombre(1)).toHaveValue('Carlos Ñaupa');
    expect(nombre(2)).toHaveValue('Ana Pillaca');

    await usuario.click(within(servicios(1)).getByRole('button', { name: /Todos/ }));
    expect(within(servicios(1)).getByRole('checkbox', { name: 'Corte' })).toBeChecked();
    expect(within(servicios(1)).getByRole('checkbox', { name: 'Barba' })).toBeChecked();
    within(servicios(2)).getByRole('checkbox', { name: 'Barba' }).focus();
    await usuario.keyboard(' ');
    expect(within(servicios(2)).getByRole('checkbox', { name: 'Barba' })).toBeChecked();

    screen.getByRole('button', { name: 'Revisar' }).focus();
    await usuario.keyboard('{Enter}');
    const guardar = await screen.findByRole('button', { name: 'Guardar 2 barberos' });
    guardar.focus();
    await usuario.keyboard('{Enter}');

    expect(await screen.findByText('Se crearon 2 barberos')).toBeInTheDocument();
    expect(screen.getByTestId('ruta')).toHaveTextContent('/app/barberos');
    expect(registro.guardados[0].filas).toEqual([
      { nombre: 'Carlos Ñaupa', servicioIds: [CORTE, BARBA] },
      { nombre: 'Ana Pillaca', servicioIds: [BARBA] },
    ]);
    expect(registro.guardados[0].clave).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un nombre repetido es un aviso en ámbar que deja guardar', async () => {
    servidorDeCarga();
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    fireEvent.change(nombre(1), { target: { value: 'Luis' } });
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(await screen.findByText(/Todo listo: se creará 1 barbero/)).toBeInTheDocument();
    expect(screen.getByText(/revisa que no sea la misma persona/)).toBeInTheDocument();
    expect(nombre(1)).not.toHaveAttribute('aria-invalid');
    expect(nombre(1)).toHaveAccessibleDescription(/Ya hay un barbero con este nombre/);
    expect(screen.getByRole('button', { name: 'Guardar 1 barbero' })).toBeEnabled();
  });

  it('si la carga supera el cupo, lo explica con los números y no deja guardar', async () => {
    servidorDeCarga({ maximo: 3 });
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    fireEvent.change(nombre(1), { target: { value: 'Carlos' } });
    fireEvent.change(nombre(2), { target: { value: 'Ana' } });
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu plan permite 3 barberos activos y ya tienes 2. Quita 1 fila o cambia de plan.',
    );
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('sin servicios activos avisa que se guardarán sin servicios, y se puede guardar', async () => {
    servidorDeCarga({ servicios: [SERVICIOS[2]] });
    renderizar();
    await lista();
    expect(await screen.findByText(/Aún no tienes servicios activos/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Servicios que ofrece, fila 1/ })).not.toBeInTheDocument();
    fireEvent.change(nombre(1), { target: { value: 'Carlos' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Revisar' }));
    expect(await screen.findByRole('button', { name: 'Guardar 1 barbero' })).toBeEnabled();
  });

  it('en Barberos hay un enlace "Agregar varios"', async () => {
    servidorDeCarga();
    servidor.use(
      http.get('/api/v1/usuarios', () => HttpResponse.json({ datos: [], total: 0, pagina: 1, tamano: 100 })),
    );
    renderizar('/app/barberos');
    expect(await screen.findByRole('link', { name: 'Agregar varios' })).toHaveAttribute('href', RUTA);
  });
});
