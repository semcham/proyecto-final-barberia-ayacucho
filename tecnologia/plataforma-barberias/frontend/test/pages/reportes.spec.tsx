import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { fechaIsoDeBarberia } from '../../src/hora-barberia';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T020 de 005 · Reportes del propietario (/app/reportes; US2, FR-020 y FR-024): el período se elige con dos fechas
// etiquetadas (por defecto, el mes en curso de la barbería); tres reportes en tablas con encabezados, sin gráficos;
// un período inválido muestra el mensaje del servidor junto al campo y lo anuncia; un período sin citas muestra el
// estado vacío; solo el propietario ve la ruta y su entrada del menú.

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};

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

const barberia = http.get('/api/v1/barberia', () =>
  HttpResponse.json({
    ...BARBERIA,
    direccion: null,
    telefono: null,
    descripcion: null,
    zonaHoraria: 'America/Lima',
    antelacionCancelacionMinutos: 120,
  }),
);

const ceros = (desde: string, hasta: string) => ({
  periodo: { desde, hasta, zonaHoraria: 'America/Lima' },
  citas: {
    total: 0,
    pendientes: 0,
    confirmadas: 0,
    completadas: 0,
    noAsistio: 0,
    canceladas: 0,
    canceladasTardias: 0,
  },
  serviciosMasSolicitados: [],
  actividad: {
    porBarbero: [],
    porDiaDeSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, citas: 0 })),
    cancelacionesTardias: 0,
    noAsistencias: 0,
  },
});

const conCitas = (desde: string, hasta: string) => ({
  ...ceros(desde, hasta),
  citas: {
    total: 9,
    pendientes: 1,
    confirmadas: 1,
    completadas: 4,
    noAsistio: 1,
    canceladas: 2,
    canceladasTardias: 1,
  },
  serviciosMasSolicitados: [
    { nombre: 'Barba', citas: 3 },
    { nombre: 'Corte clásico', citas: 3 },
    { nombre: 'Corte antiguo', citas: 1 },
  ],
  actividad: {
    porBarbero: [
      { barbero: 'Luis', citas: 5 },
      { barbero: 'Ana', citas: 4 },
    ],
    porDiaDeSemana: [1, 2, 1, 2, 1, 1, 1].map((citas, i) => ({ dia: i + 1, citas })),
    cancelacionesTardias: 1,
    noAsistencias: 1,
  },
});

/** Mes en curso en America/Lima: del día 1 al último día. */
function mesEnCurso(): { desde: string; hasta: string } {
  const hoy = fechaIsoDeBarberia(new Date(), 'America/Lima');
  const [anio, mes] = hoy.split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, '0');
  return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

interface Pedido {
  desde: string | null;
  hasta: string | null;
}

/** El servidor de los reportes: responde con citas, en cero o 422, y guarda cada consulta recibida. */
function servidorDeReportes(
  responder: (p: Pedido) => Response = (p) => HttpResponse.json(conCitas(p.desde!, p.hasta!)),
) {
  const pedidos: Pedido[] = [];
  servidor.use(
    sesion('PROPIETARIO'),
    barberia,
    http.get('/api/v1/reportes', ({ request }) => {
      const url = new URL(request.url);
      const pedido = { desde: url.searchParams.get('desde'), hasta: url.searchParams.get('hasta') };
      pedidos.push(pedido);
      return responder(pedido);
    }),
  );
  return pedidos;
}

function renderizar(ruta = '/app/reportes') {
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

const filasDe = (tabla: HTMLElement) =>
  within(tabla)
    .getAllByRole('row')
    .slice(1)
    .map((fila) =>
      within(fila)
        .getAllByRole('cell')
        .map((celda) => celda.textContent?.trim()),
    );

afterEach(() => {
  tokenEnMemoria.limpiar();
});

describe('Reportes (/app/reportes)', () => {
  it('el propietario la ve en el menú', async () => {
    servidorDeReportes();
    renderizar('/app');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).getByRole('link', { name: 'Reportes' })).toHaveAttribute(
      'href',
      '/app/reportes',
    );
  });

  it('un barbero no ve la entrada y, si abre /app/reportes, no se piden los reportes', async () => {
    const pedidos: string[] = [];
    servidor.use(
      sesion('BARBERO'),
      barberia,
      http.get('/api/v1/reportes', () => {
        pedidos.push('GET');
        return HttpResponse.json({});
      }),
    );
    renderizar();
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Reportes' })).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it('por defecto pide el mes en curso, con dos fechas etiquetadas', async () => {
    const pedidos = servidorDeReportes();
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Reportes' })).toBeInTheDocument();
    const { desde, hasta } = mesEnCurso();
    expect(screen.getByLabelText('Desde')).toHaveValue(desde);
    expect(screen.getByLabelText('Hasta')).toHaveValue(hasta);
    await screen.findByRole('table', { name: 'Citas por estado' });
    expect(pedidos[0]).toEqual({ desde, hasta });
  });

  it('muestra los tres reportes en tablas con encabezados, sin gráficos', async () => {
    servidorDeReportes();
    const { container } = renderizar();

    const citas = await screen.findByRole('table', { name: 'Citas por estado' });
    expect(
      within(citas)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Estado', 'Citas']);
    expect(filasDe(citas)).toEqual([
      ['Pendientes', '1'],
      ['Confirmadas', '1'],
      ['Completadas', '4'],
      ['No asistió', '1'],
      ['Canceladas', '2'],
      ['De ellas, canceladas tarde', '1'],
      ['Total', '9'],
    ]);

    const servicios = screen.getByRole('table', { name: 'Servicios más solicitados' });
    expect(
      within(servicios)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Puesto', 'Servicio', 'Citas']);
    expect(filasDe(servicios)).toEqual([
      ['1', 'Barba', '3'],
      ['2', 'Corte clásico', '3'],
      ['3', 'Corte antiguo', '1'],
    ]);

    const porBarbero = screen.getByRole('table', { name: 'Citas por barbero' });
    expect(filasDe(porBarbero)).toEqual([
      ['Luis', '5'],
      ['Ana', '4'],
    ]);
    const porDia = screen.getByRole('table', { name: 'Citas por día de la semana' });
    expect(filasDe(porDia)).toEqual([
      ['Lunes', '1'],
      ['Martes', '2'],
      ['Miércoles', '1'],
      ['Jueves', '2'],
      ['Viernes', '1'],
      ['Sábado', '1'],
      ['Domingo', '1'],
    ]);
    const totales = screen.getByRole('table', { name: 'Cancelaciones tardías y no asistencias' });
    expect(filasDe(totales)).toEqual([
      ['Cancelaciones tardías', '1'],
      ['No asistencias', '1'],
    ]);

    // Sin gráficos (FR-024): ni canvas ni imágenes de datos.
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('al cambiar el período y pulsar "Ver reportes" pide el período nuevo', async () => {
    const pedidos = servidorDeReportes();
    renderizar();
    await screen.findByRole('table', { name: 'Citas por estado' });
    const usuario = userEvent.setup();
    await usuario.clear(screen.getByLabelText('Desde'));
    await usuario.type(screen.getByLabelText('Desde'), '2026-10-01');
    await usuario.clear(screen.getByLabelText('Hasta'));
    await usuario.type(screen.getByLabelText('Hasta'), '2026-10-31');
    await usuario.click(screen.getByRole('button', { name: 'Ver reportes' }));
    await screen.findByText(/del 1 de octubre de 2026 al 31 de octubre de 2026/i);
    expect(pedidos.at(-1)).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
  });

  it('un período inválido muestra el mensaje del servidor junto al campo y lo anuncia', async () => {
    servidorDeReportes((p) =>
      p.desde === '2026-11-30'
        ? HttpResponse.json(
            {
              codigo: 'VALIDACION',
              mensaje: 'La fecha de inicio debe ser anterior o igual a la de fin.',
              detalles: [{ campo: 'desde', problema: 'posterior_a_hasta' }],
            },
            { status: 422 },
          )
        : HttpResponse.json(conCitas(p.desde!, p.hasta!)),
    );
    renderizar();
    await screen.findByRole('table', { name: 'Citas por estado' });
    const usuario = userEvent.setup();
    await usuario.clear(screen.getByLabelText('Desde'));
    await usuario.type(screen.getByLabelText('Desde'), '2026-11-30');
    await usuario.clear(screen.getByLabelText('Hasta'));
    await usuario.type(screen.getByLabelText('Hasta'), '2026-11-01');
    await usuario.click(screen.getByRole('button', { name: 'Ver reportes' }));

    const mensaje = 'La fecha de inicio debe ser anterior o igual a la de fin.';
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
    const campo = screen.getByLabelText('Desde');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription(expect.stringContaining(mensaje));
    // Con el período inválido no se muestran cifras viejas.
    expect(screen.queryByRole('table', { name: 'Citas por estado' })).not.toBeInTheDocument();
  });

  it('un período sin citas muestra el estado vacío, no un error', async () => {
    servidorDeReportes((p) => HttpResponse.json(ceros(p.desde!, p.hasta!)));
    renderizar();
    expect(await screen.findByText('No hay citas en este período')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Servicios más solicitados' })).not.toBeInTheDocument();
  });

  it('si el servidor falla, lo dice y deja reintentar', async () => {
    servidorDeReportes(() =>
      HttpResponse.json(
        { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado.', detalles: [] },
        { status: 500 },
      ),
    );
    renderizar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
