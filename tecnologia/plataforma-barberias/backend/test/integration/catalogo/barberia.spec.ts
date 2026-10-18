import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita, sembrarCliente, sembrarUsuario } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T043 · Datos, enlace, antelación y horario de atención de la barbería (RF03; FR-001 a FR-005; R11, R15).

const todosLosDias = (inicio: string, fin: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio, fin }));

describe('Barbería: datos, enlace y horario de atención', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let token: string;

  const como = (t = token) => ({ Authorization: `Bearer ${t}` });
  const patch = (cuerpo: object, t = token) =>
    prueba.agente.patch('/api/v1/barberia').set(como(t)).send(cuerpo);
  const putHorario = (cuerpo: object) =>
    prueba.agente.put('/api/v1/barberia/horario').set(como()).send(cuerpo);
  const auditadas = async (accion: string) =>
    (await filasDe('audit_log', e.barberia.tenantId)).filter((f) => f.action === accion);

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET /barberia devuelve los datos, el enlace, la zona y la antelación por defecto (120 min)', async () => {
    const { body } = await prueba.agente.get('/api/v1/barberia').set(como()).expect(200);
    expect(body).toEqual({
      nombre: expect.any(String),
      slug: e.barberia.slug,
      direccion: null,
      telefono: null,
      descripcion: null,
      zonaHoraria: 'America/Lima',
      antelacionCancelacionMinutos: 120,
    });
  });

  it('PATCH /barberia guarda los datos comerciales y la antelación; el barbero no puede editar', async () => {
    const { body } = await patch({
      nombre: '  Barbería Huamanga Centro ',
      direccion: 'Jr. Asamblea 120',
      telefono: '966 123 456',
      descripcion: 'Cortes clásicos.',
      antelacionCancelacionMinutos: 60,
    }).expect(200);
    expect(body).toMatchObject({
      nombre: 'Barbería Huamanga Centro',
      direccion: 'Jr. Asamblea 120',
      telefono: '966 123 456',
      antelacionCancelacionMinutos: 60,
    });
    // Vaciar un dato opcional.
    expect((await patch({ descripcion: null }).expect(200)).body.descripcion).toBeNull();

    const barbero = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const tokenBarbero = await tokenPara(e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    await prueba.agente.get('/api/v1/barberia').set(como(tokenBarbero)).expect(200);
    await patch({ nombre: 'Otra' }, tokenBarbero).expect(403);
  });

  it.each([[-1], [4321], [1.5]])('una antelación de %p minutos → 400', async (minutos) => {
    await patch({ antelacionCancelacionMinutos: minutos }).expect(400);
  });

  it('un cuerpo vacío o con campos desconocidos → 400', async () => {
    await patch({}).expect(400);
    await patch({ estado: 'SUSPENDIDA' }).expect(400);
  });

  describe('enlace (slug)', () => {
    it('cambiarlo deja el anterior sin funcionar, el nuevo funciona y se audita ENLACE_CAMBIADO', async () => {
      const anterior = (await prueba.agente.get('/api/v1/barberia').set(como())).body.slug;
      const nuevo = `huamanga-${Date.now().toString(36)}`;
      expect((await patch({ slug: nuevo }).expect(200)).body.slug).toBe(nuevo);

      const viejo = await prueba.agente.get(`/api/v1/publico/${anterior}`).expect(404);
      expect(viejo.body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
      await prueba.agente.get(`/api/v1/publico/${nuevo}`).expect(200);
      expect(await auditadas('ENLACE_CAMBIADO')).toHaveLength(1);

      // Guardar el mismo enlace no es un cambio.
      await patch({ slug: nuevo }).expect(200);
      expect(await auditadas('ENLACE_CAMBIADO')).toHaveLength(1);
    });

    it('un enlace ocupado por otra barbería o una palabra reservada → 409 ENLACE_NO_DISPONIBLE', async () => {
      const otra = await barberiaParaReservar();
      for (const slug of [otra.barberia.slug, 'admin', 'publico']) {
        const { body } = await patch({ slug }).expect(409);
        expect(body.codigo).toBe('ENLACE_NO_DISPONIBLE');
      }
    });

    it('un enlace con formato inválido → 400', async () => {
      for (const slug of ['ab', 'Mayusculas', 'con espacio', '-guion']) await patch({ slug }).expect(400);
    });
  });

  describe('horario de atención', () => {
    it('PUT reemplaza la semana completa y GET la devuelve ordenada', async () => {
      const tramos = [
        { diaSemana: 6, inicio: '09:00', fin: '13:00' },
        { diaSemana: 1, inicio: '15:00', fin: '19:00' },
        { diaSemana: 1, inicio: '09:00', fin: '13:00' },
      ];
      await putHorario({ tramos }).expect(200);
      const { body } = await prueba.agente.get('/api/v1/barberia/horario').set(como()).expect(200);
      expect(body.tramos).toEqual([
        { diaSemana: 1, inicio: '09:00', fin: '13:00' },
        { diaSemana: 1, inicio: '15:00', fin: '19:00' },
        { diaSemana: 6, inicio: '09:00', fin: '13:00' },
      ]);
      await putHorario({ tramos: todosLosDias('09:00', '19:00') }).expect(200);
    });

    it('cierre ≤ apertura o tramos solapados → 400 indicando el día', async () => {
      const cierre = await putHorario({ tramos: [{ diaSemana: 3, inicio: '13:00', fin: '09:00' }] }).expect(
        400,
      );
      expect(cierre.body.detalles).toEqual([expect.objectContaining({ diaSemana: 3 })]);
      const solape = await putHorario({
        tramos: [
          { diaSemana: 4, inicio: '09:00', fin: '13:00' },
          { diaSemana: 4, inicio: '12:00', fin: '15:00' },
        ],
      }).expect(400);
      expect(solape.body.detalles).toEqual([expect.objectContaining({ diaSemana: 4, problema: 'solape' })]);
    });

    it('reducirlo con citas activas fuera → 409 sin guardar; con confirmarConflictos guarda y las citas siguen CONFIRMADA', async () => {
      const fecha = fechaEnDias(3);
      const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(horaLima(fecha, '18:00')),
      });
      const reducido = { tramos: todosLosDias('09:00', '13:00') };

      const conflicto = await putHorario(reducido).expect(409);
      expect(conflicto.body.codigo).toBe('CONFLICTO_CON_CITAS');
      expect(conflicto.body.detalles).toEqual([
        {
          id: citaId,
          inicio: horaLima(fecha, '18:00'),
          barberoId: e.barberoId,
          servicio: 'Servicio sembrado',
        },
      ]);
      const sinCambios = await prueba.agente.get('/api/v1/barberia/horario').set(como()).expect(200);
      expect(sinCambios.body.tramos[0]).toEqual({ diaSemana: 0, inicio: '09:00', fin: '19:00' });

      await putHorario({ ...reducido, confirmarConflictos: true }).expect(200);
      const { rows } = await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [citaId]);
      expect(rows[0].status).toBe('CONFIRMADA');
      expect(await auditadas('CAMBIO_CON_CONFLICTO')).toHaveLength(1);
      await putHorario({ tramos: todosLosDias('09:00', '19:00') }).expect(200);
    });
  });
});
