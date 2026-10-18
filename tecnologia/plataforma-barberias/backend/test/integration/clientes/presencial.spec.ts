import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCliente, sembrarUsuario } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T100 · Cliente presencial (FR-035, R14) y cita presencial registrada por el propietario (HU15).

describe('Cliente presencial y cita presencial', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let token: string;

  const como = (t = token) => ({ Authorization: `Bearer ${t}` });
  const registrar = (cuerpo: object, t = token) =>
    prueba.agente.post('/api/v1/clientes').set(como(t)).send(cuerpo);
  const buscar = (texto: string, t = token) =>
    prueba.agente.get(`/api/v1/clientes?buscar=${encodeURIComponent(texto)}`).set(como(t));
  const presencial = (cambios: object = {}) => ({
    nombre: 'Julia Ccorahua',
    telefono: '966 555 444',
    consentimientoVerbal: true,
    versionPoliticaDatos: '2026-10',
    ...cambios,
  });

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('sin consentimiento verbal → 400 y no se crea nada', async () => {
    const antes = (await filasDe('customer_profile', e.barberia.tenantId)).length;
    await registrar(presencial({ consentimientoVerbal: false })).expect(400);
    const sinCampo: Record<string, unknown> = presencial();
    delete sinCampo.consentimientoVerbal;
    await registrar(sinCampo).expect(400);
    await registrar(presencial({ versionPoliticaDatos: '2020-01' })).expect(400);
    expect(await filasDe('customer_profile', e.barberia.tenantId)).toHaveLength(antes);
  });

  it('con consentimiento crea el perfil PRESENCIAL y su consentimiento anotado por el propietario, y lo audita', async () => {
    const { body } = await registrar(presencial({ correo: 'Julia@Prueba.pe' })).expect(201);
    expect(body).toEqual({
      id: expect.any(String),
      nombre: 'Julia Ccorahua',
      telefono: '966 555 444',
      origen: 'PRESENCIAL',
    });

    const perfil = await poolDe('seed').query(
      'SELECT user_id, email, origin, created_by FROM customer_profile WHERE id = $1',
      [body.id],
    );
    expect(perfil.rows[0]).toEqual({
      user_id: null,
      email: 'julia@prueba.pe',
      origin: 'PRESENCIAL',
      created_by: e.barberia.propietarioId,
    });
    const consentimiento = await poolDe('seed').query(
      'SELECT method, recorded_by, text_version FROM consent_record WHERE customer_id = $1',
      [body.id],
    );
    expect(consentimiento.rows).toEqual([
      { method: 'PRESENCIAL', recorded_by: e.barberia.propietarioId, text_version: '2026-10' },
    ]);
    const auditoria = (await filasDe('audit_log', e.barberia.tenantId)).filter(
      (f) => f.action === 'CLIENTE_PRESENCIAL_REGISTRADO',
    );
    expect(auditoria).toEqual([expect.objectContaining({ resource: `cliente:${body.id}` })]);
  });

  it('GET /clientes?buscar= encuentra por nombre (sin distinguir mayúsculas) o por teléfono, solo en la barbería', async () => {
    await sembrarCliente({ tenantId: e.barberia.tenantId, nombre: 'Rocío Huamaní', telefono: '977 123 456' });
    const otra = await barberiaParaReservar();
    await sembrarCliente({
      tenantId: otra.barberia.tenantId,
      nombre: 'Rocío de Otra Barbería',
      telefono: '977 999 999',
    });

    const porNombre = await buscar('rocío').expect(200);
    expect(porNombre.body).toEqual([
      { id: expect.any(String), nombre: 'Rocío Huamaní', telefono: '977 123 456', origen: 'EN_LINEA' },
    ]);
    const porTelefono = await buscar('977123').expect(200);
    expect(porTelefono.body.map((c: { nombre: string }) => c.nombre)).toEqual(['Rocío Huamaní']);
    expect((await buscar('999999').expect(200)).body).toEqual([]);
    await buscar('r').expect(400);
  });

  it('devuelve como máximo 20 resultados', async () => {
    for (let i = 0; i < 22; i += 1) {
      await sembrarCliente({ tenantId: e.barberia.tenantId, conCuenta: false, nombre: `Cliente Lote ${i}` });
    }
    expect((await buscar('lote').expect(200)).body).toHaveLength(20);
  });

  it('el barbero no busca ni registra clientes', async () => {
    const barbero = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const t = await tokenPara(e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    await buscar('julia', t).expect(403);
    await registrar(presencial(), t).expect(403);
  });

  it('la cita del propietario con clienteId aplica las mismas reglas y queda PRESENCIAL; un cliente de otra barbería → 404', async () => {
    const cliente = (
      await registrar(presencial({ nombre: 'Mario Quispe', telefono: '955 000 111' })).expect(201)
    ).body;
    const fecha = fechaEnDias(3);
    const reservar = (cuerpo: object) =>
      prueba.agente
        .post('/api/v1/citas')
        .set({ ...como(), 'Idempotency-Key': nuevaClave() })
        .send(cuerpo);

    const { body } = await reservar({
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fecha, '10:00'),
      clienteId: cliente.id,
    }).expect(201);
    expect(body.origen).toBe('PRESENCIAL');
    const fila = await poolDe('seed').query('SELECT origin, customer_id FROM appointment WHERE id = $1', [
      body.id,
    ]);
    expect(fila.rows[0]).toEqual({ origin: 'PRESENCIAL', customer_id: cliente.id });

    // Mismas reglas: hora pasada y fuera de disponibilidad.
    await reservar({
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fechaEnDias(-1), '10:00'),
      clienteId: cliente.id,
    }).expect(422);
    await reservar({
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fecha, '07:00'),
      clienteId: cliente.id,
    }).expect(422);
    // Sin clienteId → 400; un cliente de otra barbería → 404.
    await reservar({
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fecha, '11:00'),
    }).expect(400);
    const otra = await barberiaParaReservar();
    const deOtra = await sembrarCliente({ tenantId: otra.barberia.tenantId, conCuenta: false });
    const ajeno = await reservar({
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fecha, '11:00'),
      clienteId: deOtra.clienteId,
    }).expect(404);
    expect(ajeno.body.codigo).toBe('NO_ENCONTRADO');
  });
});
