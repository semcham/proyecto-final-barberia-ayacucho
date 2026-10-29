import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { CrearUsuario } from '../../src/modules/acceso-barberias/identidad/application/crear-usuario';
import { AccesoDenegado } from '../../src/modules/acceso-barberias';
import { EjecutorTareas } from '../../src/shared';
import { type AppDePrueba, crearApp } from '../helpers/app';
import {
  filasDe,
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarPago,
  sembrarServicio,
} from '../helpers/fixtures';
import {
  iniciarTransferencia,
  pagoEnRevision,
  png,
  revisar,
  subirComprobante,
} from '../helpers/comprobantes';
import { barberiaEnPrueba, notificar, PLAN_BASICO } from '../helpers/pagos';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../helpers/reservas';
import { cerrarPools, poolDe } from '../helpers/test-db';
import {
  crearEscenario,
  type Escenario,
  sesionCliente,
  tokenPara,
  tokenPlataformaPara,
} from '../helpers/sesiones';

// T114 · PR13: cada acción sensible de FR-027 deja exactamente un registro completo en audit_log de su
// barbería, y la aplicación no puede modificarlo ni borrarlo (SC-007).

type Fila = Record<string, unknown>;
const correoNuevo = () => `auditoria-${randomBytes(4).toString('hex')}@prueba.pe`;
const CLAVE = 'una clave larga y propia';

describe('PR13 · Auditoría de acciones sensibles', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Ejecuta la acción y devuelve las filas de audit_log nuevas de esa barbería. */
  async function registrosNuevos(tenantId: string, accion: () => Promise<unknown>): Promise<Fila[]> {
    const antes = new Set((await filasDe('audit_log', tenantId)).map((fila) => fila.id));
    await accion();
    return (await filasDe('audit_log', tenantId)).filter((fila) => !antes.has(fila.id));
  }

  function esCompleto(
    fila: Fila,
    esperado: { tenantId: string; actorId: string; accion: string; resultado: string },
  ) {
    expect(fila).toMatchObject({
      tenant_id: esperado.tenantId,
      actor_id: esperado.actorId,
      action: esperado.accion,
      result: esperado.resultado,
    });
    expect(typeof fila.resource).toBe('string');
    expect(fila.at).toBeInstanceOf(Date);
  }

  /** Los registros que nacen de una solicitud HTTP llevan la IP y el identificador de correlación. */
  function vieneDeLaSolicitud(fila: Fila, correlacion: string) {
    expect(fila.ip).toEqual(expect.any(String));
    expect(fila.correlation_id).toBe(correlacion);
  }

  const correlacion = () => `prueba-${randomBytes(6).toString('hex')}`;
  const conPropietario = (e: Escenario, id: string) => ({
    Authorization: `Bearer ${e.tokenPropietario}`,
    'X-Correlation-Id': id,
  });

  it('BARBERIA_REGISTRADA (actor: el propietario recién creado)', async () => {
    const id = correlacion();
    const respuesta = await prueba.agente
      .post('/api/v1/barberias')
      .set('X-Correlation-Id', id)
      .send({
        nombreBarberia: 'Barbería Auditada',
        propietario: { nombre: 'Dueña Auditada', correo: correoNuevo(), contrasena: CLAVE },
        aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
      })
      .expect(201);
    const filas = await filasDe('audit_log', respuesta.body.barberia.id);
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: respuesta.body.barberia.id,
      actorId: respuesta.body.sesion.usuario.id,
      accion: 'BARBERIA_REGISTRADA',
      resultado: 'PERMITIDO',
    });
    vieneDeLaSolicitud(filas[0], id);
  });

  it('USUARIO_CREADO, USUARIO_DESACTIVADO, USUARIO_REACTIVADO y ACTIVACION_REGENERADA', async () => {
    const e = await crearEscenario();
    const base = { tenantId: e.barberia.tenantId, actorId: e.barberia.propietarioId, resultado: 'PERMITIDO' };
    let nuevoId = '';

    const pasos: [string, () => Promise<unknown>, string][] = [
      [
        'USUARIO_CREADO',
        async () => {
          const r = await prueba.agente
            .post('/api/v1/usuarios')
            .set(conPropietario(e, 'correlacion-crear'))
            .send({ nombre: 'Barbero Auditado', correo: correoNuevo(), rol: 'BARBERO' })
            .expect(201);
          nuevoId = r.body.usuario.id;
        },
        'correlacion-crear',
      ],
      [
        'ACTIVACION_REGENERADA',
        () =>
          prueba.agente
            .post(`/api/v1/usuarios/${nuevoId}/activacion`)
            .set(conPropietario(e, 'correlacion-regen'))
            .expect(201),
        'correlacion-regen',
      ],
      [
        'USUARIO_DESACTIVADO',
        () =>
          prueba.agente
            .patch(`/api/v1/usuarios/${nuevoId}`)
            .set(conPropietario(e, 'correlacion-desact'))
            .send({ estado: 'DESACTIVADA' })
            .expect(200),
        'correlacion-desact',
      ],
      [
        'USUARIO_REACTIVADO',
        () =>
          prueba.agente
            .patch(`/api/v1/usuarios/${nuevoId}`)
            .set(conPropietario(e, 'correlacion-react'))
            .send({ estado: 'ACTIVA' })
            .expect(200),
        'correlacion-react',
      ],
    ];

    for (const [accion, ejecutar, idCorrelacion] of pasos) {
      const filas = await registrosNuevos(e.barberia.tenantId, ejecutar);
      expect(filas.map((fila) => fila.action)).toEqual([accion]);
      esCompleto(filas[0], { ...base, accion });
      expect(filas[0].resource).toBe(`usuario:${nuevoId}`);
      vieneDeLaSolicitud(filas[0], idCorrelacion);
    }
  });

  it('ACCESO_DENEGADO_ROL desde el guard HTTP', async () => {
    const e = await crearEscenario();
    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .get('/api/v1/usuarios')
        .set({ Authorization: `Bearer ${e.tokenBarbero}`, 'X-Correlation-Id': 'correlacion-guard' })
        .expect(403),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'ACCESO_DENEGADO_ROL',
      resultado: 'DENEGADO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-guard');
  });

  it('ACCESO_DENEGADO_ROL desde el caso de uso, sin pasar por HTTP (R22)', async () => {
    // Por HTTP el guard lo rechazaría antes; aquí se invoca el caso de uso como lo haría M04.
    const e = await crearEscenario();
    const crearUsuario = prueba.app.get(CrearUsuario, { strict: false });
    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      expect(
        crearUsuario.ejecutar(
          {
            usuarioId: e.barberoActivo.id,
            tenantId: e.barberia.tenantId,
            rol: 'BARBERO',
            sesionId: 'directo',
          },
          { nombre: 'No Debería', correo: correoNuevo(), rol: 'BARBERO' },
        ),
      ).rejects.toBeInstanceOf(AccesoDenegado),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'ACCESO_DENEGADO_ROL',
      resultado: 'DENEGADO',
    });
    expect(filas[0].resource).toBe('operacion:CREAR_USUARIO');
  });

  it('ACCESO_TENANT_AJENO ante un intento explícito', async () => {
    const e = await crearEscenario();
    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .get('/api/v1/auth/yo')
        .set({
          ...conPropietario(e, 'correlacion-ajeno'),
          'X-Tenant-Id': '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        })
        .expect(400),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberia.propietarioId,
      accion: 'ACCESO_TENANT_AJENO',
      resultado: 'DENEGADO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-ajeno');
  });

  /** Inicia sesión como el barbero del escenario y renueva una vez; devuelve la cookie ya rotada. */
  async function cookieRotada(e: Awaited<ReturnType<typeof crearEscenario>>) {
    const inicio = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: e.barberoActivo.correo, contrasena: e.barberoActivo.contrasena })
      .expect(200);
    const cookie = ([] as string[])
      .concat(inicio.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('rt='))
      ?.split(';')[0] as string;
    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);
    return cookie;
  }

  it('SESION_RENOVADA_EN_GRACIA al repetir la renovación con el token anterior dentro de la ventana', async () => {
    const e = await crearEscenario();
    const cookie = await cookieRotada(e);

    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .post('/api/v1/auth/refresh')
        .set({ Cookie: cookie, 'X-Correlation-Id': 'correlacion-gracia' })
        .expect(200),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'SESION_RENOVADA_EN_GRACIA',
      resultado: 'PERMITIDO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-gracia');
  });

  it('SESION_REUTILIZADA al usar un token de renovación ya rotado fuera del período de gracia', async () => {
    const e = await crearEscenario();
    const cookie = await cookieRotada(e);
    // Simula que la rotación ocurrió hace 11 s (fuera de la ventana de 10 s), sin esperar.
    await poolDe('seed').query(
      `UPDATE auth_session SET rotated_at = rotated_at - interval '11 seconds' WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );

    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .post('/api/v1/auth/refresh')
        .set({ Cookie: cookie, 'X-Correlation-Id': 'correlacion-reuso' })
        .expect(401),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'SESION_REUTILIZADA',
      resultado: 'DENEGADO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-reuso');
  });

  // T132 · Funcionalidad 002 (R19, FR-050): las 12 acciones nuevas. Cada una deja un registro con actor,
  // recurso solo por identificador (tipo:uuid), barbería, resultado, fecha, IP y correlación, sin datos
  // personales del cliente en el texto.
  describe('acciones de la funcionalidad 002', () => {
    const CANARIO = {
      nombre: 'Cliente Auditado Canario',
      correo: `canario-${randomBytes(4).toString('hex')}@prueba.pe`,
      telefono: '977000111',
    };
    const RECURSO = /^[a-z-]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    /** Exactamente un registro de la acción, completo, sin datos personales, con la IP y la correlación. */
    function unRegistro(
      filas: Fila[],
      esperado: { tenantId: string; actorId: string; accion: string; recurso: string },
      idCorrelacion: string,
    ) {
      const deLaAccion = filas.filter((fila) => fila.action === esperado.accion);
      expect(deLaAccion).toHaveLength(1);
      const [fila] = deLaAccion;
      esCompleto(fila, { ...esperado, resultado: 'PERMITIDO' });
      expect(fila.resource).toBe(esperado.recurso);
      expect(fila.resource).toMatch(RECURSO);
      vieneDeLaSolicitud(fila, idCorrelacion);
      const texto = JSON.stringify(fila);
      for (const dato of Object.values(CANARIO)) expect(texto).not.toContain(dato);
    }

    const con = (token: string, id: string) => ({ Authorization: `Bearer ${token}`, 'X-Correlation-Id': id });
    let e: BarberiaParaReservar;
    let propietario: string;

    beforeAll(async () => {
      e = await barberiaParaReservar();
      propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    });

    it('CLIENTE_REGISTRADO (actor: la cuenta nueva)', async () => {
      let usuarioId = '';
      let clienteId = '';
      const filas = await registrosNuevos(e.barberia.tenantId, async () => {
        const r = await prueba.agente
          .post('/api/v1/clientes/registro')
          .set('X-Correlation-Id', 'correlacion-registro-cliente')
          .send({
            barberia: e.barberia.slug,
            ...CANARIO,
            contrasena: CLAVE,
            aceptaPoliticaDatos: true,
            versionPoliticaDatos: '2026-10',
          })
          .expect(201);
        usuarioId = r.body.usuario.id;
        const { rows } = await poolDe('seed').query('SELECT id FROM customer_profile WHERE user_id = $1', [
          usuarioId,
        ]);
        clienteId = rows[0].id;
      });
      unRegistro(
        filas,
        {
          tenantId: e.barberia.tenantId,
          actorId: usuarioId,
          accion: 'CLIENTE_REGISTRADO',
          recurso: `cliente:${clienteId}`,
        },
        'correlacion-registro-cliente',
      );
    });

    it('CLIENTE_UNIDO (actor: la cuenta que se une con el enlace)', async () => {
      const otra = await barberiaParaReservar();
      const cuenta = await sembrarCliente({ tenantId: otra.barberia.tenantId });
      const filas = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .post('/api/v1/auth/login')
          .set('X-Correlation-Id', 'correlacion-union')
          .send({
            correo: cuenta.correo,
            contrasena: cuenta.contrasena,
            barberia: e.barberia.slug,
            aceptaPoliticaDatos: true,
            versionPoliticaDatos: '2026-10',
            telefono: CANARIO.telefono,
          })
          .expect(200),
      );
      const { rows } = await poolDe('seed').query(
        'SELECT id FROM customer_profile WHERE user_id = $1 AND tenant_id = $2',
        [cuenta.usuarioId, e.barberia.tenantId],
      );
      unRegistro(
        filas,
        {
          tenantId: e.barberia.tenantId,
          actorId: cuenta.usuarioId as string,
          accion: 'CLIENTE_UNIDO',
          recurso: `cliente:${rows[0].id}`,
        },
        'correlacion-union',
      );
    });

    it('CLIENTE_PRESENCIAL_REGISTRADO (actor: el propietario)', async () => {
      let clienteId = '';
      const filas = await registrosNuevos(e.barberia.tenantId, async () => {
        const r = await prueba.agente
          .post('/api/v1/clientes')
          .set(con(propietario, 'correlacion-presencial'))
          .send({
            nombre: CANARIO.nombre,
            telefono: CANARIO.telefono,
            consentimientoVerbal: true,
            versionPoliticaDatos: '2026-10',
          })
          .expect(201);
        clienteId = r.body.id;
      });
      unRegistro(
        filas,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'CLIENTE_PRESENCIAL_REGISTRADO',
          recurso: `cliente:${clienteId}`,
        },
        'correlacion-presencial',
      );
    });

    it('BARBERIA_CAMBIADA (registrada en la barbería destino)', async () => {
      const origen = await barberiaParaReservar();
      const enOrigen = await sesionCliente(origen.barberia.tenantId);
      await sembrarCliente({
        tenantId: e.barberia.tenantId,
        usuarioId: enOrigen.cliente.usuarioId as string,
      });
      const filas = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .post('/api/v1/auth/barberia')
          .set(con(enOrigen.token, 'correlacion-cambio'))
          .send({ barberia: e.barberia.slug })
          .expect(200),
      );
      unRegistro(
        filas,
        {
          tenantId: e.barberia.tenantId,
          actorId: enOrigen.cliente.usuarioId as string,
          accion: 'BARBERIA_CAMBIADA',
          recurso: `barberia:${e.barberia.tenantId}`,
        },
        'correlacion-cambio',
      );
    });

    it('ENLACE_CAMBIADO (recurso: la barbería, no el texto del enlace)', async () => {
      const filas = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .patch('/api/v1/barberia')
          .set(con(propietario, 'correlacion-enlace'))
          .send({ slug: `auditada-${randomBytes(3).toString('hex')}` })
          .expect(200),
      );
      unRegistro(
        filas,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'ENLACE_CAMBIADO',
          recurso: `barberia:${e.barberia.tenantId}`,
        },
        'correlacion-enlace',
      );
    });

    it('SERVICIO_DESACTIVADO y BARBERO_DESACTIVADO', async () => {
      const servicio = await sembrarServicio({ tenantId: e.barberia.tenantId });
      const servicioFilas = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .patch(`/api/v1/servicios/${servicio.servicioId}`)
          .set(con(propietario, 'correlacion-servicio'))
          .send({ activo: false })
          .expect(200),
      );
      unRegistro(
        servicioFilas,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'SERVICIO_DESACTIVADO',
          recurso: `servicio:${servicio.servicioId}`,
        },
        'correlacion-servicio',
      );

      const barbero = await sembrarBarbero({ tenantId: e.barberia.tenantId });
      const barberoFilas = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .patch(`/api/v1/barberos/${barbero.barberoId}`)
          .set(con(propietario, 'correlacion-barbero'))
          .send({ activo: false })
          .expect(200),
      );
      unRegistro(
        barberoFilas,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'BARBERO_DESACTIVADO',
          recurso: `barbero:${barbero.barberoId}`,
        },
        'correlacion-barbero',
      );
    });

    it('BLOQUEO_CON_CONFLICTO y CAMBIO_CON_CONFLICTO (horario de atención y disponibilidad)', async () => {
      const cliente = await sembrarCliente({
        tenantId: e.barberia.tenantId,
        nombre: CANARIO.nombre,
        telefono: CANARIO.telefono,
      });
      const dia = fechaEnDias(4);
      await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.otroBarberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(horaLima(dia, '18:00')),
      });

      let bloqueoId = '';
      const bloqueoFilas = await registrosNuevos(e.barberia.tenantId, async () => {
        const r = await prueba.agente
          .post(`/api/v1/barberos/${e.otroBarberoId}/bloqueos`)
          .set(con(propietario, 'correlacion-bloqueo'))
          .send({ inicio: horaLima(dia, '17:30'), fin: horaLima(dia, '18:30'), confirmarConflictos: true })
          .expect(201);
        bloqueoId = r.body.id;
      });
      unRegistro(
        bloqueoFilas,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'BLOQUEO_CON_CONFLICTO',
          recurso: `bloqueo:${bloqueoId}`,
        },
        'correlacion-bloqueo',
      );

      const reducidos = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({
        diaSemana,
        inicio: '09:00',
        fin: '13:00',
      }));
      const disponibilidad = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .put(`/api/v1/barberos/${e.otroBarberoId}/disponibilidad`)
          .set(con(propietario, 'correlacion-disponibilidad'))
          .send({ tramos: reducidos, confirmarConflictos: true })
          .expect(200),
      );
      unRegistro(
        disponibilidad,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'CAMBIO_CON_CONFLICTO',
          recurso: `disponibilidad:${e.otroBarberoId}`,
        },
        'correlacion-disponibilidad',
      );

      const horario = await registrosNuevos(e.barberia.tenantId, () =>
        prueba.agente
          .put('/api/v1/barberia/horario')
          .set(con(propietario, 'correlacion-horario'))
          .send({ tramos: reducidos, confirmarConflictos: true })
          .expect(200),
      );
      unRegistro(
        horario,
        {
          tenantId: e.barberia.tenantId,
          actorId: e.barberia.propietarioId,
          accion: 'CAMBIO_CON_CONFLICTO',
          recurso: `horario-atencion:${e.barberia.tenantId}`,
        },
        'correlacion-horario',
      );
    });

    it('CITA_RESERVADA, CITA_ESTADO_CAMBIADO y CITA_CANCELADA', async () => {
      const f = await barberiaParaReservar();
      const tokenPropietario = await tokenPara(f.barberia.tenantId, f.barberia.propietarioId, 'PROPIETARIO');
      const cliente = await sesionCliente(f.barberia.tenantId);
      let citaId = '';
      const reservada = await registrosNuevos(f.barberia.tenantId, async () => {
        const r = await prueba.agente
          .post('/api/v1/citas')
          .set({ ...con(cliente.token, 'correlacion-reserva'), 'Idempotency-Key': nuevaClave() })
          .send({
            servicioId: f.servicioId,
            barberoId: f.barberoId,
            inicio: horaLima(fechaEnDias(2), '10:00'),
          })
          .expect(201);
        citaId = r.body.id;
      });
      unRegistro(
        reservada,
        {
          tenantId: f.barberia.tenantId,
          actorId: cliente.cliente.usuarioId as string,
          accion: 'CITA_RESERVADA',
          recurso: `cita:${citaId}`,
        },
        'correlacion-reserva',
      );

      const cancelada = await registrosNuevos(f.barberia.tenantId, () =>
        prueba.agente
          .post(`/api/v1/citas/${citaId}/cancelar`)
          .set(con(cliente.token, 'correlacion-cancelar'))
          .send({ motivo: 'Motivo libre' })
          .expect(200),
      );
      unRegistro(
        cancelada,
        {
          tenantId: f.barberia.tenantId,
          actorId: cliente.cliente.usuarioId as string,
          accion: 'CITA_CANCELADA',
          recurso: `cita:${citaId}`,
        },
        'correlacion-cancelar',
      );

      const pasada = await sembrarCita({
        tenantId: f.barberia.tenantId,
        barberoId: f.barberoId,
        servicioId: f.servicioId,
        clienteId: cliente.cliente.clienteId,
        inicio: new Date(horaLima(fechaEnDias(-1), '10:00')),
      });
      const cambiada = await registrosNuevos(f.barberia.tenantId, () =>
        prueba.agente
          .post(`/api/v1/citas/${pasada}/estado`)
          .set(con(tokenPropietario, 'correlacion-estado'))
          .send({ estado: 'COMPLETADA' })
          .expect(200),
      );
      unRegistro(
        cambiada,
        {
          tenantId: f.barberia.tenantId,
          actorId: f.barberia.propietarioId,
          accion: 'CITA_ESTADO_CAMBIADO',
          recurso: `cita:${pasada}`,
        },
        'correlacion-estado',
      );
    });
  });

  // T056 · Funcionalidad 003 (FR-031, FR-037): las transiciones automáticas de la suscripción, sin actor y con
  // la fecha que les correspondía (no la de la corrida), y la aprobación del pago. Ninguna lleva datos
  // personales del propietario.
  describe('acciones de la funcionalidad 003', () => {
    const DIA = 24 * 60 * 60 * 1000;
    const RECURSO = /^(suscripcion|pago):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const vencer = () => prueba.app.get(EjecutorTareas).ejecutarAhora('vencer-suscripciones');

    async function barberia(nombre: string) {
      const b = await sembrarBarberia({ nombre, propietario: { nombre: `Dueño ${nombre}` } });
      const { rows } = await poolDe('seed').query('SELECT id FROM subscription WHERE tenant_id = $1', [
        b.tenantId,
      ]);
      return { ...b, suscripcionId: rows[0].id as string };
    }

    /** Un solo registro de la acción, sin actor, con su fecha y sin el nombre ni el correo del propietario. */
    function registro(
      filas: Fila[],
      b: { tenantId: string; correo: string },
      accion: string,
      recurso: string,
    ) {
      const deLaAccion = filas.filter((fila) => fila.action === accion);
      expect(deLaAccion).toHaveLength(1);
      const [fila] = deLaAccion;
      expect(fila).toMatchObject({
        tenant_id: b.tenantId,
        actor_id: null,
        result: 'PERMITIDO',
        resource: recurso,
      });
      expect(fila.resource).toMatch(RECURSO);
      const texto = JSON.stringify(fila);
      expect(texto).not.toContain(b.correo);
      expect(texto).not.toContain('Dueño');
      return fila;
    }

    it('SUSCRIPCION_VENCIDA al terminar la prueba, con la fecha de fin de la prueba', async () => {
      const b = await barberia('Vencida Auditada');
      const fin = new Date(Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000) * 1000);
      await poolDe('seed').query(
        'UPDATE subscription SET trial_ends_at = $2, current_period_end = $2 WHERE id = $1',
        [b.suscripcionId, fin],
      );
      const filas = await registrosNuevos(b.tenantId, vencer);
      expect(registro(filas, b, 'SUSCRIPCION_VENCIDA', `suscripcion:${b.suscripcionId}`).at).toEqual(fin);
    });

    it('PAGO_APROBADO y SUSCRIPCION_ACTIVADA con el inicio del período pagado', async () => {
      const b = await barberia('Activa Auditada');
      // La prueba terminó hace una hora (sin que la tarea pasara): el período pagado empieza al aprobarse.
      const fin = new Date(Date.now() - 60 * 60 * 1000);
      await poolDe('seed').query(
        'UPDATE subscription SET trial_ends_at = $2, current_period_end = $2 WHERE id = $1',
        [b.suscripcionId, fin],
      );
      const pago = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        cubreDesde: fin,
      });

      const filas = await registrosNuevos(b.tenantId, () =>
        notificar(prueba, { referencia: pago.referencia }).expect(200),
      );
      registro(filas, b, 'PAGO_APROBADO', `pago:${pago.pagoId}`);
      const { rows } = await poolDe('seed').query(
        'SELECT starts_at FROM subscription_period WHERE payment_id = $1',
        [pago.pagoId],
      );
      const activada = registro(filas, b, 'SUSCRIPCION_ACTIVADA', `suscripcion:${b.suscripcionId}`);
      expect(activada.at).toEqual(rows[0].starts_at);
      expect(filas.map((fila) => fila.action).sort()).toEqual(['PAGO_APROBADO', 'SUSCRIPCION_ACTIVADA']);

      // La tarea no vuelve a registrar lo ya hecho.
      expect(await registrosNuevos(b.tenantId, vencer)).toEqual([]);
    });

    it('SUSCRIPCION_EN_GRACIA al terminar el período sin el siguiente, con la fecha de su fin', async () => {
      const b = await barberia('En Gracia Auditada');
      const inicio = new Date(Math.floor((Date.now() - 32 * DIA) / 1000) * 1000);
      const { pagoId } = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        metodo: 'TRANSFERENCIA',
        estado: 'APROBADO',
        plan: 'BASICO',
        cubreDesde: inicio,
      });
      const { rows } = await poolDe('seed').query(
        `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6::timestamptz + interval '1 month') RETURNING ends_at`,
        [uuidv7(), b.tenantId, b.suscripcionId, pagoId, PLAN_BASICO, inicio],
      );
      await poolDe('seed').query(
        `UPDATE subscription SET status = 'ACTIVE', plan_id = $2, trial_ends_at = $3, current_period_end = $4
          WHERE id = $1`,
        [b.suscripcionId, PLAN_BASICO, inicio, rows[0].ends_at],
      );
      const filas = await registrosNuevos(b.tenantId, vencer);
      expect(filas.map((fila) => fila.action)).toEqual(['SUSCRIPCION_EN_GRACIA']);
      expect(registro(filas, b, 'SUSCRIPCION_EN_GRACIA', `suscripcion:${b.suscripcionId}`).at).toEqual(
        rows[0].ends_at,
      );
    });
  });

  // T076 · US3 (FR-037): la revisión del comprobante queda en el audit_log de la barbería, con el administrador
  // como actor y el pago como recurso; el motivo queda con el comprobante. Nunca el contenido, el nombre ni el
  // número de operación.
  describe('revisión de comprobantes (US3)', () => {
    it.each([
      ['COMPROBANTE_APROBADO', { resultado: 'APROBADO', importeTransferidoCentimos: 4900 }],
      ['COMPROBANTE_RECHAZADO', { resultado: 'RECHAZADO', motivo: 'El voucher no corresponde a la cuenta' }],
    ] as const)('%s con el administrador como actor y sin el comprobante', async (accion, revision) => {
      const adminId = uuidv7();
      const { token } = await tokenPlataformaPara(adminId);
      const b = await barberiaEnPrueba();
      const contenido = `CANARIO-${randomBytes(8).toString('hex')}`;
      const { pagoId, numero } = await pagoEnRevision(prueba, b.token, {
        archivo: Buffer.concat([png(16), Buffer.from(contenido)]),
      });
      const correlacion = `correlacion-${revision.resultado.toLowerCase()}`;
      const filas = await registrosNuevos(b.tenantId, () =>
        revisar(prueba, token, b.tenantId, pagoId, revision).set('X-Correlation-Id', correlacion).expect(200),
      );
      const deLaAccion = filas.filter((fila) => fila.action === accion);
      expect(deLaAccion).toHaveLength(1);
      esCompleto(deLaAccion[0], { tenantId: b.tenantId, actorId: adminId, accion, resultado: 'PERMITIDO' });
      expect(deLaAccion[0].resource).toBe(`pago:${pagoId}`);
      vieneDeLaSolicitud(deLaAccion[0], correlacion);
      const texto = JSON.stringify(filas);
      for (const prohibido of [contenido, numero]) expect(texto).not.toContain(prohibido);

      // El motivo queda con el comprobante, junto a quién lo revisó.
      const { rows } = await poolDe('seed').query(
        'SELECT reviewed_by, review_result, review_reason FROM payment_receipt WHERE tenant_id = $1',
        [b.tenantId],
      );
      expect(rows).toEqual([
        {
          reviewed_by: adminId,
          review_result: revision.resultado,
          review_reason: revision.resultado === 'RECHAZADO' ? revision.motivo : null,
        },
      ]);
    });

    it('COMPROBANTE_SUBIDO con el propietario como actor', async () => {
      const b = await barberiaEnPrueba();
      const { body } = await iniciarTransferencia(prueba, b.token).expect(201);
      const filas = await registrosNuevos(b.tenantId, () =>
        subirComprobante(prueba, b.token, body.pago.id, { archivo: png() })
          .set('X-Correlation-Id', 'correlacion-subida')
          .expect(201),
      );
      expect(filas.map((fila) => fila.action)).toEqual(['COMPROBANTE_SUBIDO']);
      esCompleto(filas[0], {
        tenantId: b.tenantId,
        actorId: b.propietarioId,
        accion: 'COMPROBANTE_SUBIDO',
        resultado: 'PERMITIDO',
      });
      expect(filas[0].resource).toBe(`pago:${body.pago.id}`);
      vieneDeLaSolicitud(filas[0], 'correlacion-subida');
    });
  });

  it('barberias_app no puede modificar ni borrar registros de auditoría', async () => {
    const e = await crearEscenario();
    const cliente = await poolDe('app').connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [e.barberia.tenantId]);
      await expect(cliente.query("UPDATE audit_log SET action = 'BORRADO'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await cliente.query('ROLLBACK');
      cliente.release();
    }
    await expect(poolDe('app').query('DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
  });
});
