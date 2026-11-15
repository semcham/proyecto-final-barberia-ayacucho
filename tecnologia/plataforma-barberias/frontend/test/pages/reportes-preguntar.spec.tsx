import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T051 de 005 · La pestaña "Preguntar" de /app/reportes (US3; FR-007, FR-008, FR-026 a FR-028): el propietario
// pregunta en lenguaje natural y la respuesta aparece en una región que se anuncia (aria-live); la cuota agotada y "no
// disponible" se avisan con la alternativa de las tablas; y las tablas siguen funcionando aunque el asistente falle.

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};
const CUOTA = { restantesUsuario: 19, restantesBarberia: 199, reiniciaEn: '2026-11-15T00:00:00-05:00' };
const PERIODO = { desde: '2026-11-01', hasta: '2026-11-14', zonaHoraria: 'America/Lima' };
const CITAS = {
  total: 9,
  pendientes: 1,
  confirmadas: 1,
  completadas: 4,
  noAsistio: 1,
  canceladas: 2,
  canceladasTardias: 1,
};

const RESUMEN = {
  texto:
    'Del 1 de noviembre de 2026 al 14 de noviembre de 2026 tuviste 9 citas: 4 completadas, 1 confirmada, ' +
    '1 pendiente, 1 sin asistencia y 2 canceladas (1 tardía).',
  resultado: 'RESPONDIDA',
  datos: { tipo: 'RESUMEN_CITAS', periodo: PERIODO, citas: CITAS },
  cuota: CUOTA,
};

const MAS_PEDIDOS = {
  texto:
    'Del 2 de noviembre de 2026 al 8 de noviembre de 2026, el servicio más pedido fue Barba con 3 citas. ' +
    'Le siguen: Corte clásico (2).',
  resultado: 'RESPONDIDA',
  datos: {
    tipo: 'SERVICIOS_MAS_PEDIDOS',
    periodo: { ...PERIODO, desde: '2026-11-02', hasta: '2026-11-08' },
    servicios: [
      { nombre: 'Barba', citas: 3 },
      { nombre: 'Corte clásico', citas: 2 },
    ],
  },
  cuota: CUOTA,
};

const sesion = http.post('/api/v1/auth/refresh', () =>
  HttpResponse.json({
    tokenAcceso: 'token-PROPIETARIO',
    tipo: 'Bearer',
    expiraEn: 900,
    usuario: {
      id: '0190a1b2-0000-7000-8000-000000000001',
      nombre: 'Rosa Quispe',
      correo: 'rosa@prueba.pe',
      rol: 'PROPIETARIO',
      barberia: BARBERIA,
    },
  }),
);

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

/** Los reportes en tablas y el asistente; guarda las preguntas recibidas y cuántas veces se pidieron las tablas. */
function servidorDelPropietario(
  responder: (cuerpo: { mensaje: string }) => Response = () => HttpResponse.json(RESUMEN),
) {
  const registro = { preguntas: [] as { mensaje: string; contexto?: unknown[] }[], reportes: 0 };
  servidor.use(
    sesion,
    barberia,
    http.get('/api/v1/reportes', ({ request }) => {
      registro.reportes += 1;
      const url = new URL(request.url);
      return HttpResponse.json({
        periodo: {
          desde: url.searchParams.get('desde'),
          hasta: url.searchParams.get('hasta'),
          zonaHoraria: 'America/Lima',
        },
        citas: CITAS,
        serviciosMasSolicitados: [{ nombre: 'Barba', citas: 3 }],
        actividad: {
          porBarbero: [{ barbero: 'Luis', citas: 9 }],
          porDiaDeSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, citas: dia === 1 ? 9 : 0 })),
          cancelacionesTardias: 1,
          noAsistencias: 1,
        },
      });
    }),
    http.post('/api/v1/asistente/mensajes', async ({ request }) => {
      const cuerpo = (await request.json()) as { mensaje: string };
      registro.preguntas.push(cuerpo);
      return responder(cuerpo);
    }),
  );
  return registro;
}

function renderizar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/reportes']}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function abrirPreguntar() {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('tab', { name: 'Preguntar' }));
  return usuario;
}

async function preguntarEnPantalla(usuario: ReturnType<typeof userEvent.setup>, texto: string) {
  const campo = await screen.findByLabelText('Tu pregunta');
  await usuario.clear(campo);
  await usuario.type(campo, texto);
  await usuario.click(screen.getByRole('button', { name: 'Preguntar' }));
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Reportes · pestaña "Preguntar" (/app/reportes)', () => {
  it('hay dos pestañas, "Tablas" (la elegida al entrar) y "Preguntar"', async () => {
    servidorDelPropietario();
    renderizar();
    const pestanas = await screen.findByRole('tablist', { name: 'Reportes' });
    expect(
      within(pestanas)
        .getAllByRole('tab')
        .map((p) => p.textContent),
    ).toEqual(['Tablas', 'Preguntar']);
    expect(screen.getByRole('tab', { name: 'Tablas' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('table', { name: 'Citas por estado' })).toBeInTheDocument();
    // La pestaña "Preguntar" está montada (para no perder la conversación), pero oculta.
    expect(screen.queryByRole('textbox', { name: 'Tu pregunta' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tu pregunta')).not.toBeVisible();
  });

  it('envía la pregunta y muestra la respuesta en una región que se anuncia', async () => {
    const registro = servidorDelPropietario();
    renderizar();
    const usuario = await abrirPreguntar();
    expect(screen.getByRole('tab', { name: 'Preguntar' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Preguntar' })).toBeInTheDocument();
    await preguntarEnPantalla(usuario, '¿Cuántas citas tuve este mes?');
    const conversacion = screen.getByRole('log', { name: 'Conversación' });
    expect(conversacion).toHaveAttribute('aria-live', 'polite');
    expect(await within(conversacion).findByText(RESUMEN.texto)).toBeInTheDocument();
    expect(within(conversacion).getByText('¿Cuántas citas tuve este mes?')).toBeInTheDocument();
    expect(registro.preguntas).toEqual([{ mensaje: '¿Cuántas citas tuve este mes?', contexto: [] }]);
  });

  it('los servicios más pedidos se muestran con el texto del servidor, y la conversación sigue al cambiar de pestaña', async () => {
    servidorDelPropietario(() => HttpResponse.json(MAS_PEDIDOS));
    renderizar();
    const usuario = await abrirPreguntar();
    await preguntarEnPantalla(usuario, '¿Cuál fue el servicio más pedido la semana pasada?');
    expect(await screen.findByText(MAS_PEDIDOS.texto)).toBeInTheDocument();
    await usuario.click(screen.getByRole('tab', { name: 'Tablas' }));
    expect(await screen.findByRole('table', { name: 'Citas por estado' })).toBeInTheDocument();
    await usuario.click(screen.getByRole('tab', { name: 'Preguntar' }));
    expect(screen.getByText(MAS_PEDIDOS.texto)).toBeInTheDocument();
  });

  it('con la cuota agotada dice cuándo se reinicia y ofrece ver las tablas', async () => {
    servidorDelPropietario(() =>
      HttpResponse.json(
        {
          codigo: 'CUOTA_ASISTENTE_AGOTADA',
          mensaje: 'Llegaste al límite de preguntas de hoy.',
          detalles: [
            { alcance: 'USUARIO', reiniciaEn: '2026-11-15T00:00:00-05:00', reintentarEnSegundos: 600 },
          ],
        },
        { status: 429, headers: { 'Retry-After': '600' } },
      ),
    );
    renderizar();
    const usuario = await abrirPreguntar();
    await preguntarEnPantalla(usuario, 'resumen de hoy');
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Llegaste al límite de preguntas de hoy.');
    expect(aviso).toHaveTextContent('15 de noviembre de 2026, 00:00');
    await usuario.click(screen.getByRole('button', { name: 'Ver las tablas' }));
    expect(screen.getByRole('tab', { name: 'Tablas' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('table', { name: 'Citas por estado' })).toBeInTheDocument();
  });

  it('"no disponible": lo avisa con la alternativa de las tablas, y las tablas siguen funcionando', async () => {
    const registro = servidorDelPropietario(() =>
      HttpResponse.json(
        {
          codigo: 'ASISTENTE_NO_DISPONIBLE',
          mensaje: 'El asistente no está disponible ahora. Puedes ver las tablas de los reportes.',
          detalles: [{ alternativa: { tipo: 'REPORTES' } }],
        },
        { status: 503 },
      ),
    );
    renderizar();
    const usuario = await abrirPreguntar();
    await preguntarEnPantalla(usuario, '¿Cuántas citas tuve este mes?');
    expect(await screen.findByRole('alert')).toHaveTextContent('no está disponible');
    const antes = registro.reportes;
    await usuario.click(screen.getByRole('button', { name: 'Ver las tablas' }));
    expect(await screen.findByRole('table', { name: 'Citas por estado' })).toBeInTheDocument();
    // Y se pueden pedir otras fechas con el asistente caído.
    await usuario.clear(screen.getByLabelText('Desde'));
    await usuario.type(screen.getByLabelText('Desde'), '2026-10-01');
    await usuario.clear(screen.getByLabelText('Hasta'));
    await usuario.type(screen.getByLabelText('Hasta'), '2026-10-31');
    await usuario.click(screen.getByRole('button', { name: 'Ver reportes' }));
    await screen.findByText(/del 1 de octubre de 2026 al 31 de octubre de 2026/i);
    expect(registro.reportes).toBeGreaterThan(antes);
  });

  it('las pestañas se manejan con el teclado (flechas)', async () => {
    servidorDelPropietario();
    renderizar();
    const usuario = userEvent.setup();
    const tablas = await screen.findByRole('tab', { name: 'Tablas' });
    tablas.focus();
    await usuario.keyboard('{ArrowRight}');
    const preguntar = screen.getByRole('tab', { name: 'Preguntar' });
    expect(preguntar).toHaveFocus();
    expect(preguntar).toHaveAttribute('aria-selected', 'true');
    expect(tablas).toHaveAttribute('tabindex', '-1');
    await usuario.keyboard('{ArrowLeft}');
    expect(tablas).toHaveFocus();
    expect(tablas).toHaveAttribute('aria-selected', 'true');
  });
});
