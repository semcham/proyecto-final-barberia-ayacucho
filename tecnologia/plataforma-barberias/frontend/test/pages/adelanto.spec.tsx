import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { adelantoDePrueba, type ConfiguracionAdelantoDePrueba, type RecibidoAdelanto } from '../msw-handlers';
import { servidor } from '../setup';

// T015 de 008 · Configuración del adelanto del propietario (/app/adelanto; US1, FR-001 a FR-003): solo el
// propietario; elegir tipo, valor y plazo; subir el QR con vista previa; error si se activa sin QR; estados de
// carga y de error; y todo solo con el teclado.

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
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Rosa Quispe',
        correo: 'rosa@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );
}

function servidorDelAdelanto(inicial?: ConfiguracionAdelantoDePrueba): RecibidoAdelanto {
  const recibido: RecibidoAdelanto = { cambios: [], qrs: [] };
  servidor.use(sesion('PROPIETARIO'), ...adelantoDePrueba(inicial, recibido));
  return recibido;
}

function renderizar(ruta = '/app/adelanto') {
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

const PNG = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'qr-yape.png', {
    type: 'image/png',
  });

const formulario = () => screen.findByRole('form', { name: 'Configuración del adelanto' });

afterEach(() => {
  tokenEnMemoria.limpiar();
  vi.restoreAllMocks();
});

describe('Configuración del adelanto (/app/adelanto)', () => {
  it('el propietario la ve en el menú del panel', async () => {
    servidorDelAdelanto();
    renderizar('/app');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).getByRole('link', { name: 'Adelanto' })).toHaveAttribute(
      'href',
      '/app/adelanto',
    );
  });

  it('un barbero que abre /app/adelanto vuelve al inicio del panel, sin pedir la configuración', async () => {
    const pedidas: string[] = [];
    servidor.use(
      sesion('BARBERO'),
      http.get('/api/v1/barberia/adelanto', () => {
        pedidas.push('GET');
        return HttpResponse.json({ activo: false, tieneQr: false });
      }),
    );
    renderizar();
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).queryByRole('link', { name: 'Adelanto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Configuración del adelanto' })).not.toBeInTheDocument();
    expect(pedidas).toEqual([]);
  });

  it('activa un porcentaje del 20 % con 30 minutos para pagar', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: true });
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.click(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' }));
    await usuario.click(within(form).getByRole('radio', { name: 'Porcentaje del precio' }));
    await usuario.type(within(form).getByLabelText('Porcentaje (%)'), '20');
    await usuario.clear(within(form).getByLabelText('Plazo para pagar (minutos)'));
    await usuario.type(within(form).getByLabelText('Plazo para pagar (minutos)'), '30');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Adelanto guardado')).toBeInTheDocument();
    expect(recibido.cambios).toEqual([
      { activo: true, tipo: 'PORCENTAJE', porcentaje: 20, plazoMinutos: 30 },
    ]);
  });

  it('un monto fijo en soles se envía en céntimos', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: true });
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.click(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' }));
    await usuario.click(within(form).getByRole('radio', { name: 'Monto fijo' }));
    await usuario.type(within(form).getByLabelText('Monto (S/)'), '12.50');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Adelanto guardado')).toBeInTheDocument();
    expect(recibido.cambios).toEqual([{ activo: true, tipo: 'FIJO', montoCentimos: 1250, plazoMinutos: 30 }]);
  });

  it('muestra la configuración guardada y permite desactivarla', async () => {
    const recibido = servidorDelAdelanto({
      activo: true,
      tipo: 'FIJO',
      montoCentimos: 1000,
      plazoMinutos: 45,
      tieneQr: true,
    });
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    expect(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' })).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'Monto fijo' })).toBeChecked();
    expect(within(form).getByLabelText('Monto (S/)')).toHaveValue('10.00');
    expect(within(form).getByLabelText('Plazo para pagar (minutos)')).toHaveValue(45);
    await usuario.click(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' }));
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Adelanto guardado')).toBeInTheDocument();
    expect(recibido.cambios).toEqual([
      { activo: false, tipo: 'FIJO', montoCentimos: 1000, plazoMinutos: 45 },
    ]);
  });

  it('valida los rangos sin llamar al servidor', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: true });
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.click(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' }));
    await usuario.click(within(form).getByRole('radio', { name: 'Monto fijo' }));
    await usuario.type(within(form).getByLabelText('Monto (S/)'), '600');
    await usuario.clear(within(form).getByLabelText('Plazo para pagar (minutos)'));
    await usuario.type(within(form).getByLabelText('Plazo para pagar (minutos)'), '5');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(form).findByText('El monto debe estar entre S/ 1.00 y S/ 500.00.'),
    ).toBeInTheDocument();
    expect(
      within(form).getByText('El plazo debe estar entre 10 y 1440 minutos (24 horas).'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('Monto (S/)')).toHaveAttribute('aria-invalid', 'true');
    expect(recibido.cambios).toEqual([]);
  });

  it('activar sin QR muestra el error y no guarda', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: false });
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.click(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' }));
    await usuario.click(within(form).getByRole('radio', { name: 'Monto fijo' }));
    await usuario.type(within(form).getByLabelText('Monto (S/)'), '10');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));

    expect(
      await within(form).findByText('Sube el QR de Yape o Plin de tu barbería antes de activar el adelanto.'),
    ).toBeInTheDocument();
    expect(recibido.cambios).toEqual([]);
  });

  it('si el servidor responde QR_REQUERIDO, muestra el mismo error', async () => {
    servidorDelAdelanto({ activo: false, tieneQr: true });
    servidor.use(
      http.put('/api/v1/barberia/adelanto', () =>
        HttpResponse.json(
          { codigo: 'QR_REQUERIDO', mensaje: 'Sube el QR antes de activar.', detalles: [] },
          { status: 422 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.click(within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' }));
    await usuario.click(within(form).getByRole('radio', { name: 'Monto fijo' }));
    await usuario.type(within(form).getByLabelText('Monto (S/)'), '10');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(
      await within(form).findByText('Sube el QR de Yape o Plin de tu barbería antes de activar el adelanto.'),
    ).toBeInTheDocument();
  });

  it('sube el QR con vista previa y después muestra el QR guardado', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: false });
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:qr-${++n}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderizar();
    const usuario = userEvent.setup();
    const formQr = await screen.findByRole('form', { name: 'QR de Yape o Plin' });
    expect(within(formQr).getByText('Todavía no subiste el QR de tu barbería.')).toBeInTheDocument();

    await usuario.upload(within(formQr).getByLabelText('Imagen del QR'), PNG());
    expect(within(formQr).getByRole('img', { name: 'Vista previa del QR elegido' })).toHaveAttribute(
      'src',
      'blob:qr-1',
    );
    await usuario.click(within(formQr).getByRole('button', { name: 'Subir QR' }));

    expect(await screen.findByText('QR guardado')).toBeInTheDocument();
    expect(recibido.qrs).toHaveLength(1);
    expect(recibido.qrs[0]).toBeGreaterThan(11);
    const guardado = await within(formQr).findByRole('img', { name: 'QR de Yape o Plin de tu barbería' });
    expect(guardado.getAttribute('src')).toMatch(/^blob:qr-/);
  });

  it('un QR de más de 1 MB o que no es imagen se rechaza sin llamar al servidor', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: false });
    renderizar();
    const usuario = userEvent.setup({ applyAccept: false });
    const formQr = await screen.findByRole('form', { name: 'QR de Yape o Plin' });
    const grande = new File([new Uint8Array(1024 * 1024 + 1)], 'qr.png', { type: 'image/png' });
    await usuario.upload(within(formQr).getByLabelText('Imagen del QR'), grande);
    await usuario.click(within(formQr).getByRole('button', { name: 'Subir QR' }));
    expect(await within(formQr).findByText('La imagen pesa más de 1 MB.')).toBeInTheDocument();

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'qr.pdf', {
      type: 'application/pdf',
    });
    await usuario.upload(within(formQr).getByLabelText('Imagen del QR'), pdf);
    await usuario.click(within(formQr).getByRole('button', { name: 'Subir QR' }));
    expect(await within(formQr).findByText('El QR debe ser una imagen JPG o PNG.')).toBeInTheDocument();
    expect(recibido.qrs).toEqual([]);
  });

  it('mientras carga lo anuncia y, si falla, muestra el error', async () => {
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/barberia/adelanto', async () => {
        await delay(150);
        return HttpResponse.json(
          {
            codigo: 'ERROR_INTERNO',
            mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.',
            detalles: [],
          },
          { status: 500 },
        );
      }),
      http.get('/api/v1/barberia/adelanto/qr', () =>
        HttpResponse.json(
          { codigo: 'NO_ENCONTRADO', mensaje: 'No encontrado', detalles: [] },
          { status: 404 },
        ),
      ),
    );
    renderizar();
    expect(await screen.findByText('Cargando la configuración del adelanto…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ocurrió un error inesperado. Intenta de nuevo.',
    );
  });

  it('se usa solo con el teclado: activar, elegir el tipo, escribir y guardar', async () => {
    const recibido = servidorDelAdelanto({ activo: false, tieneQr: true });
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    const activo = within(form).getByRole('checkbox', { name: 'Pedir adelanto en las reservas' });
    activo.focus();
    await usuario.keyboard(' ');
    expect(activo).toBeChecked();
    await usuario.tab();
    expect(within(form).getByRole('radio', { name: 'Monto fijo' })).toHaveFocus();
    await usuario.keyboard('{ArrowDown}');
    const porcentaje = within(form).getByRole('radio', { name: 'Porcentaje del precio' });
    expect(porcentaje).toBeChecked();
    await usuario.tab();
    expect(within(form).getByLabelText('Porcentaje (%)')).toHaveFocus();
    await usuario.keyboard('25');
    await usuario.tab();
    expect(within(form).getByLabelText('Plazo para pagar (minutos)')).toHaveFocus();
    await usuario.keyboard('{Enter}');

    expect(await screen.findByText('Adelanto guardado')).toBeInTheDocument();
    expect(recibido.cambios).toEqual([
      { activo: true, tipo: 'PORCENTAJE', porcentaje: 25, plazoMinutos: 30 },
    ]);
  });
});
