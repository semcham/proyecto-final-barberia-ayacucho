import { randomUUID } from 'node:crypto';
import { sumarDiasHabiles } from '../../../src/modules/acceso-barberias/solicitudes-datos/domain/dias-habiles';
import { ZonaHoraria } from '../../../src/shared/tiempo/zona-horaria';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarCliente, sembrarUsuario } from '../../helpers/fixtures';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import {
  bandeja,
  cerrarSolicitud,
  fijarEstadoSuscripcion,
  iniciarAtencion,
  membresiaDe,
  misSolicitudes,
  registrarEnNombre,
  registrarSolicitud,
  sembrarSolicitudDatos,
  solicitudesDe,
} from '../../helpers/solicitudes-datos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T002 de 007 · US1-1 a US1-9; FR-001 a FR-008, FR-010, FR-011; SC-001. El cliente y el barbero registran sobre sus
// propios datos; el propietario registra "en nombre de" un cliente de su barbería y atiende a mano (en atención,
// atendida con respuesta o rechazada con motivo). Validación: 400 del DTO y 422 de las reglas del dominio.

interface Barberia {
  tenantId: string;
  propietario: string;
  propietarioId: string;
  barbero: string;
  barberoId: string;
  barberoMembresiaId: string;
  cliente: string;
  clienteId: string;
  clienteUsuarioId: string;
}

async function barberiaConPersonas(): Promise<Barberia> {
  const b = await sembrarBarberia();
  const barbero = await sembrarUsuario({
    tenantId: b.tenantId,
    rol: 'BARBERO',
    estado: 'ACTIVA',
    nombre: 'Luis Barbero',
  });
  const cliente = await sesionCliente(b.tenantId);
  await poolDe('seed').query('UPDATE customer_profile SET full_name = $2 WHERE id = $1', [
    cliente.cliente.clienteId,
    'Ana Clienta',
  ]);
  return {
    tenantId: b.tenantId,
    propietario: await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO'),
    propietarioId: b.propietarioId,
    barbero: await tokenPara(b.tenantId, barbero.usuarioId, 'BARBERO'),
    barberoId: barbero.usuarioId,
    barberoMembresiaId: await membresiaDe(b.tenantId, barbero.usuarioId),
    cliente: cliente.token,
    clienteId: cliente.cliente.clienteId,
    clienteUsuarioId: cliente.cliente.usuarioId as string,
  };
}

/** Plazo esperado de una solicitud registrada hoy (fecha local de Lima, la zona de todas las barberías). */
function plazoDeHoy(): string {
  return sumarDiasHabiles(ZonaHoraria.LIMA.fechaDe(new Date()), 10).toString();
}

async function conteos(tenantId: string): Promise<Record<string, number>> {
  const total = async (tabla: string) =>
    (
      await poolDe('seed').query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${tabla} WHERE tenant_id = $1`,
        [tenantId],
      )
    ).rows[0].n;
  return {
    customer_profile: await total('customer_profile'),
    appointment: await total('appointment'),
    membership: await total('membership'),
    consent_record: await total('consent_record'),
  };
}

describe('T002 · Solicitudes sobre datos personales (US1, FR-001 a FR-011)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('registro por el titular', () => {
    it('el cliente registra una de acceso: 201 RECIBIDA, con la fecha, el tipo y el plazo de 10 días hábiles', async () => {
      const b = await barberiaConPersonas();
      const respuesta = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      expect(respuesta.body).toMatchObject({
        id: expect.any(String),
        tipo: 'ACCESO',
        estado: 'RECIBIDA',
        detalle: null,
        respuesta: null,
        motivo: null,
        venceEl: plazoDeHoy(),
        vencida: false,
        enAtencionDesde: null,
        cerradaEn: null,
        enNombre: false,
      });
      expect(Date.parse(respuesta.body.recibidaEn)).not.toBeNaN();
      const [fila] = await solicitudesDe(b.tenantId);
      expect(fila).toMatchObject({
        kind: 'ACCESO',
        subject_kind: 'CLIENTE',
        customer_id: b.clienteId,
        staff_membership_id: null,
        registered_by: b.clienteUsuarioId,
        on_behalf: false,
        status: 'RECIBIDA',
      });
    });

    it('el barbero registra una de rectificación sobre sí mismo (titular: su membresía)', async () => {
      const b = await barberiaConPersonas();
      const respuesta = await registrarSolicitud(prueba, b.barbero, {
        tipo: 'RECTIFICACION',
        detalle: 'Mi nombre se escribe Luiz',
      }).expect(201);
      expect(respuesta.body).toMatchObject({ tipo: 'RECTIFICACION', detalle: 'Mi nombre se escribe Luiz' });
      const [fila] = await solicitudesDe(b.tenantId);
      expect(fila).toMatchObject({
        subject_kind: 'BARBERO',
        customer_id: null,
        staff_membership_id: b.barberoMembresiaId,
        registered_by: b.barberoId,
      });
    });

    it('"mías" devuelve solo las del titular de la sesión', async () => {
      const b = await barberiaConPersonas();
      const otro = await sesionCliente(b.tenantId);
      await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      await registrarSolicitud(prueba, b.cliente, { tipo: 'ELIMINACION' }).expect(201);
      await registrarSolicitud(prueba, otro.token, { tipo: 'ACCESO' }).expect(201);
      await registrarSolicitud(prueba, b.barbero, { tipo: 'ACCESO' }).expect(201);
      const mias = (await misSolicitudes(prueba, b.cliente).expect(200)).body as { tipo: string }[];
      expect(mias.map((s) => s.tipo)).toEqual(['ACCESO', 'ELIMINACION']);
      expect(((await misSolicitudes(prueba, otro.token).expect(200)).body as unknown[]).length).toBe(1);
      expect(((await misSolicitudes(prueba, b.barbero).expect(200)).body as unknown[]).length).toBe(1);
    });

    it('sin solicitudes, "mías" es una lista vacía', async () => {
      const b = await barberiaConPersonas();
      expect((await misSolicitudes(prueba, b.cliente).expect(200)).body).toEqual([]);
    });
  });

  describe('una abierta por titular y tipo (FR-011)', () => {
    it('otra abierta del mismo tipo → 409 SOLICITUD_ABIERTA con el id de la existente; de otro tipo, sí', async () => {
      const b = await barberiaConPersonas();
      const primera = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      const repetida = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(409);
      expect(repetida.body).toEqual({
        codigo: 'SOLICITUD_ABIERTA',
        mensaje: expect.any(String),
        detalles: [{ solicitudId: primera.body.id }],
      });
      await registrarSolicitud(prueba, b.cliente, { tipo: 'ELIMINACION' }).expect(201);
      expect(await solicitudesDe(b.tenantId)).toHaveLength(2);
    });

    it('dos solicitudes simultáneas del mismo tipo: se crea una sola', async () => {
      const b = await barberiaConPersonas();
      const respuestas = await Promise.all([
        registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }),
        registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
      const creada = respuestas.find((r) => r.status === 201);
      const rechazada = respuestas.find((r) => r.status === 409);
      expect(rechazada?.body.detalles).toEqual([{ solicitudId: creada?.body.id }]);
      expect(await solicitudesDe(b.tenantId)).toHaveLength(1);
    });

    it('cerrada la anterior, se puede registrar otra del mismo tipo', async () => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'ATENDIDA',
        respuesta: 'Listo.',
      }).expect(200);
      await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
    });
  });

  describe('"en nombre de" (FR-003)', () => {
    it('el propietario registra una en nombre de un cliente presencial: enNombre = true y queda quién la registró', async () => {
      const b = await barberiaConPersonas();
      const presencial = await sembrarCliente({
        tenantId: b.tenantId,
        conCuenta: false,
        creadoPor: b.propietarioId,
      });
      const respuesta = await registrarEnNombre(prueba, b.propietario, {
        tipo: 'ELIMINACION',
        clienteId: presencial.clienteId,
      }).expect(201);
      expect(respuesta.body).toMatchObject({ tipo: 'ELIMINACION', estado: 'RECIBIDA', enNombre: true });
      const [fila] = await solicitudesDe(b.tenantId);
      expect(fila).toMatchObject({
        subject_kind: 'CLIENTE',
        customer_id: presencial.clienteId,
        registered_by: b.propietarioId,
        on_behalf: true,
      });
    });

    it('con un cliente de otra barbería (o que no existe) → 404 CLIENTE_NO_ENCONTRADO, sin crear nada', async () => {
      const a = await barberiaConPersonas();
      const b = await barberiaConPersonas();
      for (const clienteId of [b.clienteId, randomUUID()]) {
        const respuesta = await registrarEnNombre(prueba, a.propietario, {
          tipo: 'ACCESO',
          clienteId,
        }).expect(404);
        expect(respuesta.body.codigo).toBe('CLIENTE_NO_ENCONTRADO');
      }
      expect(await solicitudesDe(a.tenantId)).toEqual([]);
      expect(await solicitudesDe(b.tenantId)).toEqual([]);
    });

    it('si el cliente ya tiene una abierta del mismo tipo → 409 SOLICITUD_ABIERTA', async () => {
      const b = await barberiaConPersonas();
      const propia = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      const respuesta = await registrarEnNombre(prueba, b.propietario, {
        tipo: 'ACCESO',
        clienteId: b.clienteId,
      }).expect(409);
      expect(respuesta.body.detalles).toEqual([{ solicitudId: propia.body.id }]);
    });
  });

  describe('bandeja y atención del propietario (FR-004 a FR-008)', () => {
    it('la bandeja muestra el titular (tipo y nombre), el plazo y si está vencida; por defecto, las abiertas', async () => {
      const b = await barberiaConPersonas();
      await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      await registrarSolicitud(prueba, b.barbero, { tipo: 'ELIMINACION' }).expect(201);
      const vencidaId = await sembrarSolicitudDatos({
        tenantId: b.tenantId,
        registradaPor: b.clienteUsuarioId,
        clienteId: b.clienteId,
        tipo: 'RECTIFICACION',
        venceEl: '2026-01-05',
      });
      await sembrarSolicitudDatos({
        tenantId: b.tenantId,
        registradaPor: b.clienteUsuarioId,
        clienteId: b.clienteId,
        tipo: 'ELIMINACION',
        estado: 'ATENDIDA',
        venceEl: '2026-01-05',
      });
      const lista = (await bandeja(prueba, b.propietario).expect(200)).body as Record<string, unknown>[];
      expect(lista).toHaveLength(3);
      const porTipo = Object.fromEntries(lista.map((s) => [`${s.tipo}`, s]));
      expect(porTipo.ACCESO).toMatchObject({
        titular: { tipo: 'CLIENTE', nombre: 'Ana Clienta' },
        venceEl: plazoDeHoy(),
        vencida: false,
      });
      expect(porTipo.ELIMINACION).toMatchObject({ titular: { tipo: 'BARBERO', nombre: 'Luis Barbero' } });
      expect(porTipo.RECTIFICACION).toMatchObject({ id: vencidaId, vencida: true, venceEl: '2026-01-05' });

      const atendidas = (await bandeja(prueba, b.propietario, 'ATENDIDA').expect(200)).body as {
        estado: string;
      }[];
      expect(atendidas.map((s) => s.estado)).toEqual(['ATENDIDA']);
      expect(((await bandeja(prueba, b.propietario, 'ABIERTAS').expect(200)).body as unknown[]).length).toBe(
        3,
      );
    });

    it('sin solicitudes, la bandeja es una lista vacía', async () => {
      const b = await barberiaConPersonas();
      expect((await bandeja(prueba, b.propietario).expect(200)).body).toEqual([]);
    });

    it('iniciar, atender con respuesta: el titular ve el estado y la respuesta', async () => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      const enAtencion = await iniciarAtencion(prueba, b.propietario, body.id).expect(200);
      expect(enAtencion.body).toMatchObject({ estado: 'EN_ATENCION', enAtencionDesde: expect.any(String) });
      const cerrada = await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'ATENDIDA',
        respuesta: 'Te enviamos tus datos por el canal acordado.',
      }).expect(200);
      expect(cerrada.body).toMatchObject({
        estado: 'ATENDIDA',
        respuesta: 'Te enviamos tus datos por el canal acordado.',
        cerradaEn: expect.any(String),
        titular: { tipo: 'CLIENTE', nombre: 'Ana Clienta' },
      });
      const [mia] = (await misSolicitudes(prueba, b.cliente).expect(200)).body;
      expect(mia).toMatchObject({
        estado: 'ATENDIDA',
        respuesta: 'Te enviamos tus datos por el canal acordado.',
      });
      const [fila] = await solicitudesDe(b.tenantId);
      expect(fila).toMatchObject({ status: 'ATENDIDA', closed_by: b.propietarioId });
    });

    it('rechazar con motivo: el titular ve el motivo', async () => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.barbero, { tipo: 'ELIMINACION' }).expect(201);
      await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'RECHAZADA',
        motivo: 'Hay que conservar la auditoría',
      }).expect(200);
      const [mia] = (await misSolicitudes(prueba, b.barbero).expect(200)).body;
      expect(mia).toMatchObject({
        estado: 'RECHAZADA',
        motivo: 'Hay que conservar la auditoría',
        respuesta: null,
      });
    });

    it('sobre una cerrada → 409 SOLICITUD_CERRADA; iniciar una en atención → 409', async () => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      await iniciarAtencion(prueba, b.propietario, body.id).expect(200);
      expect((await iniciarAtencion(prueba, b.propietario, body.id).expect(409)).body.codigo).toBe(
        'SOLICITUD_YA_EN_ATENCION',
      );
      await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'ATENDIDA',
        respuesta: 'Hecho.',
      }).expect(200);
      for (const intento of [
        () => iniciarAtencion(prueba, b.propietario, body.id),
        () => cerrarSolicitud(prueba, b.propietario, body.id, { resultado: 'ATENDIDA', respuesta: 'Otra.' }),
        () =>
          cerrarSolicitud(prueba, b.propietario, body.id, { resultado: 'RECHAZADA', motivo: 'Otro motivo' }),
      ]) {
        const respuesta = await intento().expect(409);
        expect(respuesta.body.codigo).toBe('SOLICITUD_CERRADA');
      }
      const [fila] = await solicitudesDe(b.tenantId);
      expect(fila).toMatchObject({ status: 'ATENDIDA', response: 'Hecho.' });
    });

    it('la de otra barbería (o un id que no existe) → 404 SOLICITUD_NO_ENCONTRADA, sin cambiarla', async () => {
      const a = await barberiaConPersonas();
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      for (const id of [body.id, randomUUID()]) {
        expect((await iniciarAtencion(prueba, a.propietario, id).expect(404)).body.codigo).toBe(
          'SOLICITUD_NO_ENCONTRADA',
        );
        expect(
          (
            await cerrarSolicitud(prueba, a.propietario, id, {
              resultado: 'ATENDIDA',
              respuesta: 'x',
            }).expect(404)
          ).body.codigo,
        ).toBe('SOLICITUD_NO_ENCONTRADA');
      }
      expect((await solicitudesDe(b.tenantId))[0]).toMatchObject({ status: 'RECIBIDA' });
      expect((await bandeja(prueba, a.propietario).expect(200)).body).toEqual([]);
    });

    it('atender una eliminación no borra ni exporta nada: clientes, citas, membresías y consentimientos iguales', async () => {
      const b = await barberiaConPersonas();
      const antes = await conteos(b.tenantId);
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ELIMINACION' }).expect(201);
      await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'ATENDIDA',
        respuesta: 'Se borró el teléfono a mano; se conserva el consentimiento y la auditoría.',
      }).expect(200);
      expect(await conteos(b.tenantId)).toEqual(antes);
    });
  });

  describe('permisos (FR-005, FR-006)', () => {
    it('el propietario no registra solicitudes sobre su propia cuenta ni ve "mías": 403', async () => {
      const b = await barberiaConPersonas();
      expect(
        (await registrarSolicitud(prueba, b.propietario, { tipo: 'ACCESO' }).expect(403)).body.codigo,
      ).toBe('ACCESO_DENEGADO');
      await misSolicitudes(prueba, b.propietario).expect(403);
      expect(await solicitudesDe(b.tenantId)).toEqual([]);
    });

    it('el barbero y el cliente no ven la bandeja ni atienden: 403', async () => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      for (const token of [b.barbero, b.cliente]) {
        await bandeja(prueba, token).expect(403);
        await iniciarAtencion(prueba, token, body.id).expect(403);
        await cerrarSolicitud(prueba, token, body.id, { resultado: 'ATENDIDA', respuesta: 'x' }).expect(403);
        await registrarEnNombre(prueba, token, { tipo: 'ACCESO', clienteId: b.clienteId }).expect(403);
      }
    });
  });

  describe('validación: 400 del DTO y 422 del dominio (contracts/openapi.yaml)', () => {
    it.each([
      ['un campo tenant', { tipo: 'ACCESO', tenant: randomUUID() }],
      ['un campo barberia', { tipo: 'ACCESO', barberia: 'otra' }],
      ['un tipo desconocido', { tipo: 'OPOSICION' }],
      ['sin tipo', {}],
      ['un detalle de más de 500 caracteres', { tipo: 'ACCESO', detalle: 'x'.repeat(501) }],
    ])('registrar con %s → 400 VALIDACION', async (_caso, cuerpo) => {
      const b = await barberiaConPersonas();
      const respuesta = await registrarSolicitud(prueba, b.cliente, cuerpo).expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      expect(await solicitudesDe(b.tenantId)).toEqual([]);
    });

    it('en nombre de con un tipo desconocido o sin clienteId → 400', async () => {
      const b = await barberiaConPersonas();
      await registrarEnNombre(prueba, b.propietario, { tipo: 'OTRO', clienteId: b.clienteId }).expect(400);
      await registrarEnNombre(prueba, b.propietario, { tipo: 'ACCESO' }).expect(400);
      await registrarEnNombre(prueba, b.propietario, { tipo: 'ACCESO', clienteId: 'no-es-uuid' }).expect(400);
    });

    it.each([
      ['un resultado desconocido', { resultado: 'BORRADA' }],
      ['un campo desconocido', { resultado: 'ATENDIDA', respuesta: 'Ok', tenant: randomUUID() }],
      ['una respuesta de más de 1 000 caracteres', { resultado: 'ATENDIDA', respuesta: 'x'.repeat(1001) }],
      ['un motivo de menos de 5', { resultado: 'RECHAZADA', motivo: 'no' }],
      ['un motivo de más de 300', { resultado: 'RECHAZADA', motivo: 'x'.repeat(301) }],
    ])('cerrar con %s → 400 VALIDACION, sin cambiar la solicitud', async (_caso, cuerpo) => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      const respuesta = await cerrarSolicitud(prueba, b.propietario, body.id, cuerpo).expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      expect((await solicitudesDe(b.tenantId))[0]).toMatchObject({ status: 'RECIBIDA' });
    });

    it('rectificación sin detalle → 422 VALIDACION con el campo detalle', async () => {
      const b = await barberiaConPersonas();
      const respuesta = await registrarSolicitud(prueba, b.cliente, { tipo: 'RECTIFICACION' }).expect(422);
      expect(respuesta.body).toEqual({
        codigo: 'VALIDACION',
        mensaje: expect.any(String),
        detalles: [{ campo: 'detalle', problema: 'requerido' }],
      });
      const enNombre = await registrarEnNombre(prueba, b.propietario, {
        tipo: 'RECTIFICACION',
        clienteId: b.clienteId,
      }).expect(422);
      expect(enNombre.body.detalles).toEqual([{ campo: 'detalle', problema: 'requerido' }]);
    });

    it('ATENDIDA sin respuesta y RECHAZADA sin motivo → 422 VALIDACION con el campo', async () => {
      const b = await barberiaConPersonas();
      const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
      const sinRespuesta = await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'ATENDIDA',
      }).expect(422);
      expect(sinRespuesta.body.detalles).toEqual([{ campo: 'respuesta', problema: 'requerido' }]);
      const sinMotivo = await cerrarSolicitud(prueba, b.propietario, body.id, {
        resultado: 'RECHAZADA',
      }).expect(422);
      expect(sinMotivo.body.detalles).toEqual([{ campo: 'motivo', problema: 'requerido' }]);
      expect((await solicitudesDe(b.tenantId))[0]).toMatchObject({ status: 'RECIBIDA' });
    });
  });

  describe('vale en cualquier estado de la suscripción (es un derecho del titular)', () => {
    it.each(['EXPIRED', 'SUSPENDED'] as const)(
      'con la suscripción %s todo responde igual',
      async (estado) => {
        const b = await barberiaConPersonas();
        await fijarEstadoSuscripcion(b.tenantId, estado);
        const { body } = await registrarSolicitud(prueba, b.cliente, { tipo: 'ACCESO' }).expect(201);
        await registrarSolicitud(prueba, b.barbero, { tipo: 'ACCESO' }).expect(201);
        const presencial = await sembrarCliente({
          tenantId: b.tenantId,
          conCuenta: false,
          creadoPor: b.propietarioId,
        });
        await registrarEnNombre(prueba, b.propietario, {
          tipo: 'ACCESO',
          clienteId: presencial.clienteId,
        }).expect(201);
        await misSolicitudes(prueba, b.cliente).expect(200);
        expect(((await bandeja(prueba, b.propietario).expect(200)).body as unknown[]).length).toBe(3);
        await iniciarAtencion(prueba, b.propietario, body.id).expect(200);
        await cerrarSolicitud(prueba, b.propietario, body.id, {
          resultado: 'ATENDIDA',
          respuesta: 'Hecho.',
        }).expect(200);
      },
    );
  });
});
