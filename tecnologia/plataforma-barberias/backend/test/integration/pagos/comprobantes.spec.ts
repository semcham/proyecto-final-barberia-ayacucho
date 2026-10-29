import { createHash, randomBytes } from 'node:crypto';
import { EjecutorTareas } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  hoyEnLima,
  iniciarTransferencia,
  jpeg,
  numeroOperacion,
  pagoEnRevision,
  pdf,
  png,
  revisar,
  subirComprobante,
} from '../../helpers/comprobantes';
import { sembrarPago, sembrarUsuario } from '../../helpers/fixtures';
import { type BarberiaEnPrueba, barberiaEnPrueba, filaDePago } from '../../helpers/pagos';
import { tokenPara, tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T073 · Transferencia con comprobante (US3; FR-019 a FR-024, FR-041; R05, R09, ADR-023): datos de la cuenta y
// referencia; subida verificada por bytes y con su cupo diario; descarga solo con sesión; revisión única del
// administrador con importe exacto; número de operación único entre barberías; archivo repetido señalado; y
// la transferencia sin comprobante que expira a los 7 días.

const seed = () => poolDe('seed');
const DIA_MS = 24 * 60 * 60 * 1000;

async function receiptsDe(tenantId: string) {
  const { rows } = await seed().query(
    `SELECT r.id, r.content_type, r.size_bytes, r.sha256, r.uploaded_by, r.reviewed_by, r.review_result,
            r.review_reason, f.content
       FROM payment_receipt r LEFT JOIN payment_receipt_file f ON f.receipt_id = r.id AND f.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 ORDER BY r.uploaded_at`,
    [tenantId],
  );
  return rows;
}

describe('Transferencia con comprobante (T073)', () => {
  let prueba: AppDePrueba;
  let admin: string;

  beforeAll(async () => {
    prueba = await crearApp();
    admin = (await tokenPlataformaPara()).token;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const cola = async () =>
    (
      await prueba.agente
        .get('/api/v1/plataforma/comprobantes')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200)
    ).body as {
      barberia: { id: string; nombre: string };
      pago: Record<string, unknown> & { id: string };
    }[];

  describe('iniciar la transferencia', () => {
    it('devuelve la cuenta, el importe exacto y la referencia SUS-…, y repetirla devuelve el mismo pago', async () => {
      const b = await barberiaEnPrueba();
      const r = await iniciarTransferencia(prueba, b.token).expect(201);
      expect(r.body).toMatchObject({
        pago: { medio: 'TRANSFERENCIA', estado: 'ESPERANDO_COMPROBANTE', importeCentimos: 4900 },
        urlPago: null,
        transferencia: {
          banco: 'Banco de Pruebas',
          titular: 'Plataforma de Barberías SAC',
          numeroCuenta: '191-0000000-0-00',
          cci: '00219100000000000000',
          importeCentimos: 4900,
        },
      });
      expect(r.body.transferencia.referencia).toMatch(/^SUS-[A-Z0-9]{16}$/);
      expect(r.body.transferencia.referencia.slice(4, 10)).toBe(
        b.tenantId.replace(/-/g, '').slice(-6).toUpperCase(),
      );

      const otra = await iniciarTransferencia(prueba, b.token).expect(200);
      expect(otra.body.pago.id).toBe(r.body.pago.id);
      expect(otra.body.transferencia.referencia).toBe(r.body.transferencia.referencia);
      expect((await filaDePago(r.body.pago.id)).transfer_reference).toBe(r.body.transferencia.referencia);
    });

    it('los planes contratables ofrecen la transferencia', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await prueba.agente
        .get('/api/v1/planes')
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      for (const plan of body) expect(plan.mediosDisponibles).toContain('TRANSFERENCIA');
    });
  });

  describe('subir el comprobante', () => {
    it.each([
      ['JPG', jpeg, 'image/jpeg'],
      ['PNG', png, 'image/png'],
      ['PDF', pdf, 'application/pdf'],
    ] as const)(
      'un %s con número y fecha deja el pago EN_REVISION con su SHA-256',
      async (_n, crear, tipo) => {
        const b = await barberiaEnPrueba();
        const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
        const archivo = crear();
        const r = await subirComprobante(prueba, b.token, body.pago.id, {
          archivo,
          // El tipo lo deciden los bytes, no el nombre.
          nombre: 'cualquier-nombre.txt',
          numero: ' op-4567 89ab ',
          fecha: hoyEnLima(-2),
        }).expect(201);
        expect(r.body).toMatchObject({
          id: body.pago.id,
          estado: 'EN_REVISION',
          numeroOperacionFinal: '89AB',
        });
        const fila = await filaDePago(body.pago.id);
        expect(fila).toMatchObject({
          status: 'EN_REVISION',
          bank_operation_number: 'OP456789AB',
          bank_operation_last4: '89AB',
        });
        const [recibo] = await receiptsDe(b.tenantId);
        expect(recibo).toMatchObject({
          content_type: tipo,
          size_bytes: archivo.length,
          sha256: createHash('sha256').update(archivo).digest('hex'),
          uploaded_by: b.propietarioId,
        });
        expect((recibo.content as Buffer).equals(archivo)).toBe(true);
      },
    );

    it('un tipo falso, más de 5 MB, sin archivo, o un número o una fecha inválidos responden 400 sin guardar nada', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
      const casos: [string, Parameters<typeof subirComprobante>[3], string, string][] = [
        [
          'texto renombrado',
          { archivo: Buffer.from('soy un texto'), nombre: 'comprobante.png' },
          'archivo',
          'tipo_no_permitido',
        ],
        [
          'html renombrado',
          { archivo: Buffer.from('<html>…</html>'), nombre: 'comprobante.pdf' },
          'archivo',
          'tipo_no_permitido',
        ],
        ['archivo vacío', { archivo: Buffer.alloc(0) }, 'archivo', 'tipo_no_permitido'],
        ['más de 5 MB', { archivo: png(5 * 1024 * 1024) }, 'archivo', 'demasiado_grande'],
        ['sin archivo', {}, 'archivo', 'requerido'],
        ['número corto', { archivo: png(), numero: '12-3' }, 'numeroOperacion', 'formato'],
        ['número con símbolos', { archivo: png(), numero: 'OP<script>' }, 'numeroOperacion', 'formato'],
        ['fecha futura', { archivo: png(), fecha: hoyEnLima(2) }, 'fechaTransferencia', 'fecha_no_valida'],
        ['fecha imposible', { archivo: png(), fecha: '2026-02-31' }, 'fechaTransferencia', 'fecha_no_valida'],
        ['fecha antigua', { archivo: png(), fecha: hoyEnLima(-45) }, 'fechaTransferencia', 'fecha_no_valida'],
      ];
      for (const [nombre, datos, campo, problema] of casos) {
        const r = await subirComprobante(prueba, b.token, body.pago.id, datos);
        expect({ nombre, estado: r.status, codigo: r.body.codigo, detalles: r.body.detalles }).toEqual({
          nombre,
          estado: 400,
          codigo: 'VALIDACION',
          detalles: [{ campo, problema }],
        });
      }
      expect(await receiptsDe(b.tenantId)).toEqual([]);
      expect((await filaDePago(body.pago.id)).status).toBe('ESPERANDO_COMPROBANTE');
      const { rows } = await seed().query(
        'SELECT count(*)::int AS n FROM receipt_upload_counter WHERE tenant_id = $1',
        [b.tenantId],
      );
      expect(rows[0].n).toBe(0);
    });

    it('con 5 comprobantes ya enviados hoy, el sexto responde 429 y no se guarda', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
      await seed().query('INSERT INTO receipt_upload_counter (tenant_id, day, count) VALUES ($1, $2, 5)', [
        b.tenantId,
        hoyEnLima(),
      ]);
      const r = await subirComprobante(prueba, b.token, body.pago.id, { archivo: png() }).expect(429);
      expect(r.body.codigo).toBe('DEMASIADOS_INTENTOS');
      const espera = Number(r.headers['retry-after']);
      expect(espera).toBeGreaterThan(0);
      expect(espera).toBeLessThanOrEqual(24 * 60 * 60);
      expect(await receiptsDe(b.tenantId)).toEqual([]);
      expect((await filaDePago(body.pago.id)).status).toBe('ESPERANDO_COMPROBANTE');
    });

    it('cada comprobante aceptado consume un lugar del cupo del día', async () => {
      const b = await barberiaEnPrueba();
      await pagoEnRevision(prueba, b.token);
      const { rows } = await seed().query(
        'SELECT day::text AS dia, count FROM receipt_upload_counter WHERE tenant_id = $1',
        [b.tenantId],
      );
      expect(rows).toEqual([{ dia: hoyEnLima(), count: 1 }]);
    });

    it('con uno en revisión, otro comprobante o un pago nuevo responden 409 COMPROBANTE_YA_EN_REVISION', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await pagoEnRevision(prueba, b.token);
      const otro = await subirComprobante(prueba, b.token, pagoId, { archivo: png() }).expect(409);
      expect(otro.body.codigo).toBe('COMPROBANTE_YA_EN_REVISION');
      expect((await iniciarTransferencia(prueba, b.token).expect(409)).body.codigo).toBe(
        'COMPROBANTE_YA_EN_REVISION',
      );
      expect(await receiptsDe(b.tenantId)).toHaveLength(1);
    });

    it('dos subidas simultáneas al mismo pago dejan un solo comprobante', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
      const respuestas = await Promise.all([
        subirComprobante(prueba, b.token, body.pago.id, { archivo: png() }),
        subirComprobante(prueba, b.token, body.pago.id, { archivo: png() }),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await receiptsDe(b.tenantId)).toHaveLength(1);
    });

    it('un pago con Yape no espera comprobante (409) y no se guarda nada', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await sembrarPago({ tenantId: b.tenantId, suscripcionId: b.suscripcionId });
      const r = await subirComprobante(prueba, b.token, pagoId, { archivo: png() }).expect(409);
      expect(r.body.codigo).toBe('PAGO_NO_ESPERA_COMPROBANTE');
      expect(await receiptsDe(b.tenantId)).toEqual([]);
    });
  });

  describe('descargar el comprobante', () => {
    it('el propietario lo descarga como adjunto, con nosniff y no-store; sin sesión 401 y el barbero 403', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId, archivo } = await pagoEnRevision(prueba, b.token);
      const ruta = `/api/v1/suscripcion/pagos/${pagoId}/comprobante`;
      const r = await prueba.agente
        .get(ruta)
        .set('Authorization', `Bearer ${b.token}`)
        .buffer(true)
        .parse((res, listo) => {
          const partes: Buffer[] = [];
          res.on('data', (parte: Buffer) => partes.push(parte));
          res.on('end', () => listo(null, Buffer.concat(partes)));
        })
        .expect(200);
      expect(r.headers['content-type']).toBe('image/png');
      expect(r.headers['content-disposition']).toBe(`attachment; filename="comprobante-${pagoId}.png"`);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['cache-control']).toBe('no-store');
      expect((r.body as Buffer).equals(archivo)).toBe(true);

      await prueba.agente.get(ruta).expect(401);
      const barbero = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
      await prueba.agente
        .get(ruta)
        .set('Authorization', `Bearer ${await tokenPara(b.tenantId, barbero.usuarioId, 'BARBERO')}`)
        .expect(403);
    });

    it('un pago sin comprobante responde 404', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
      await prueba.agente
        .get(`/api/v1/suscripcion/pagos/${body.pago.id}/comprobante`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(404);
    });
  });

  describe('revisión del administrador', () => {
    it('aprobar con el importe exacto crea el período y marca el comprobante', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await pagoEnRevision(prueba, b.token);
      const r = await revisar(prueba, admin, b.tenantId, pagoId, {
        resultado: 'APROBADO',
        importeTransferidoCentimos: 4900,
      }).expect(200);
      expect(r.body).toMatchObject({ id: pagoId, estado: 'APROBADO', periodo: expect.any(Object) });
      const { rows } = await seed().query(
        'SELECT count(*)::int AS n FROM subscription_period WHERE payment_id = $1',
        [pagoId],
      );
      expect(rows[0].n).toBe(1);
      const [recibo] = await receiptsDe(b.tenantId);
      expect(recibo).toMatchObject({
        review_result: 'APROBADO',
        reviewed_by: expect.any(String),
        review_reason: null,
      });
    });

    it('un importe distinto responde 422 y no cambia nada', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await pagoEnRevision(prueba, b.token);
      const r = await revisar(prueba, admin, b.tenantId, pagoId, {
        resultado: 'APROBADO',
        importeTransferidoCentimos: 4800,
      }).expect(422);
      expect(r.body.codigo).toBe('IMPORTE_DISTINTO');
      expect((await filaDePago(pagoId)).status).toBe('EN_REVISION');
      expect((await receiptsDe(b.tenantId))[0].review_result).toBeNull();
      // Aprobar sin importe también es 400.
      await revisar(prueba, admin, b.tenantId, pagoId, { resultado: 'APROBADO' }).expect(400);
    });

    it('rechazar sin motivo responde 400; con motivo se rechaza y el propietario puede enviar otro', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await pagoEnRevision(prueba, b.token);
      await revisar(prueba, admin, b.tenantId, pagoId, { resultado: 'RECHAZADO' }).expect(400);
      await revisar(prueba, admin, b.tenantId, pagoId, { resultado: 'RECHAZADO', motivo: '   ab   ' }).expect(
        400,
      );
      const r = await revisar(prueba, admin, b.tenantId, pagoId, {
        resultado: 'RECHAZADO',
        motivo: '  El importe del voucher no se lee  ',
      }).expect(200);
      expect(r.body).toMatchObject({
        estado: 'RECHAZADO',
        motivoRechazo: 'El importe del voucher no se lee',
      });
      expect((await receiptsDe(b.tenantId))[0]).toMatchObject({
        review_result: 'RECHAZADO',
        review_reason: 'El importe del voucher no se lee',
      });

      const otro = await pagoEnRevision(prueba, b.token);
      expect(otro.pagoId).not.toBe(pagoId);
      expect(await receiptsDe(b.tenantId)).toHaveLength(2);
    });

    it('dos revisiones simultáneas dejan una aplicada y la otra con 409 PAGO_YA_REVISADO', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await pagoEnRevision(prueba, b.token);
      const respuestas = await Promise.all([
        revisar(prueba, admin, b.tenantId, pagoId, {
          resultado: 'APROBADO',
          importeTransferidoCentimos: 4900,
        }),
        revisar(prueba, admin, b.tenantId, pagoId, {
          resultado: 'RECHAZADO',
          motivo: 'Comprobante ilegible',
        }),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(respuestas.find((r) => r.status === 409)?.body.codigo).toBe('PAGO_YA_REVISADO');
      // Una revisión más tarde también es 409.
      await revisar(prueba, admin, b.tenantId, pagoId, { resultado: 'RECHAZADO', motivo: 'Otra vez' }).expect(
        409,
      );
    });

    it('el mismo número ya aprobado en otra barbería: 409, sin período; la cola lo señala y el detalle tiene el número', async () => {
      const numero = numeroOperacion();
      const a = await barberiaEnPrueba();
      const primero = await pagoEnRevision(prueba, a.token, { numero });
      await revisar(prueba, admin, a.tenantId, primero.pagoId, {
        resultado: 'APROBADO',
        importeTransferidoCentimos: 4900,
      }).expect(200);

      const b = await barberiaEnPrueba();
      // Escrito de otra forma: la normalización lo hace el mismo número.
      const segundo = await pagoEnRevision(prueba, b.token, {
        numero: `${numero.slice(0, 4)}-${numero.slice(4).toLowerCase()}`,
      });
      const enCola = (await cola()).find((c) => c.pago.id === segundo.pagoId);
      expect(enCola).toMatchObject({
        barberia: { id: b.tenantId },
        pago: {
          numeroOperacionFinal: numero.slice(-4),
          numeroRepetido: true,
          referencia: segundo.referencia,
        },
      });
      expect(enCola?.pago.numeroYaUsadoEn).toContain(primero.pagoId);
      expect(JSON.stringify(enCola)).not.toContain(numero);

      const detalle = await prueba.agente
        .get(`/api/v1/plataforma/barberias/${b.tenantId}/pagos/${segundo.pagoId}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(detalle.body).toMatchObject({ numeroOperacion: numero, fechaTransferencia: hoyEnLima() });

      const r = await revisar(prueba, admin, b.tenantId, segundo.pagoId, {
        resultado: 'APROBADO',
        importeTransferidoCentimos: 4900,
      }).expect(409);
      expect(r.body.codigo).toBe('NUMERO_OPERACION_YA_APROBADO');
      expect((await filaDePago(segundo.pagoId)).status).toBe('EN_REVISION');
      const { rows } = await seed().query(
        'SELECT count(*)::int AS n FROM subscription_period WHERE payment_id = $1',
        [segundo.pagoId],
      );
      expect(rows[0].n).toBe(0);
      expect((await receiptsDe(b.tenantId))[0].review_result).toBeNull();
    });

    it('el mismo archivo (SHA-256) en otra barbería queda señalado en la cola', async () => {
      const archivo = png();
      const a = await barberiaEnPrueba();
      const primero = await pagoEnRevision(prueba, a.token, { archivo });
      const b = await barberiaEnPrueba();
      const segundo = await pagoEnRevision(prueba, b.token, { archivo });
      const enCola = (await cola()).find((c) => c.pago.id === segundo.pagoId);
      expect(enCola?.pago.numeroYaUsadoEn).toContain(primero.pagoId);
      expect(enCola?.pago.numeroRepetido).toBe(false);
    });

    it('la cola va del más antiguo al más reciente y solo trae pagos EN_REVISION', async () => {
      const b1 = await barberiaEnPrueba();
      const uno = await pagoEnRevision(prueba, b1.token);
      const b2 = await barberiaEnPrueba();
      const dos = await pagoEnRevision(prueba, b2.token);
      const b3 = await barberiaEnPrueba();
      const esperando = await iniciarTransferencia(prueba, b3.token).expect(201);
      const ids = (await cola()).map((c) => c.pago.id);
      expect(ids.indexOf(uno.pagoId)).toBeLessThan(ids.indexOf(dos.pagoId));
      expect(ids).not.toContain(esperando.body.pago.id);
    });

    it('el administrador ve el archivo con la barbería de la ruta', async () => {
      const b = await barberiaEnPrueba();
      const { pagoId } = await pagoEnRevision(prueba, b.token, { archivo: pdf() });
      const r = await prueba.agente
        .get(`/api/v1/plataforma/barberias/${b.tenantId}/pagos/${pagoId}/comprobante`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect(r.headers['content-disposition']).toMatch(/^attachment;/);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['cache-control']).toBe('no-store');
    });
  });

  describe('expirar-transferencias', () => {
    it('ESPERANDO_COMPROBANTE pasa a EXPIRADO a los 7 días; una de 6 días sigue esperando', async () => {
      const viejo: BarberiaEnPrueba = await barberiaEnPrueba();
      const reciente = await barberiaEnPrueba();
      const pv = (await iniciarTransferencia(prueba, viejo.token).expect(201)).body.pago.id as string;
      const pr = (await iniciarTransferencia(prueba, reciente.token).expect(201)).body.pago.id as string;
      await seed().query(`UPDATE payment SET created_at = $2 WHERE id = $1`, [
        pv,
        new Date(Date.now() - 7 * DIA_MS - 60_000),
      ]);
      await seed().query(`UPDATE payment SET created_at = $2 WHERE id = $1`, [
        pr,
        new Date(Date.now() - 6 * DIA_MS),
      ]);

      await prueba.app.get(EjecutorTareas).ejecutarAhora('expirar-transferencias');
      expect(await filaDePago(pv)).toMatchObject({ status: 'EXPIRADO', closed_at: expect.any(Date) });
      expect((await filaDePago(pr)).status).toBe('ESPERANDO_COMPROBANTE');
      // Ya no espera comprobante: el propietario inicia otra transferencia.
      await subirComprobante(prueba, viejo.token, pv, { archivo: png() }).expect(409);
      await iniciarTransferencia(prueba, viejo.token).expect(201);
    });
  });

  it('nada del comprobante aparece en las respuestas de error', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
    const secreto = `CANARIO-${randomBytes(8).toString('hex')}`;
    const r = await subirComprobante(prueba, b.token, body.pago.id, {
      archivo: Buffer.from(secreto),
      nombre: `${secreto}.png`,
      numero: `${secreto}<>`,
    }).expect(400);
    expect(JSON.stringify(r.body)).not.toContain(secreto);
  });
});
