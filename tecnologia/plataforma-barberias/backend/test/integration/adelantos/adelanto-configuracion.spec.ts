import { createHash } from 'node:crypto';
import {
  archivosDeAdelanto,
  cambiarConfiguracion,
  filaConfiguracion,
  subirQr,
  verConfiguracion,
  verQr,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { jpeg, pdf, png } from '../../helpers/comprobantes';
import {
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarFilas008,
  sembrarServicio,
} from '../../helpers/fixtures';
import { barberiaEnPrueba } from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T012 de 008 · Configuración del adelanto por el propietario (US1-1 a US1-4; FR-001 a FR-004, FR-030):
// activar con monto fijo o porcentaje, rangos y QR validados (por sus bytes, privado y sin caché), y los cambios
// solo para las reservas nuevas. Con la suscripción vencida no se cambia nada.

const DIA_MS = 24 * 60 * 60 * 1000;
const UN_MB = 1024 * 1024;

describe('Configuración del adelanto (T012, US1)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Barbería en prueba con su QR ya subido. */
  async function conQr() {
    const b = await barberiaEnPrueba();
    const qr = png();
    await subirQr(prueba, b.token, qr).expect(200);
    return { ...b, qr };
  }

  describe('sin configurar', () => {
    it('GET responde inactivo y sin QR, sin crear nada', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await verConfiguracion(prueba, b.token).expect(200);
      expect(body).toEqual({ activo: false, tieneQr: false });
      expect(await filaConfiguracion(b.tenantId)).toBeUndefined();
    });

    it('GET /barberia/adelanto/qr sin QR → 404', async () => {
      const b = await barberiaEnPrueba();
      const r = await verQr(prueba, b.token).expect(404);
      expect(JSON.parse(r.body.toString('utf8')).codigo).toBe('NO_ENCONTRADO');
    });
  });

  describe('subir el QR', () => {
    it.each([
      ['PNG', png, 'image/png'],
      ['JPEG', jpeg, 'image/jpeg'],
    ] as const)(
      'un %s queda guardado privado, con su tipo por los bytes, tamaño y SHA-256',
      async (_n, crear, tipo) => {
        const b = await barberiaEnPrueba();
        const qr = crear();
        const { body } = await subirQr(prueba, b.token, qr, 'cualquier-nombre.txt').expect(200);
        expect(body).toMatchObject({ activo: false, tieneQr: true });
        const [archivo] = await archivosDeAdelanto(b.tenantId);
        expect(archivo).toMatchObject({
          kind: 'QR',
          content_type: tipo,
          size_bytes: qr.length,
          sha256: createHash('sha256').update(qr).digest('hex'),
          created_by: b.propietarioId,
        });
        expect((archivo.content as Buffer).equals(qr)).toBe(true);
        expect(await filaConfiguracion(b.tenantId)).toMatchObject({ enabled: false, qr_file_id: archivo.id });
      },
    );

    it('se sirve solo con sesión, con su tipo, no-store y nosniff (sin URL pública)', async () => {
      const b = await conQr();
      const r = await verQr(prueba, b.token).expect(200);
      expect(r.headers['content-type']).toBe('image/png');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect((r.body as Buffer).equals(b.qr)).toBe(true);
      // Ninguna respuesta de la configuración trae una dirección del archivo.
      const { body } = await verConfiguracion(prueba, b.token).expect(200);
      expect(JSON.stringify(body)).not.toMatch(/https?:|\/qr|[0-9a-f]{8}-[0-9a-f]{4}/);
      await verQr(prueba, null).expect(401);
    });

    it.each([
      ['un PDF', pdf()],
      ['un texto renombrado a .png', Buffer.from('esto no es una imagen, aunque se llame qr.png')],
      ['una firma PNG sola', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ])('%s → 422 VALIDACION del campo archivo, sin guardar nada', async (_caso, contenido) => {
      const b = await barberiaEnPrueba();
      const r = await subirQr(prueba, b.token, contenido, 'qr.png').expect(422);
      expect(r.body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo: 'archivo' }] });
      expect(await archivosDeAdelanto(b.tenantId)).toEqual([]);
      expect(await filaConfiguracion(b.tenantId)).toBeUndefined();
    });

    it('un QR de más de 1 MB → 413, sin guardar nada', async () => {
      const b = await barberiaEnPrueba();
      await subirQr(prueba, b.token, png(UN_MB)).expect(413);
      expect(await archivosDeAdelanto(b.tenantId)).toEqual([]);
    });

    it('reemplazarlo guarda otro archivo y conserva el anterior (FR-004)', async () => {
      const b = await conQr();
      const nuevo = jpeg();
      await subirQr(prueba, b.token, nuevo).expect(200);
      const archivos = await archivosDeAdelanto(b.tenantId);
      expect(archivos).toHaveLength(2);
      expect(await filaConfiguracion(b.tenantId)).toMatchObject({ qr_file_id: archivos[1].id });
      const r = await verQr(prueba, b.token).expect(200);
      expect((r.body as Buffer).equals(nuevo)).toBe(true);
    });
  });

  describe('activar, cambiar y desactivar', () => {
    it('activar con monto fijo de S/ 10 y 30 minutos (US1-1)', async () => {
      const b = await conQr();
      const { body } = await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(200);
      expect(body).toMatchObject({
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
        tieneQr: true,
      });
      expect(body).not.toHaveProperty('porcentaje');
      expect(new Date(body.actualizadoEn).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(await filaConfiguracion(b.tenantId)).toMatchObject({
        enabled: true,
        kind: 'FIJO',
        amount_cents: 1000,
        percent: null,
        payment_window_minutes: 30,
        updated_by: b.propietarioId,
      });
      // GET devuelve lo mismo.
      expect((await verConfiguracion(prueba, b.token).expect(200)).body).toEqual(body);
    });

    it('activar con porcentaje del 20 % y 30 minutos', async () => {
      const b = await conQr();
      const { body } = await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'PORCENTAJE',
        porcentaje: 20,
        plazoMinutos: 30,
      }).expect(200);
      expect(body).toMatchObject({ activo: true, tipo: 'PORCENTAJE', porcentaje: 20, plazoMinutos: 30 });
      expect(body).not.toHaveProperty('montoCentimos');
      expect(await filaConfiguracion(b.tenantId)).toMatchObject({
        kind: 'PORCENTAJE',
        percent: 20,
        amount_cents: null,
      });
    });

    it('cambiar de tipo deja solo el valor del tipo nuevo', async () => {
      const b = await conQr();
      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1500,
        plazoMinutos: 20,
      }).expect(200);
      const { body } = await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'PORCENTAJE',
        porcentaje: 50,
        plazoMinutos: 45,
      }).expect(200);
      expect(body).toEqual(expect.objectContaining({ tipo: 'PORCENTAJE', porcentaje: 50, plazoMinutos: 45 }));
      expect(await filaConfiguracion(b.tenantId)).toMatchObject({ amount_cents: null, percent: 50 });
    });

    it('desactivar conserva el tipo, el valor, el plazo y el QR para volver a activarlo', async () => {
      const b = await conQr();
      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(200);
      const { body } = await cambiarConfiguracion(prueba, b.token, { activo: false }).expect(200);
      expect(body).toMatchObject({
        activo: false,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
        tieneQr: true,
      });
      const reactivada = await cambiarConfiguracion(prueba, b.token, { activo: true }).expect(200);
      expect(reactivada.body).toMatchObject({ activo: true, tipo: 'FIJO', montoCentimos: 1000 });
    });

    it.each([
      ['monto menor que S/ 1', { tipo: 'FIJO', montoCentimos: 99, plazoMinutos: 30 }, 'montoCentimos'],
      ['monto mayor que S/ 500', { tipo: 'FIJO', montoCentimos: 50001, plazoMinutos: 30 }, 'montoCentimos'],
      ['fijo sin monto', { tipo: 'FIJO', plazoMinutos: 30 }, 'montoCentimos'],
      ['porcentaje 0', { tipo: 'PORCENTAJE', porcentaje: 0, plazoMinutos: 30 }, 'porcentaje'],
      ['porcentaje 101', { tipo: 'PORCENTAJE', porcentaje: 101, plazoMinutos: 30 }, 'porcentaje'],
      [
        'fijo con porcentaje',
        { tipo: 'FIJO', montoCentimos: 1000, porcentaje: 20, plazoMinutos: 30 },
        'porcentaje',
      ],
      ['plazo de 9 minutos', { tipo: 'FIJO', montoCentimos: 1000, plazoMinutos: 9 }, 'plazoMinutos'],
      ['plazo de más de 24 h', { tipo: 'FIJO', montoCentimos: 1000, plazoMinutos: 1441 }, 'plazoMinutos'],
      ['sin plazo', { tipo: 'FIJO', montoCentimos: 1000 }, 'plazoMinutos'],
      ['sin tipo', { montoCentimos: 1000, plazoMinutos: 30 }, 'tipo'],
    ])('%s → 422 VALIDACION del campo, sin guardar nada (US1-2)', async (_caso, cuerpo, campo) => {
      const b = await conQr();
      const antes = await filaConfiguracion(b.tenantId);
      const r = await cambiarConfiguracion(prueba, b.token, { activo: true, ...cuerpo }).expect(422);
      expect(r.body.codigo).toBe('VALIDACION');
      expect(r.body.detalles).toEqual(expect.arrayContaining([expect.objectContaining({ campo })]));
      expect(await filaConfiguracion(b.tenantId)).toEqual(antes);
    });

    it('activar sin QR → 422 QR_REQUERIDO, sin guardar nada (FR-002)', async () => {
      const b = await barberiaEnPrueba();
      const r = await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(422);
      expect(r.body.codigo).toBe('QR_REQUERIDO');
      expect(await filaConfiguracion(b.tenantId)).toBeUndefined();
    });

    it.each([
      ['tenantId en el cuerpo', { activo: false, tenantId: '0190a1b2-0000-7000-8000-000000000001' }],
      ['un campo no declarado', { activo: false, qrUrl: 'https://otro.pe/qr.png' }],
      ['activo que no es booleano', { activo: 'si' }],
      ['sin activo', { tipo: 'FIJO', montoCentimos: 1000, plazoMinutos: 30 }],
      ['monto con decimales', { activo: true, tipo: 'FIJO', montoCentimos: 10.5, plazoMinutos: 30 }],
      ['tipo desconocido', { activo: true, tipo: 'GRATIS', plazoMinutos: 30 }],
    ])('%s → 400 VALIDACION', async (_caso, cuerpo) => {
      const b = await conQr();
      const r = await cambiarConfiguracion(prueba, b.token, cuerpo).expect(400);
      expect(r.body.codigo).toBe('VALIDACION');
    });
  });

  describe('las citas ya reservadas no cambian (FR-004, US1-3, US1-4)', () => {
    it('cambiar, reemplazar el QR o desactivar no toca un adelanto ya creado ni su QR', async () => {
      const b = await barberiaEnPrueba();
      const { servicioId } = await sembrarServicio({ tenantId: b.tenantId });
      const { barberoId } = await sembrarBarbero({ tenantId: b.tenantId, servicios: [servicioId] });
      const { clienteId, usuarioId } = await sembrarCliente({ tenantId: b.tenantId });
      const citaId = await sembrarCita({
        tenantId: b.tenantId,
        barberoId,
        servicioId,
        clienteId,
        estado: 'PENDIENTE',
        inicio: new Date(Date.now() + 3 * DIA_MS),
      });
      const filas = await sembrarFilas008({
        tenantId: b.tenantId,
        citaId,
        clienteId,
        usuarioClienteId: usuarioId as string,
        usuarioId: b.propietarioId,
      });
      const adelantoAntes = (
        await poolDe('seed').query('SELECT * FROM booking_deposit WHERE id = $1', [filas.adelantoId])
      ).rows[0];

      await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'PORCENTAJE',
        porcentaje: 80,
        plazoMinutos: 120,
      }).expect(200);
      await subirQr(prueba, b.token, png()).expect(200);
      await cambiarConfiguracion(prueba, b.token, { activo: false }).expect(200);

      const adelantoDespues = (
        await poolDe('seed').query('SELECT * FROM booking_deposit WHERE id = $1', [filas.adelantoId])
      ).rows[0];
      expect(adelantoDespues).toEqual(adelantoAntes);
      // El QR con el que se reservó sigue en la base; la configuración usa el nuevo.
      const archivos = await archivosDeAdelanto(b.tenantId);
      expect(archivos.map((a) => a.id)).toContain(filas.qrId);
      expect((await filaConfiguracion(b.tenantId))?.qr_file_id).not.toBe(filas.qrId);
    });
  });

  describe('suscripción vencida (FR-030; restricciones de 003)', () => {
    async function vencida() {
      const b = await conQr();
      await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE id = $1`, [
        b.suscripcionId,
      ]);
      return b;
    }

    it('cambiar la configuración → 403 SUSCRIPCION_NO_PERMITE, sin guardar nada', async () => {
      const b = await vencida();
      const antes = await filaConfiguracion(b.tenantId);
      const r = await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(403);
      expect(r.body).toMatchObject({
        codigo: 'SUSCRIPCION_NO_PERMITE',
        detalles: [{ estado: 'EXPIRED', accion: 'CONFIGURAR_CATALOGO' }],
      });
      expect(await filaConfiguracion(b.tenantId)).toEqual(antes);
    });

    it('subir el QR → 403 SUSCRIPCION_NO_PERMITE, sin guardar nada', async () => {
      const b = await vencida();
      await subirQr(prueba, b.token, png()).expect(403);
      expect(await archivosDeAdelanto(b.tenantId)).toHaveLength(1);
    });

    it('ver la configuración y el QR sigue permitido', async () => {
      const b = await vencida();
      await verConfiguracion(prueba, b.token).expect(200);
      await verQr(prueba, b.token).expect(200);
    });
  });

  describe('aislamiento entre barberías (PR09)', () => {
    it('cada propietario ve solo la configuración y el QR de su barbería', async () => {
      const a = await conQr();
      await cambiarConfiguracion(prueba, a.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 2000,
        plazoMinutos: 15,
      }).expect(200);
      const b = await barberiaEnPrueba();
      expect((await verConfiguracion(prueba, b.token).expect(200)).body).toEqual({
        activo: false,
        tieneQr: false,
      });
      await verQr(prueba, b.token).expect(404);
      // Activar en B no usa el QR de A.
      const r = await cambiarConfiguracion(prueba, b.token, {
        activo: true,
        tipo: 'FIJO',
        montoCentimos: 1000,
        plazoMinutos: 30,
      }).expect(422);
      expect(r.body.codigo).toBe('QR_REQUERIDO');
      expect(await filaConfiguracion(a.tenantId)).toMatchObject({ amount_cents: 2000 });
    });
  });
});
