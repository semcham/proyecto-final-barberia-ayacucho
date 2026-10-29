import { randomBytes, randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { erroresDeContrato003 } from '../../helpers/contrato';
import {
  filasDe,
  sembrarBarberia,
  sembrarCita,
  sembrarCliente,
  sembrarPago,
  sembrarSuscripcion,
} from '../../helpers/fixtures';
import {
  barberiaEnPrueba,
  filaDePago,
  notificar,
  periodosDe,
  PLAN_BASICO,
  PLAN_PRO,
} from '../../helpers/pagos';
import { barberiaParaReservar, fechaEnDias, horaLima, nuevaClave } from '../../helpers/reservas';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T092 · US5: el administrador de la plataforma administra barberías y suscripciones (RF02; FR-034 a FR-038).
// - El listado muestra identidad, estados, plan y cobertura, y nada de negocio.
// - Suspender la barbería corta el ingreso, las sesiones abiertas y el enlace público, sin borrar nada;
//   reactivarla devuelve todo y deja la suscripción en su estado por fechas.
// - Suspender la suscripción cierra las reservas y el propietario ve el motivo; un pago aprobado mientras tanto
//   extiende el período pero no la reactiva; reactivarla la deja en su estado por fechas.
// - La activación manual crea un pago MANUAL con el precio del plan, el motivo, la referencia y su período, con
//   las reglas de un pago (anula el abierto, uno por adelantado, período objetivo).
// - tenant.status cambia solo por la plataforma, con el tenant de la ruta (H5).

const DIA = 24 * 60 * 60 * 1000;
const MOTIVO = 'Incumplimiento de los términos de uso';

describe('Administración de barberías por la plataforma (T092)', () => {
  let prueba: AppDePrueba;
  let adminId: string;
  let admin: { Authorization: string };

  beforeAll(async () => {
    prueba = await crearApp();
    adminId = uuidv7();
    admin = { Authorization: `Bearer ${(await tokenPlataformaPara(adminId)).token}` };
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const ruta = (barberiaId: string, resto: string) => `/api/v1/plataforma/barberias/${barberiaId}${resto}`;
  const suspenderBarberia = (id: string, motivo = MOTIVO) =>
    prueba.agente.put(ruta(id, '/suspension')).set(admin).send({ motivo });
  const reactivarBarberia = (id: string) => prueba.agente.delete(ruta(id, '/suspension')).set(admin);
  const suspenderSuscripcion = (id: string, motivo = MOTIVO) =>
    prueba.agente.put(ruta(id, '/suscripcion/suspension')).set(admin).send({ motivo });
  const reactivarSuscripcion = (id: string) =>
    prueba.agente.delete(ruta(id, '/suscripcion/suspension')).set(admin);
  const activar = (id: string, cuerpo: Record<string, unknown> = {}) =>
    prueba.agente
      .post(ruta(id, '/activacion-manual'))
      .set(admin)
      .send({
        planId: PLAN_BASICO,
        motivo: 'Pago por depósito en ventanilla',
        referenciaExterna: 'DEP-778812',
        ...cuerpo,
      });
  const ingresar = (correo: string, contrasena: string, barberia?: string) =>
    prueba.agente.post('/api/v1/auth/login').send({ correo, contrasena, ...(barberia ? { barberia } : {}) });

  async function suscripcion(tenantId: string) {
    const { rows } = await poolDe('seed').query(
      `SELECT id, status, plan_id, current_period_end, grace_ends_at, suspended_at, suspension_reason
         FROM subscription WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows[0];
  }

  async function estadoDeLaBarberia(tenantId: string): Promise<string> {
    const { rows } = await poolDe('seed').query('SELECT status FROM tenant WHERE id = $1', [tenantId]);
    return rows[0].status;
  }

  /** Todo lo que la barbería guarda, para comprobar que suspender no borra nada. */
  async function datosDe(tenantId: string) {
    const tablas = ['membership', 'customer_profile', 'appointment', 'service', 'barber', 'subscription'];
    return Object.fromEntries(await Promise.all(tablas.map(async (t) => [t, await filasDe(t, tenantId)])));
  }

  describe('listado', () => {
    it('muestra nombre, enlace, estados, plan y cobertura, y nada de citas, clientes ni usuarios', async () => {
      const marca = randomBytes(4).toString('hex');
      const r = await barberiaParaReservar();
      await poolDe('seed').query('UPDATE tenant SET name = $2 WHERE id = $1', [
        r.barberia.tenantId,
        `Listado ${marca}`,
      ]);
      const cliente = await sembrarCliente({
        tenantId: r.barberia.tenantId,
        nombre: 'Clienta Canario',
        correo: `canario-${marca}@prueba.pe`,
      });
      await sembrarCita({
        tenantId: r.barberia.tenantId,
        barberoId: r.barberoId,
        servicioId: r.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(Date.now() + 3 * DIA),
      });

      const respuesta = await prueba.agente
        .get(`/api/v1/plataforma/barberias?buscar=${marca}`)
        .set(admin)
        .expect(200);
      expect(erroresDeContrato003('/plataforma/barberias', 'get', 200, respuesta.body)).toEqual([]);
      expect(respuesta.body.total).toBe(1);
      const [fila] = respuesta.body.barberias;
      const s = await suscripcion(r.barberia.tenantId);
      expect(fila).toEqual({
        id: r.barberia.tenantId,
        nombre: `Listado ${marca}`,
        slug: r.barberia.slug,
        estadoBarberia: 'ACTIVA',
        estadoSuscripcion: 'TRIAL',
        plan: 'Prueba gratuita',
        finCobertura: s.current_period_end.toISOString(),
      });
      const texto = JSON.stringify(respuesta.body);
      for (const prohibido of [
        cliente.correo,
        'Clienta Canario',
        r.barberia.correo,
        'Corte',
        'Luis',
        cliente.telefono,
      ]) {
        expect(texto).not.toContain(prohibido);
      }
    });

    it('busca por nombre o por enlace sin distinguir mayúsculas, y los comodines se buscan tal cual', async () => {
      const marca = randomBytes(4).toString('hex');
      const a = await sembrarBarberia({ nombre: `Barbería Sur ${marca.toUpperCase()}` });
      const b = await sembrarBarberia({ slug: `norte-${marca}` });
      const { body } = await prueba.agente
        .get(`/api/v1/plataforma/barberias?buscar=${marca}`)
        .set(admin)
        .expect(200);
      expect(body.barberias.map((x: { id: string }) => x.id).sort()).toEqual([a.tenantId, b.tenantId].sort());
      const comodin = await prueba.agente
        .get('/api/v1/plataforma/barberias?buscar=%25%25%25')
        .set(admin)
        .expect(200);
      expect(comodin.body).toEqual({ barberias: [], total: 0 });
    });

    it('pagina de a 20 y valida la consulta', async () => {
      const { body } = await prueba.agente
        .get('/api/v1/plataforma/barberias?pagina=1')
        .set(admin)
        .expect(200);
      expect(body.barberias.length).toBeLessThanOrEqual(20);
      expect(body.total).toBeGreaterThanOrEqual(body.barberias.length);
      for (const consulta of ['pagina=0', 'pagina=501', 'pagina=uno', `buscar=${'x'.repeat(81)}`, 'otra=1']) {
        const r = await prueba.agente.get(`/api/v1/plataforma/barberias?${consulta}`).set(admin).expect(400);
        expect(r.body.codigo).toBe('VALIDACION');
      }
    });
  });

  describe('suspender y reactivar la barbería (FR-034)', () => {
    it('suspendida: nadie inicia sesión, las sesiones abiertas no sirven y el enlace no responde; no se borra nada', async () => {
      const r = await barberiaParaReservar();
      const { tenantId, slug, correo, contrasena, propietarioId } = r.barberia;
      const cliente = await sembrarCliente({ tenantId });
      const tokenAbierto = await tokenPara(tenantId, propietarioId, 'PROPIETARIO');
      await ingresar(correo, contrasena).expect(200);
      await ingresar(cliente.correo as string, cliente.contrasena as string, slug).expect(200);
      const antes = await datosDe(tenantId);

      await suspenderBarberia(tenantId).expect(204);
      expect(await estadoDeLaBarberia(tenantId)).toBe('SUSPENDIDA');

      // El personal recibe ACCESO_SUSPENDIDO (FR-013 de 001), solo con la contraseña correcta.
      const personal = await ingresar(correo, contrasena).expect(403);
      expect(personal.body.codigo).toBe('ACCESO_SUSPENDIDO');
      expect((await ingresar(correo, 'otra-clave-cualquiera').expect(401)).body.codigo).toBe(
        'CREDENCIALES_INVALIDAS',
      );
      // El cliente entra por el enlace, que ya no existe para nadie.
      const porEnlace = await ingresar(cliente.correo as string, cliente.contrasena as string, slug).expect(
        404,
      );
      expect(porEnlace.body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
      const publico = await prueba.agente.get(`/api/v1/publico/${slug}`).expect(404);
      expect(publico.body).toMatchObject({
        codigo: 'BARBERIA_NO_DISPONIBLE',
        mensaje: 'Esta barbería no está disponible.',
      });
      // La sesión que ya estaba abierta deja de servir en la solicitud siguiente.
      expect(
        (await prueba.agente.get('/api/v1/suscripcion').set(como(tokenAbierto)).expect(401)).body.codigo,
      ).toBe('NO_AUTENTICADO');

      expect(await datosDe(tenantId)).toEqual(antes);
      const auditoria = (await filasDe('audit_log', tenantId)).filter(
        (f) => f.action === 'BARBERIA_SUSPENDIDA',
      );
      expect(auditoria).toEqual([
        expect.objectContaining({
          actor_id: adminId,
          resource: `barberia:${tenantId}`,
          result: 'PERMITIDO',
          reason: MOTIVO,
        }),
      ]);

      // Suspender otra vez no hace nada más: 409 y un solo registro.
      expect((await suspenderBarberia(tenantId).expect(409)).body.codigo).toBe('BARBERIA_YA_EN_ESE_ESTADO');
    });

    it('reactivada: vuelven el ingreso, la sesión abierta y el enlace', async () => {
      const { tenantId, slug, correo, contrasena, propietarioId } = await sembrarBarberia();
      const tokenAbierto = await tokenPara(tenantId, propietarioId, 'PROPIETARIO');
      await suspenderBarberia(tenantId).expect(204);
      await reactivarBarberia(tenantId).expect(204);

      expect(await estadoDeLaBarberia(tenantId)).toBe('ACTIVA');
      await ingresar(correo, contrasena).expect(200);
      await prueba.agente.get(`/api/v1/publico/${slug}`).expect(200);
      await prueba.agente.get('/api/v1/suscripcion').set(como(tokenAbierto)).expect(200);
      const acciones = (await filasDe('audit_log', tenantId)).map((f) => [f.action, f.actor_id, f.reason]);
      expect(acciones).toEqual(
        expect.arrayContaining([
          ['BARBERIA_SUSPENDIDA', adminId, MOTIVO],
          ['BARBERIA_REACTIVADA', adminId, null],
        ]),
      );
      expect((await reactivarBarberia(tenantId).expect(409)).body.codigo).toBe('BARBERIA_YA_EN_ESE_ESTADO');
    });

    it('al reactivarla, la suscripción queda en el estado que le corresponde por sus fechas', async () => {
      // La prueba terminó mientras la barbería estaba suspendida y la tarea aún no pasó.
      const b = await sembrarBarberia({ suscripcion: false });
      const finPrueba = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await sembrarSuscripcion({ tenantId: b.tenantId, trialEndsAt: finPrueba });
      await suspenderBarberia(b.tenantId).expect(204);
      await reactivarBarberia(b.tenantId).expect(204);
      expect((await suscripcion(b.tenantId)).status).toBe('EXPIRED');
      const vencida = (await filasDe('audit_log', b.tenantId)).find(
        (f) => f.action === 'SUSCRIPCION_VENCIDA',
      );
      expect(vencida).toMatchObject({ actor_id: null, at: finPrueba });
    });

    it('una barbería que no existe responde 404, y el motivo se valida', async () => {
      const otra = randomUUID();
      expect((await suspenderBarberia(otra).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
      expect((await reactivarBarberia(otra).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
      const b = await sembrarBarberia();
      for (const cuerpo of [
        {},
        { motivo: 'abc' },
        { motivo: '    cort    ' },
        { motivo: 'x'.repeat(301) },
        { motivo: MOTIVO, estado: 'ACTIVA' },
      ]) {
        const r = await prueba.agente
          .put(ruta(b.tenantId, '/suspension'))
          .set(admin)
          .send(cuerpo)
          .expect(400);
        expect(r.body.codigo).toBe('VALIDACION');
      }
      expect(await estadoDeLaBarberia(b.tenantId)).toBe('ACTIVA');
      await prueba.agente
        .put('/api/v1/plataforma/barberias/no-es-un-id/suspension')
        .set(admin)
        .send({ motivo: MOTIVO })
        .expect(400);
    });
  });

  describe('tenant.status solo cambia por la plataforma, con el tenant de la ruta (H5)', () => {
    it('suspender una barbería no toca a otra', async () => {
      const a = await sembrarBarberia();
      const b = await sembrarBarberia();
      await suspenderBarberia(a.tenantId).expect(204);
      expect(await estadoDeLaBarberia(a.tenantId)).toBe('SUSPENDIDA');
      expect(await estadoDeLaBarberia(b.tenantId)).toBe('ACTIVA');
      expect(
        (await filasDe('audit_log', b.tenantId)).filter((f) => f.action === 'BARBERIA_SUSPENDIDA'),
      ).toEqual([]);
    });

    it('ninguna ruta del propietario cambia el estado de su barbería', async () => {
      const b = await sembrarBarberia();
      const token = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
      for (const cuerpo of [
        { estado: 'SUSPENDIDA' },
        { status: 'SUSPENDIDA' },
        { nombre: 'Nuevo Nombre', estado: 'SUSPENDIDA' },
      ]) {
        const r = await prueba.agente.patch('/api/v1/barberia').set(como(token)).send(cuerpo);
        expect(r.status).toBe(400);
      }
      // Y el token del propietario no sirve en la ruta de la plataforma.
      await prueba.agente
        .put(ruta(b.tenantId, '/suspension'))
        .set(como(token))
        .send({ motivo: MOTIVO })
        .expect(401);
      expect(await estadoDeLaBarberia(b.tenantId)).toBe('ACTIVA');
    });

    it('con el rol de la aplicación, la política tenant_edicion solo deja cambiar la barbería de la transacción', async () => {
      const a = await sembrarBarberia();
      const b = await sembrarBarberia();
      const cliente = await poolDe('app').connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [b.tenantId]);
        const r = await cliente.query(`UPDATE tenant SET status = 'SUSPENDIDA' WHERE id = $1`, [a.tenantId]);
        expect(r.rowCount).toBe(0);
        await cliente.query('ROLLBACK');
      } finally {
        cliente.release();
      }
      expect(await estadoDeLaBarberia(a.tenantId)).toBe('ACTIVA');
    });
  });

  describe('suspender y reactivar la suscripción (FR-035)', () => {
    it('suspendida con motivo: las reservas dan 403 y el propietario ve el motivo', async () => {
      const r = await barberiaParaReservar();
      const { token: tokenCliente } = await sesionCliente(r.barberia.tenantId);
      const tokenPropietario = await tokenPara(r.barberia.tenantId, r.barberia.propietarioId, 'PROPIETARIO');
      await suspenderSuscripcion(r.barberia.tenantId).expect(204);

      const reserva = await prueba.agente
        .post('/api/v1/citas')
        .set({ ...como(tokenCliente), 'Idempotency-Key': nuevaClave() })
        .send({ servicioId: r.servicioId, barberoId: r.barberoId, inicio: horaLima(fechaEnDias(3), '10:00') })
        .expect(403);
      expect(reserva.body).toMatchObject({
        codigo: 'SUSCRIPCION_NO_PERMITE',
        mensaje: 'Esta barbería no acepta reservas por ahora',
      });
      const { body } = await prueba.agente.get('/api/v1/suscripcion').set(como(tokenPropietario)).expect(200);
      expect(body).toMatchObject({
        estado: 'SUSPENDED',
        motivoSuspension: MOTIVO,
        avisos: expect.arrayContaining(['SUSPENDIDA']),
      });

      const s = await suscripcion(r.barberia.tenantId);
      expect(s).toMatchObject({ status: 'SUSPENDED', suspension_reason: MOTIVO, grace_ends_at: null });
      const auditoria = (await filasDe('audit_log', r.barberia.tenantId)).filter(
        (f) => f.action === 'SUSCRIPCION_SUSPENDIDA',
      );
      expect(auditoria).toEqual([
        expect.objectContaining({ actor_id: adminId, resource: `suscripcion:${s.id}`, reason: MOTIVO }),
      ]);
      // La barbería sigue activa: solo la suscripción está suspendida.
      expect(await estadoDeLaBarberia(r.barberia.tenantId)).toBe('ACTIVA');
      const otraVez = await suspenderSuscripcion(r.barberia.tenantId).expect(409);
      expect(otraVez.body.codigo).toBe('TRANSICION_DE_SUSCRIPCION_INVALIDA');
    });

    it('un pago aprobado durante la suspensión crea su período, pero la suscripción sigue suspendida', async () => {
      const b = await barberiaEnPrueba();
      const pago = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        cubreDesde: b.finPrueba,
      });
      await suspenderSuscripcion(b.tenantId).expect(204);
      await notificar(prueba, { referencia: pago.referencia }).expect(200);

      expect((await filaDePago(pago.pagoId)).status).toBe('APROBADO');
      expect(await periodosDe(b.suscripcionId)).toEqual([
        { starts_at: b.finPrueba, ends_at: sumarUnMes(b.finPrueba), payment_id: pago.pagoId },
      ]);
      const s = await suscripcion(b.tenantId);
      expect(s).toMatchObject({ status: 'SUSPENDED', suspension_reason: MOTIVO });
      expect(s.current_period_end).toEqual(sumarUnMes(b.finPrueba));

      // Al reactivarla sigue en prueba (el período pagado empieza al terminar la prueba): sin días devueltos.
      await reactivarSuscripcion(b.tenantId).expect(204);
      expect(await suscripcion(b.tenantId)).toMatchObject({
        status: 'TRIAL',
        suspended_at: null,
        suspension_reason: null,
      });
    });

    /** Suscripción con la prueba terminada en `finPrueba` y un período pagado [inicio, inicio + 1 mes), si hay. */
    async function conFechas(finPrueba: Date, periodoDesde: Date | null) {
      const b = await barberiaEnPrueba();
      let finCobertura = finPrueba;
      if (periodoDesde) {
        const { pagoId } = await sembrarPago({
          tenantId: b.tenantId,
          suscripcionId: b.suscripcionId,
          metodo: 'TRANSFERENCIA',
          estado: 'APROBADO',
          cubreDesde: periodoDesde,
        });
        finCobertura = sumarUnMes(periodoDesde);
        await poolDe('seed').query(
          `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuidv7(), b.tenantId, b.suscripcionId, pagoId, PLAN_BASICO, periodoDesde, finCobertura],
        );
      }
      await poolDe('seed').query(
        'UPDATE subscription SET trial_ends_at = $2, current_period_end = $3 WHERE id = $1',
        [b.suscripcionId, finPrueba, finCobertura],
      );
      return b;
    }

    it.each([
      ['TRIAL', () => new Date(Date.now() + 5 * DIA), null, null],
      ['EXPIRED (la prueba venció mientras estaba suspendida)', () => new Date(Date.now() - DIA), null, null],
      ['ACTIVE', () => new Date(Date.now() - 10 * DIA), () => new Date(Date.now() - 10 * DIA), PLAN_BASICO],
      ['PAST_DUE', () => new Date(Date.now() - 32 * DIA), () => new Date(Date.now() - 32 * DIA), null],
      [
        'EXPIRED (venció también la gracia)',
        () => new Date(Date.now() - 45 * DIA),
        () => new Date(Date.now() - 45 * DIA),
        null,
      ],
    ] as const)('al reactivarla queda en %s', async (caso, finPrueba, desde, plan) => {
      const b = await conFechas(finPrueba(), desde ? desde() : null);
      await suspenderSuscripcion(b.tenantId).expect(204);
      await reactivarSuscripcion(b.tenantId).expect(204);
      const s = await suscripcion(b.tenantId);
      expect(s.status).toBe(caso.split(' ')[0]);
      expect(s).toMatchObject({ suspended_at: null, suspension_reason: null });
      expect(s.grace_ends_at === null).toBe(s.status !== 'PAST_DUE');
      if (plan) expect(s.plan_id).toBe(plan);
      const auditoria = (await filasDe('audit_log', b.tenantId)).filter(
        (f) => f.action === 'SUSCRIPCION_REACTIVADA',
      );
      expect(auditoria).toEqual([expect.objectContaining({ actor_id: adminId, reason: null })]);
      expect((await reactivarSuscripcion(b.tenantId).expect(409)).body.codigo).toBe(
        'TRANSICION_DE_SUSCRIPCION_INVALIDA',
      );
    });

    it('una barbería sin suscripción o inexistente responde 404', async () => {
      const sin = await sembrarBarberia({ suscripcion: false });
      for (const id of [sin.tenantId, randomUUID()]) {
        expect((await suspenderSuscripcion(id).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
        expect((await reactivarSuscripcion(id).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
      }
    });
  });

  describe('activación manual (FR-036)', () => {
    it('crea un pago MANUAL con el precio del plan, el motivo, la referencia y su período; anula el pago abierto', async () => {
      const b = await barberiaEnPrueba();
      const abierto = await sembrarPago({ tenantId: b.tenantId, suscripcionId: b.suscripcionId });

      const { body } = await activar(b.tenantId, { planId: PLAN_PRO }).expect(201);
      expect(
        erroresDeContrato003('/plataforma/barberias/{barberiaId}/activacion-manual', 'post', 201, body),
      ).toEqual([]);
      expect(body).toMatchObject({
        medio: 'MANUAL',
        estado: 'APROBADO',
        importeCentimos: 8900,
        plan: { id: PLAN_PRO, nombre: 'Pro' },
        motivoActivacion: 'Pago por depósito en ventanilla',
        marca: null,
        periodo: { iniciaEn: b.finPrueba.toISOString(), terminaEn: sumarUnMes(b.finPrueba).toISOString() },
      });
      expect(await filaDePago(body.id)).toMatchObject({
        method: 'MANUAL',
        status: 'APROBADO',
        amount_cents: 8900,
        manual_reason: 'Pago por depósito en ventanilla',
        manual_external_ref: 'DEP-778812',
        created_by: adminId,
        covers_after: b.finPrueba,
        approved_at: expect.any(Date),
        closed_at: expect.any(Date),
      });
      expect((await filaDePago(abierto.pagoId)).status).toBe('ANULADO');
      expect(await periodosDe(b.suscripcionId)).toEqual([
        { starts_at: b.finPrueba, ends_at: sumarUnMes(b.finPrueba), payment_id: body.id },
      ]);

      // El propietario lo ve en su historial como activación manual, con el motivo y sin la referencia externa.
      const historial = await prueba.agente.get('/api/v1/suscripcion/pagos').set(como(b.token)).expect(200);
      expect(historial.body.pagos[0]).toMatchObject({
        id: body.id,
        medio: 'MANUAL',
        motivoActivacion: 'Pago por depósito en ventanilla',
      });
      expect(JSON.stringify(historial.body)).not.toContain('DEP-778812');
    });

    it('respeta el tope de un período por adelantado: la segunda activación da 409 y no crea nada', async () => {
      const b = await barberiaEnPrueba();
      await activar(b.tenantId).expect(201);
      const segunda = await activar(b.tenantId).expect(409);
      expect(segunda.body.codigo).toBe('PAGO_ADELANTADO_NO_PERMITIDO');
      expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
      const { rows } = await poolDe('seed').query(
        `SELECT count(*)::int AS n FROM payment WHERE tenant_id = $1`,
        [b.tenantId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('dos activaciones simultáneas dejan un solo pago y un solo período', async () => {
      const b = await barberiaEnPrueba();
      const respuestas = await Promise.all([activar(b.tenantId), activar(b.tenantId)]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    });

    it('una barbería vencida queda activa de inmediato, con el período desde ahora', async () => {
      const b = await barberiaEnPrueba();
      const finPrueba = new Date(Date.now() - 3 * DIA);
      await poolDe('seed').query(
        `UPDATE subscription SET status = 'EXPIRED', trial_ends_at = $2, current_period_end = $2 WHERE id = $1`,
        [b.suscripcionId, finPrueba],
      );
      const antes = Date.now();
      const { body } = await activar(b.tenantId).expect(201);
      const inicio = new Date(body.periodo.iniciaEn).getTime();
      expect(inicio).toBeGreaterThanOrEqual(antes - 1000);
      expect(inicio).toBeLessThanOrEqual(Date.now());
      expect(await suscripcion(b.tenantId)).toMatchObject({ status: 'ACTIVE', plan_id: PLAN_BASICO });
      const estado = await prueba.agente
        .get('/api/v1/suscripcion/estado-operativo')
        .set(como(b.token))
        .expect(200);
      expect(estado.body.aceptaReservas).toBe(true);
    });

    it('con la suscripción suspendida crea el período pero no la reactiva', async () => {
      const b = await barberiaEnPrueba();
      await suspenderSuscripcion(b.tenantId).expect(204);
      await activar(b.tenantId).expect(201);
      expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
      expect((await suscripcion(b.tenantId)).status).toBe('SUSPENDED');
    });

    it('con un comprobante en revisión responde 409 y no anula nada (primero se revisa)', async () => {
      const b = await barberiaEnPrueba();
      const enRevision = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        metodo: 'TRANSFERENCIA',
        estado: 'EN_REVISION',
      });
      expect((await activar(b.tenantId).expect(409)).body.codigo).toBe('COMPROBANTE_YA_EN_REVISION');
      expect((await filaDePago(enRevision.pagoId)).status).toBe('EN_REVISION');
      expect(await periodosDe(b.suscripcionId)).toEqual([]);
    });

    it('solo planes contratables, con motivo y referencia válidos, y en una barbería que existe', async () => {
      const b = await barberiaEnPrueba();
      const { rows } = await poolDe('seed').query(`SELECT id FROM plan WHERE code = 'TRIAL'`);
      expect((await activar(b.tenantId, { planId: rows[0].id }).expect(422)).body.codigo).toBe(
        'PLAN_NO_CONTRATABLE',
      );
      expect((await activar(b.tenantId, { planId: randomUUID() }).expect(422)).body.codigo).toBe(
        'PLAN_NO_CONTRATABLE',
      );
      for (const cuerpo of [
        { motivo: 'abc' },
        { motivo: 'x'.repeat(301) },
        { referenciaExterna: 'ab' },
        { referenciaExterna: 'x'.repeat(81) },
        { planId: 'no-es-un-id' },
        { importeCentimos: 1 },
      ]) {
        expect((await activar(b.tenantId, cuerpo).expect(400)).body.codigo).toBe('VALIDACION');
      }
      expect((await activar(randomUUID()).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
      expect(await periodosDe(b.suscripcionId)).toEqual([]);
    });

    it('los planes que el administrador puede activar son los contratables', async () => {
      const { body } = await prueba.agente.get('/api/v1/plataforma/planes').set(admin).expect(200);
      expect(erroresDeContrato003('/plataforma/planes', 'get', 200, body)).toEqual([]);
      expect(
        body.map((p: { codigo: string; precioCentimos: number }) => [p.codigo, p.precioCentimos]),
      ).toEqual([
        ['BASICO', 4900],
        ['PRO', 8900],
      ]);
    });
  });
});
