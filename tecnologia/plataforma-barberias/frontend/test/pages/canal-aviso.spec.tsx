import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { canalDeAviso, preferenciaDePrueba } from '../msw-handlers';
import { servidor } from '../setup';

// T111 · Canal de aviso del cliente (/mis-avisos, RF33; research R15). Ruta propia solo con sesión de cliente y
// un enlace desde Mis citas. Elegir WhatsApp muestra el número propuesto (su teléfono), el texto del consentimiento
// con su versión y una casilla obligatoria; se puede retirar el consentimiento. Estados cargando y error; todo se
// puede hacer solo con el teclado.

const SLUG = 'barberia-huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };

const sesion = (rol: 'CLIENTE' | 'PROPIETARIO') =>
  http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Luis',
        correo: 'luis@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );

function renderizar(ruta = '/mis-avisos') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const titulo = () => screen.findByRole('heading', { level: 1, name: /cómo recibo mis avisos/i });

afterEach(() => tokenEnMemoria.limpiar());

describe('Canal de aviso (/mis-avisos, T111)', () => {
  it('se llega desde Mis citas con el enlace "Cómo recibo mis avisos"', async () => {
    servidor.use(
      sesion('CLIENTE'),
      ...canalDeAviso(),
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
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({ total: 0, pagina: 1, tamano: 10, elementos: [] }),
      ),
    );
    renderizar('/mis-citas');
    await userEvent.setup().click(await screen.findByRole('link', { name: /cómo recibo mis avisos/i }));
    expect(await titulo()).toBeInTheDocument();
  });

  it('solo con sesión de cliente: el propietario vuelve a su panel', async () => {
    servidor.use(sesion('PROPIETARIO'), ...canalDeAviso());
    renderizar();
    await screen.findByRole('navigation', {}, { timeout: 10_000 }).catch(() => undefined);
    expect(screen.queryByRole('heading', { name: /cómo recibo mis avisos/i })).not.toBeInTheDocument();
  });

  it('elegir WhatsApp: número propuesto, texto y versión visibles, y la casilla es obligatoria', async () => {
    const recibidos: unknown[] = [];
    servidor.use(sesion('CLIENTE'), ...canalDeAviso(preferenciaDePrueba(), recibidos));
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('radio', { name: /whatsapp/i }));

    const numero = screen.getByLabelText(/número de whatsapp/i);
    expect(numero).toHaveValue('987654321');
    const consentimiento = screen.getByRole('group', { name: /consentimiento/i });
    expect(consentimiento).toHaveTextContent(/Barbería Huamanga/);
    expect(consentimiento).toHaveTextContent('987654321');
    expect(consentimiento).toHaveTextContent(/versión 2026-11/i);

    // Sin marcar la casilla no se envía nada.
    await usuario.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/marca la casilla/i);
    expect(recibidos).toEqual([]);

    await usuario.click(screen.getByRole('checkbox', { name: /acepto recibir mis avisos por whatsapp/i }));
    await usuario.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/tus avisos llegarán por whatsapp/i);
    expect(recibidos).toEqual([
      { canal: 'WHATSAPP', numeroWhatsapp: '987654321', aceptaWhatsapp: true, versionTexto: '2026-11' },
    ]);
  });

  it('cambiar el número exige volver a aceptar', async () => {
    const recibidos: unknown[] = [];
    servidor.use(
      sesion('CLIENTE'),
      ...canalDeAviso(
        preferenciaDePrueba({
          canal: 'WHATSAPP',
          numeroWhatsapp: '987654321',
          consentimientoVigente: true,
          aceptadoEn: '2026-11-01T10:00:00-05:00',
        }),
        recibidos,
      ),
    );
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    const numero = screen.getByLabelText(/número de whatsapp/i);
    await usuario.clear(numero);
    await usuario.type(numero, '900111222');
    expect(
      screen.getByRole('checkbox', { name: /acepto recibir mis avisos por whatsapp/i }),
    ).not.toBeChecked();
    await usuario.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/marca la casilla/i);
    expect(recibidos).toEqual([]);
  });

  it('retirar el consentimiento vuelve al correo', async () => {
    const recibidos: unknown[] = [];
    servidor.use(
      sesion('CLIENTE'),
      ...canalDeAviso(
        preferenciaDePrueba({
          canal: 'WHATSAPP',
          numeroWhatsapp: '987654321',
          consentimientoVigente: true,
          aceptadoEn: '2026-11-01T10:00:00-05:00',
        }),
        recibidos,
      ),
    );
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: /retirar mi consentimiento/i }));
    const modal = await screen.findByRole('alertdialog');
    await usuario.click(within(modal).getByRole('button', { name: /sí, retirar/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/tus avisos llegarán por correo/i);
    expect(recibidos).toEqual(['DELETE']);
    expect(await screen.findByRole('radio', { name: /correo/i })).toBeChecked();
  });

  it('muestra "cargando" y, si falla, el error con reintento', async () => {
    let intentos = 0;
    servidor.use(
      sesion('CLIENTE'),
      http.get('/api/v1/clientes/yo/aviso', async () => {
        intentos += 1;
        await delay(200);
        if (intentos === 1) return HttpResponse.error();
        return HttpResponse.json(preferenciaDePrueba());
      }),
    );
    renderizar();
    expect(await screen.findByText(/cargando tu canal de aviso/i)).toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole('button', { name: /intentar de nuevo/i }));
    expect(await screen.findByRole('radio', { name: /correo/i })).toBeChecked();
  });

  it('se completa solo con el teclado', async () => {
    const recibidos: unknown[] = [];
    servidor.use(sesion('CLIENTE'), ...canalDeAviso(preferenciaDePrueba(), recibidos));
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    const tabularHasta = async (prueba: (el: HTMLElement) => boolean) => {
      for (let i = 0; i < 40; i += 1) {
        await usuario.tab();
        const activo = document.activeElement as HTMLElement | null;
        if (activo && prueba(activo)) return;
      }
      throw new Error('No se llegó con Tab al control');
    };
    await tabularHasta((el) => el.getAttribute('type') === 'radio');
    // Las flechas mueven la elección dentro del grupo de radios.
    await usuario.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /whatsapp/i })).toBeChecked();
    await tabularHasta((el) => el.getAttribute('type') === 'checkbox');
    await usuario.keyboard(' ');
    await tabularHasta((el) => /guardar/i.test(el.textContent ?? ''));
    await usuario.keyboard('{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent(/tus avisos llegarán por whatsapp/i);
    expect(recibidos).toHaveLength(1);
  });
});
