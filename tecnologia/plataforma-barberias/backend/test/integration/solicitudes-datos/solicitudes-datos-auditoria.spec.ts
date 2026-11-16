import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import {
  cerrarSolicitud,
  iniciarAtencion,
  registrarEnNombre,
  registrarSolicitud,
  solicitudesDe,
} from '../../helpers/solicitudes-datos';
import { cerrarPools } from '../../helpers/test-db';

// T003 de 007 · FR-009, SC-001: cada paso de una solicitud deja una fila en audit_log de la barbería con el actor y
// el recurso `solicitud_datos:<id>;<tipo>`. NUNCA el texto del detalle, de la respuesta ni del motivo: un marcador
// escrito en los tres no aparece en audit_log ni en los registros capturados de la aplicación (patrón de
// registro-asistente de 005).

const MARCADOR = 'garza-turquesa-4417';

describe('T003 · Auditoría de las solicitudes, sin texto (FR-009)', () => {
  let prueba: AppDePrueba;
  const salida: string[] = [];
  const escrituras = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };

  beforeAll(async () => {
    prueba = await crearApp();
    process.stdout.write = ((trozo: unknown, ...resto: unknown[]) => {
      salida.push(String(trozo));
      return (escrituras.stdout as (...a: unknown[]) => boolean)(trozo, ...resto);
    }) as typeof process.stdout.write;
    process.stderr.write = ((trozo: unknown, ...resto: unknown[]) => {
      salida.push(String(trozo));
      return (escrituras.stderr as (...a: unknown[]) => boolean)(trozo, ...resto);
    }) as typeof process.stderr.write;
  });

  afterAll(async () => {
    process.stdout.write = escrituras.stdout;
    process.stderr.write = escrituras.stderr;
    await prueba.cerrar();
    await cerrarPools();
  });

  it('las cuatro acciones, cada una con su actor y el recurso solicitud_datos:<id>;<tipo>, sin texto', async () => {
    const b = await sembrarBarberia();
    const propietario = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    const cliente = await sesionCliente(b.tenantId);

    const rectificacion = await registrarSolicitud(prueba, cliente.token, {
      tipo: 'RECTIFICACION',
      detalle: `Mi teléfono correcto es ${MARCADOR}`,
    }).expect(201);
    await iniciarAtencion(prueba, propietario, rectificacion.body.id).expect(200);
    await cerrarSolicitud(prueba, propietario, rectificacion.body.id, {
      resultado: 'ATENDIDA',
      respuesta: `Corregido a mano ${MARCADOR}`,
    }).expect(200);

    const eliminacion = await registrarSolicitud(prueba, cliente.token, {
      tipo: 'ELIMINACION',
      detalle: `Borren todo ${MARCADOR}`,
    }).expect(201);
    await cerrarSolicitud(prueba, propietario, eliminacion.body.id, {
      resultado: 'RECHAZADA',
      motivo: `Se conserva la auditoría ${MARCADOR}`,
    }).expect(200);

    const presencial = await sembrarCliente({
      tenantId: b.tenantId,
      conCuenta: false,
      creadoPor: b.propietarioId,
    });
    const enNombre = await registrarEnNombre(prueba, propietario, {
      tipo: 'ACCESO',
      clienteId: presencial.clienteId,
      detalle: `Lo pidió por teléfono ${MARCADOR}`,
    }).expect(201);

    const auditoria = (await filasDe('audit_log', b.tenantId))
      .filter((f) => String(f.action).startsWith('SOLICITUD_DATOS_'))
      // Por fecha y, si coinciden en el milisegundo, por id (uuidv7, creciente).
      .sort(
        (x, y) =>
          (x.at as Date).getTime() - (y.at as Date).getTime() || String(x.id).localeCompare(String(y.id)),
      );
    const clienteId = cliente.cliente.usuarioId as string;
    expect(auditoria.map((f) => [f.action, f.actor_id, f.resource, f.result, f.reason])).toEqual([
      [
        'SOLICITUD_DATOS_REGISTRADA',
        clienteId,
        `solicitud_datos:${rectificacion.body.id};RECTIFICACION`,
        'PERMITIDO',
        null,
      ],
      [
        'SOLICITUD_DATOS_EN_ATENCION',
        b.propietarioId,
        `solicitud_datos:${rectificacion.body.id};RECTIFICACION`,
        'PERMITIDO',
        null,
      ],
      [
        'SOLICITUD_DATOS_ATENDIDA',
        b.propietarioId,
        `solicitud_datos:${rectificacion.body.id};RECTIFICACION`,
        'PERMITIDO',
        null,
      ],
      [
        'SOLICITUD_DATOS_REGISTRADA',
        clienteId,
        `solicitud_datos:${eliminacion.body.id};ELIMINACION`,
        'PERMITIDO',
        null,
      ],
      [
        'SOLICITUD_DATOS_RECHAZADA',
        b.propietarioId,
        `solicitud_datos:${eliminacion.body.id};ELIMINACION`,
        'PERMITIDO',
        null,
      ],
      [
        'SOLICITUD_DATOS_REGISTRADA',
        b.propietarioId,
        `solicitud_datos:${enNombre.body.id};ACCESO`,
        'PERMITIDO',
        null,
      ],
    ]);

    // El texto queda solo en la solicitud (con su aislamiento), nunca en la auditoría.
    expect(JSON.stringify(await filasDe('audit_log', b.tenantId))).not.toContain(MARCADOR);
    expect(JSON.stringify(await solicitudesDe(b.tenantId))).toContain(MARCADOR);
  });

  it('un paso rechazado (409, 422) no deja una fila de la acción', async () => {
    const b = await sembrarBarberia();
    const propietario = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    const cliente = await sesionCliente(b.tenantId);
    const { body } = await registrarSolicitud(prueba, cliente.token, { tipo: 'ACCESO' }).expect(201);
    await registrarSolicitud(prueba, cliente.token, { tipo: 'ACCESO' }).expect(409);
    await registrarSolicitud(prueba, cliente.token, { tipo: 'RECTIFICACION' }).expect(422);
    await cerrarSolicitud(prueba, propietario, body.id, { resultado: 'ATENDIDA' }).expect(422);
    const acciones = (await filasDe('audit_log', b.tenantId))
      .map((f) => f.action)
      .filter((a) => String(a).startsWith('SOLICITUD_DATOS_'));
    expect(acciones).toEqual(['SOLICITUD_DATOS_REGISTRADA']);
  });

  it('el texto no aparece en los registros de la aplicación', () => {
    expect(salida.join('')).not.toContain(MARCADOR);
  });
});
