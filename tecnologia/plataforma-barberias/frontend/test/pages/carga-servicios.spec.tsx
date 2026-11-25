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

// T025 de 011 · Pantalla "Agregar varios servicios" (US1; contracts/pantallas.md): típicos sin precio, "Falta el
// precio", errores junto a su campo, la revisión se descarta al editar, guardado con Idempotency-Key estable y teclado.

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'barberia-huamanga',
};
const RUTA = '/app/servicios/agregar-varios';
const TIPICOS = ['Corte', 'Barba', 'Corte y barba', 'Cejas', 'Corte para niños', 'Lavado'];

type Fila = { nombre: string; duracionMinutos: number | null; precio: string; descripcion: string | null };

function sesion(rol: 'PROPIETARIO' | 'BARBERO') {
  return http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        correoVerificado: true,
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Rosa Quispe',
        correo: 'rosa@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );
}

/** Revisión "de servidor" para las pruebas: precio vacío → falta; duración no múltiplo de 5 → error. */
function revisar(filas: Fila[]) {
  const errores: { fila: number; campo: string; problema: string }[] = [];
  let conDatos = 0;
  filas.forEach((f, i) => {
    const vacia = f.nombre.trim() === '' && f.duracionMinutos === null && f.precio === '' && !f.descripcion;
    if (vacia) return;
    conDatos += 1;
    if (f.nombre.trim().length < 2) errores.push({ fila: i + 1, campo: 'nombre', problema: 'longitud' });
    if (f.duracionMinutos !== null && f.duracionMinutos % 5 !== 0) {
      errores.push({ fila: i + 1, campo: 'duracionMinutos', problema: 'multiplo_de_5' });
    }
    if (f.precio === '') errores.push({ fila: i + 1, campo: 'precio', problema: 'falta' });
  });
  return { filas: conDatos, errores, advertencias: [] };
}

function servidorDeCarga(
  opciones: { guardar?: (filas: Fila[], clave: string | null, intento: number) => Response } = {},
) {
  const registro = { revisiones: [] as Fila[][], guardados: [] as { filas: Fila[]; clave: string | null }[] };
  servidor.use(
    sesion('PROPIETARIO'),
    http.get('/api/v1/servicios', () => HttpResponse.json([])),
    http.post('/api/v1/servicios/lote/revision', async ({ request }) => {
      const { filas } = (await request.json()) as { filas: Fila[] };
      registro.revisiones.push(filas);
      return HttpResponse.json(revisar(filas));
    }),
    http.post('/api/v1/servicios/lote', async ({ request }) => {
      const { filas } = (await request.json()) as { filas: Fila[] };
      const clave = request.headers.get('Idempotency-Key');
      registro.guardados.push({ filas, clave });
      if (opciones.guardar) return opciones.guardar(filas, clave, registro.guardados.length);
      const creados = revisar(filas).filas;
      return HttpResponse.json(
        { tipo: 'SERVICIOS', creados, ids: Array.from({ length: creados }, (_, i) => `id-${i}`) },
        { status: 201 },
      );
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

const lista = () => screen.findByRole('list', { name: 'Servicios por agregar' });
const filasDeLaLista = async () => within(await lista()).getAllByRole('listitem');
const campo = (fila: number, etiqueta: RegExp) =>
  screen.getByLabelText(new RegExp(`${etiqueta.source}, fila ${fila}$`, 'i'));

afterEach(() => tokenEnMemoria.limpiar());

describe('Agregar varios servicios (/app/servicios/agregar-varios)', () => {
  it('(a) los típicos llegan con nombre y duración, y el precio VACÍO; nada se guarda', async () => {
    const registro = servidorDeCarga();
    renderizar();
    await lista();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agregar servicios típicos' }));

    const filas = await filasDeLaLista();
    expect(filas).toHaveLength(TIPICOS.length);
    TIPICOS.forEach((nombre, i) => {
      expect(campo(i + 1, /nombre/)).toHaveValue(nombre);
      expect(campo(i + 1, /precio/)).toHaveValue('');
    });
    expect(campo(1, /duración/)).toHaveValue('30');
    // El foco queda en el precio de la primera fila agregada.
    expect(campo(1, /precio/)).toHaveFocus();
    expect(screen.getByText(/de 50 filas/).textContent).toMatch(/6 de 50 filas/);
    expect(registro.guardados).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Guardar/ })).toBeDisabled();
  });

  it('(b) revisar sin precios marca "Falta el precio" en cada fila y no deja guardar', async () => {
    servidorDeCarga();
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Agregar servicios típicos' }));
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));

    const resumen = await screen.findByRole('alert');
    expect(resumen).toHaveTextContent('Hay 6 filas con errores');
    expect(resumen).toHaveFocus();
    TIPICOS.forEach((_, i) => {
      const precio = campo(i + 1, /precio/);
      expect(precio).toHaveAttribute('aria-invalid', 'true');
      expect(precio).toHaveAccessibleDescription(/Falta el precio/);
    });
    expect(screen.getByRole('button', { name: /^Guardar/ })).toBeDisabled();
  });

  it('(c) el resumen lleva el foco al campo con error', async () => {
    servidorDeCarga();
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    fireEvent.change(campo(2, /nombre/), { target: { value: 'Tinte' } });
    fireEvent.change(campo(2, /duración/), { target: { value: '33' } });
    fireEvent.change(campo(2, /precio/), { target: { value: '40' } });
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    const resumen = await screen.findByRole('alert');
    expect(resumen).toHaveTextContent('Hay 1 fila con errores');
    await usuario.click(within(resumen).getByRole('button', { name: /Fila 2 · Duración/ }));
    expect(campo(2, /duración/)).toHaveFocus();
    expect(campo(2, /duración/)).toHaveAccessibleDescription(/de 5 en 5/);
  });

  it('(d) cambiar una celda descarta la revisión anterior', async () => {
    servidorDeCarga();
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    fireEvent.change(campo(1, /nombre/), { target: { value: 'Corte' } });
    fireEvent.change(campo(1, /duración/), { target: { value: '30' } });
    fireEvent.change(campo(1, /precio/), { target: { value: '25' } });
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(await screen.findByText(/Todo listo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar 1 servicio' })).toBeEnabled();
    fireEvent.change(campo(1, /precio/), { target: { value: '30' } });
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.queryByText(/Todo listo/)).not.toBeInTheDocument();
  });

  it('(e) guarda con la misma Idempotency-Key en el reintento tras un error de red y vuelve a Servicios', async () => {
    const registro = servidorDeCarga({
      guardar: (filas, _clave, intento) =>
        intento === 1
          ? HttpResponse.error()
          : HttpResponse.json({ tipo: 'SERVICIOS', creados: revisar(filas).filas, ids: [] }, { status: 201 }),
    });
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    fireEvent.change(campo(1, /nombre/), { target: { value: 'Corte' } });
    fireEvent.change(campo(1, /duración/), { target: { value: '30 min' } });
    fireEvent.change(campo(1, /precio/), { target: { value: 'S/ 25,50' } });
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    await usuario.click(await screen.findByRole('button', { name: 'Guardar 1 servicio' }));
    expect(await screen.findByText(/No se guardó ningún servicio/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));

    expect(await screen.findByText('Se creó 1 servicio')).toBeInTheDocument();
    expect(screen.getByTestId('ruta')).toHaveTextContent('/app/servicios');
    expect(registro.guardados).toHaveLength(2);
    expect(registro.guardados[0].clave).toMatch(/^[0-9a-f-]{36}$/);
    expect(registro.guardados[1].clave).toBe(registro.guardados[0].clave);
    // Precio y duración normalizados al enviar.
    expect(registro.guardados[1].filas[0]).toEqual({
      nombre: 'Corte',
      duracionMinutos: 30,
      precio: '25.50',
      descripcion: null,
    });
  });

  it('(f) CARGA_INVALIDA al guardar marca las filas sin perder lo escrito', async () => {
    servidorDeCarga({
      guardar: () =>
        HttpResponse.json(
          {
            codigo: 'CARGA_INVALIDA',
            mensaje: 'Hay filas con errores.',
            detalles: [{ fila: 1, campo: 'nombre', problema: 'ya_existe' }],
          },
          { status: 400 },
        ),
    });
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    fireEvent.change(campo(1, /nombre/), { target: { value: 'Corte' } });
    fireEvent.change(campo(1, /duración/), { target: { value: '30' } });
    fireEvent.change(campo(1, /precio/), { target: { value: '25' } });
    await usuario.click(screen.getByRole('button', { name: 'Revisar' }));
    await usuario.click(await screen.findByRole('button', { name: 'Guardar 1 servicio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hay 1 fila con errores');
    expect(campo(1, /nombre/)).toHaveValue('Corte');
    expect(campo(1, /nombre/)).toHaveAccessibleDescription(/Ya tienes un servicio con este nombre/);
  });

  it('(g) pegar desde una hoja reparte las filas y se completa con el teclado', async () => {
    const registro = servidorDeCarga();
    renderizar();
    await lista();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Pegar desde una hoja' }));
    const area = screen.getByLabelText('Filas copiadas de la hoja de cálculo');
    fireEvent.change(area, {
      target: { value: 'Nombre\tDuración\tPrecio\nCorte\t30\t25\nBarba\t20\tS/ 15' },
    });
    await usuario.click(screen.getByRole('button', { name: 'Agregar a la tabla' }));
    expect(await filasDeLaLista()).toHaveLength(2);
    expect(campo(2, /precio/)).toHaveValue('15');

    // Solo con el teclado: Revisar y Guardar.
    screen.getByRole('button', { name: 'Revisar' }).focus();
    await usuario.keyboard('{Enter}');
    const guardar = await screen.findByRole('button', { name: 'Guardar 2 servicios' });
    guardar.focus();
    await usuario.keyboard('{Enter}');
    expect(await screen.findByText('Se crearon 2 servicios')).toBeInTheDocument();
    expect(registro.guardados).toHaveLength(1);
  });

  it('(h) en Servicios hay un enlace "Agregar varios"; un barbero no ve la pantalla', async () => {
    servidorDeCarga();
    renderizar('/app/servicios');
    expect(await screen.findByRole('link', { name: 'Agregar varios' })).toHaveAttribute('href', RUTA);
  });

  it('(h bis) con sesión de barbero la ruta no muestra la carga', async () => {
    servidor.use(
      sesion('BARBERO'),
      http.get('/api/v1/servicios', () => HttpResponse.json([])),
    );
    renderizar();
    expect(await screen.findByTestId('ruta')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agregar varios servicios' })).not.toBeInTheDocument();
  });
});
