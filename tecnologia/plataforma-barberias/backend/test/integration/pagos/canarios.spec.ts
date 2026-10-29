import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { iniciarSimuladorDePrueba } from '../../helpers/simulador';
import { crearApp } from '../../helpers/app';
import { iniciarTransferencia, png, revisar, subirComprobante } from '../../helpers/comprobantes';
import { tokenPlataformaPara } from '../../helpers/sesiones';
import {
  barberiaEnPrueba,
  esperarHasta,
  filaDePago,
  notificacionFirmada,
  pagarConYape,
  RUTA_NOTIFICACIONES,
} from '../../helpers/pagos';
import { decidirEnSimulador } from '../../helpers/simulador';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T038 · Datos canario (SC-010): la llave secreta de la pasarela, el secreto de firma de las notificaciones y
// el teléfono del pagador que manda el proveedor nunca aparecen en los registros, en audit_log, en
// provider_event ni en las respuestas de error. US3 suma los comprobantes (el TOTP del administrador tiene los
// suyos en identidad/segundo-factor.spec.ts).

const TELEFONO_PAGADOR = '987650321';

describe('Datos canario de los pagos (SC-010)', () => {
  let registro = '';
  const restaurar: (() => void)[] = [];
  const canarios = () => [
    process.env.PAGOS_LLAVE_SECRETA as string,
    process.env.PAGOS_SECRETO_FIRMA as string,
    TELEFONO_PAGADOR,
  ];

  beforeAll(() => {
    for (const metodo of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      const espia = jest.spyOn(Logger.prototype, metodo).mockImplementation((...args: unknown[]) => {
        registro += `${args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' ')}\n`;
      });
      restaurar.push(() => espia.mockRestore());
    }
    for (const metodo of ['log', 'warn', 'error', 'info'] as const) {
      const espia = jest.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        registro += `${args.map(String).join(' ')}\n`;
      });
      restaurar.push(() => espia.mockRestore());
    }
  });

  afterAll(async () => {
    restaurar.forEach((deshacer) => deshacer());
    await cerrarPools();
  });

  it('un pago completo, una firma inválida y el proveedor caído no dejan ningún canario', async () => {
    // El simulador agrega el teléfono del pagador a cada notificación, como podría hacerlo un proveedor real.
    const simulador = await iniciarSimuladorDePrueba({ telefonoPagador: TELEFONO_PAGADOR });
    const prueba = await crearApp({ escuchar: true });
    simulador.cambiarDestino(`${prueba.url}${RUTA_NOTIFICACIONES}`);
    const respuestas: string[] = [];
    try {
      const b = await barberiaEnPrueba();
      const iniciado = await pagarConYape(prueba, b.token).expect(201);
      respuestas.push(JSON.stringify(iniciado.body));
      const referencia = (await filaDePago(iniciado.body.pago.id)).provider_reference as string;

      // Aprobación notificada por el simulador, con el teléfono del pagador en el cuerpo.
      await decidirEnSimulador(simulador, referencia, 'aprobar');
      await esperarHasta(async () => (await filaDePago(iniciado.body.pago.id)).status === 'APROBADO');
      await simulador.esperarNotificaciones();

      // Una notificación con firma inválida que también trae el teléfono.
      const falsa = notificacionFirmada({
        referencia,
        secreto: 'secreto-falso-0123456789abcdef',
        extra: { pagador: { telefono: TELEFONO_PAGADOR } },
      });
      const rechazo = await prueba.agente
        .post(RUTA_NOTIFICACIONES)
        .set('Content-Type', 'application/json')
        .set('X-Firma', falsa.firma)
        .send(falsa.cuerpo)
        .expect(401);
      respuestas.push(JSON.stringify(rechazo.body));

      // El proveedor caído: el error 503 tampoco los muestra.
      await simulador.cambiarModo({ modo: 'caido' });
      const otra = await barberiaEnPrueba();
      const caido = await pagarConYape(prueba, otra.token).expect(503);
      respuestas.push(JSON.stringify(caido.body));
      respuestas.push(
        JSON.stringify(
          (
            await prueba.agente
              .get('/api/v1/suscripcion')
              .set('Authorization', `Bearer ${b.token}`)
              .expect(200)
          ).body,
        ),
      );

      const seed = poolDe('seed');
      const auditoria = JSON.stringify(
        (await seed.query('SELECT * FROM audit_log WHERE tenant_id = ANY($1)', [[b.tenantId, otra.tenantId]]))
          .rows,
      );
      const eventos = JSON.stringify((await seed.query('SELECT * FROM provider_event')).rows);
      const pagos = JSON.stringify(
        (await seed.query('SELECT * FROM payment WHERE tenant_id = ANY($1)', [[b.tenantId, otra.tenantId]]))
          .rows,
      );
      expect(eventos).toContain(referencia);
      for (const canario of canarios()) {
        expect({ canario, enRegistros: registro.includes(canario) }).toEqual({ canario, enRegistros: false });
        expect({ canario, enAuditoria: auditoria.includes(canario) }).toEqual({
          canario,
          enAuditoria: false,
        });
        expect({ canario, enEventos: eventos.includes(canario) }).toEqual({ canario, enEventos: false });
        expect({ canario, enPagos: pagos.includes(canario) }).toEqual({ canario, enPagos: false });
        for (const respuesta of respuestas) expect(respuesta).not.toContain(canario);
      }
    } finally {
      await simulador.cerrar();
      await prueba.cerrar();
    }
  });

  // T075 · US3: el contenido y el nombre original de un comprobante canario no aparecen en los registros, la
  // auditoría, los errores ni la cola del administrador. El contenido solo vive en payment_receipt_file.
  it('un comprobante canario no deja su contenido ni su nombre fuera de payment_receipt_file', async () => {
    const prueba = await crearApp();
    const respuestas: string[] = [];
    const guardar = (r: { body: unknown }) => {
      respuestas.push(JSON.stringify(r.body));
      return r;
    };
    try {
      const contenido = `CANARIO-CONTENIDO-${randomBytes(8).toString('hex')}`;
      const nombre = `CANARIO-NOMBRE-${randomBytes(8).toString('hex')}`;
      const numero = `CANARIO${randomBytes(6).toString('hex').toUpperCase()}`;
      const archivo = Buffer.concat([png(16), Buffer.from(contenido)]);
      const b = await barberiaEnPrueba();
      const admin = (await tokenPlataformaPara()).token;
      const pagoId = (await iniciarTransferencia(prueba, b.token).expect(201)).body.pago.id as string;

      // Un texto renombrado (rechazado) y uno demasiado grande, los dos con el canario.
      guardar(
        await subirComprobante(prueba, b.token, pagoId, {
          archivo: Buffer.from(`${contenido} texto plano`),
          nombre: `${nombre}.png`,
          numero,
        }).expect(400),
      );
      guardar(
        await subirComprobante(prueba, b.token, pagoId, {
          archivo: Buffer.concat([png(5 * 1024 * 1024), Buffer.from(contenido)]),
          nombre: `${nombre}.png`,
          numero,
        }).expect(400),
      );
      // El válido, con el canario dentro de los bytes y en el nombre.
      guardar(
        await subirComprobante(prueba, b.token, pagoId, { archivo, nombre: `${nombre}.png`, numero }).expect(
          201,
        ),
      );
      guardar(
        await subirComprobante(prueba, b.token, pagoId, { archivo, nombre: `${nombre}.png`, numero }).expect(
          409,
        ),
      );
      const cola = guardar(
        await prueba.agente
          .get('/api/v1/plataforma/comprobantes')
          .set('Authorization', `Bearer ${admin}`)
          .expect(200),
      );
      expect(JSON.stringify(cola.body)).toContain(pagoId);
      guardar(
        await revisar(prueba, admin, b.tenantId, pagoId, {
          resultado: 'APROBADO',
          importeTransferidoCentimos: 1,
        }).expect(422),
      );
      guardar(
        await revisar(prueba, admin, b.tenantId, pagoId, {
          resultado: 'RECHAZADO',
          motivo: 'Comprobante ilegible, envía otro',
        }).expect(200),
      );

      const seed = poolDe('seed');
      const lugares: Record<string, string> = {
        registros: registro,
        respuestas: respuestas.join('\n'),
        auditoria: JSON.stringify(
          (await seed.query('SELECT * FROM audit_log WHERE tenant_id = $1', [b.tenantId])).rows,
        ),
        auditoriaPlataforma: JSON.stringify((await seed.query('SELECT * FROM platform_audit_log')).rows),
        pagos: JSON.stringify(
          (await seed.query('SELECT * FROM payment WHERE tenant_id = $1', [b.tenantId])).rows,
        ),
        metadatos: JSON.stringify(
          (await seed.query('SELECT * FROM payment_receipt WHERE tenant_id = $1', [b.tenantId])).rows,
        ),
      };
      const hallazgos = Object.entries(lugares).flatMap(([lugar, texto]) =>
        [contenido, nombre]
          .filter((canario) => texto.includes(canario))
          .map((canario) => `${lugar}: ${canario}`),
      );
      expect(hallazgos).toEqual([]);
      // El número completo solo está en el pago (y en el detalle del administrador), nunca en la cola ni la auditoría.
      expect(JSON.stringify(cola.body)).not.toContain(numero);
      expect(lugares.auditoria).not.toContain(numero);
      // El contenido sí está, y solo, en payment_receipt_file.
      const { rows } = await seed.query('SELECT content FROM payment_receipt_file WHERE tenant_id = $1', [
        b.tenantId,
      ]);
      expect((rows[0].content as Buffer).equals(archivo)).toBe(true);
    } finally {
      await prueba.cerrar();
    }
  });
});
