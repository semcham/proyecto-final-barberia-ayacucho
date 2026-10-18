import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarCita, sembrarCliente, sembrarUsuario } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T119 · Historial del cliente (RF17; R16): solo sus citas de la barbería de la sesión, por inicio
// descendente, con paginación simple.

type Estado = 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO' | 'CANCELADA';

describe('Historial del cliente (GET /clientes/yo/citas)', () => {
  let prueba: AppDePrueba;
  let a: BarberiaParaReservar;
  let b: BarberiaParaReservar;
  let cliente: Awaited<ReturnType<typeof sesionCliente>>;
  const ids: Record<string, string> = {};

  const historial = (token: string, consulta = '') =>
    prueba.agente.get(`/api/v1/clientes/yo/citas${consulta}`).set({ Authorization: `Bearer ${token}` });
  const cita = (e: BarberiaParaReservar, clienteId: string, dias: number, estado: Estado) =>
    sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId,
      inicio: new Date(horaLima(fechaEnDias(dias), '10:00')),
      estado,
    });

  beforeAll(async () => {
    prueba = await crearApp();
    a = await barberiaParaReservar();
    b = await barberiaParaReservar();
    cliente = await sesionCliente(a.barberia.tenantId);
    const propio = cliente.cliente.clienteId;
    ids.completada = await cita(a, propio, -5, 'COMPLETADA');
    ids.noAsistio = await cita(a, propio, -3, 'NO_ASISTIO');
    ids.proxima = await cita(a, propio, 2, 'CONFIRMADA');
    ids.cancelada = await cita(a, propio, 4, 'CANCELADA');
    // Otro cliente de la misma barbería y la misma cuenta en otra barbería: nada de esto es visible.
    const otro = await sembrarCliente({ tenantId: a.barberia.tenantId });
    ids.deOtro = await cita(a, otro.clienteId, 6, 'CONFIRMADA');
    const enB = await sembrarCliente({
      tenantId: b.barberia.tenantId,
      usuarioId: cliente.cliente.usuarioId as string,
    });
    ids.enB = await cita(b, enB.clienteId, 1, 'CONFIRMADA');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('devuelve solo las citas propias de la barbería de la sesión, por inicio descendente, con su estado', async () => {
    const { body } = await historial(cliente.token).expect(200);
    expect(body).toMatchObject({ total: 4, pagina: 1, tamano: 20 });
    expect(body.elementos.map((c: { id: string }) => c.id)).toEqual([
      ids.cancelada,
      ids.proxima,
      ids.noAsistio,
      ids.completada,
    ]);
    expect(body.elementos.map((c: { estado: string }) => c.estado)).toEqual([
      'CANCELADA',
      'CONFIRMADA',
      'NO_ASISTIO',
      'COMPLETADA',
    ]);
    expect(body.elementos[1]).toMatchObject({
      barberia: expect.any(String),
      barbero: 'Luis',
      servicio: 'Servicio sembrado',
      inicio: horaLima(fechaEnDias(2), '10:00'),
      precio: '20.00',
    });
    const texto = JSON.stringify(body);
    expect(texto).not.toContain(ids.deOtro);
    expect(texto).not.toContain(ids.enB);
  });

  it('paginación simple: pagina y tamano, con el total de todas las páginas', async () => {
    const primera = await historial(cliente.token, '?pagina=1&tamano=3').expect(200);
    expect(primera.body).toMatchObject({ total: 4, pagina: 1, tamano: 3 });
    expect(primera.body.elementos).toHaveLength(3);
    const segunda = await historial(cliente.token, '?pagina=2&tamano=3').expect(200);
    expect(segunda.body.elementos.map((c: { id: string }) => c.id)).toEqual([ids.completada]);
    expect((await historial(cliente.token, '?pagina=3&tamano=3').expect(200)).body.elementos).toEqual([]);
  });

  it('parámetros fuera de rango o desconocidos → 400', async () => {
    for (const consulta of [
      '?pagina=0',
      '?tamano=51',
      '?tamano=0',
      '?pagina=x',
      `?barberia=${b.barberia.slug}`,
    ]) {
      await historial(cliente.token, consulta).expect(400);
    }
  });

  it('un cliente sin citas recibe la lista vacía', async () => {
    const nuevo = await sesionCliente(a.barberia.tenantId);
    expect((await historial(nuevo.token).expect(200)).body).toEqual({
      total: 0,
      pagina: 1,
      tamano: 20,
      elementos: [],
    });
  });

  it('con el token de B, la misma cuenta ve solo su cita de B (PR09)', async () => {
    const tokenB = await tokenPara(b.barberia.tenantId, cliente.cliente.usuarioId as string, 'CLIENTE');
    const { body } = await historial(tokenB).expect(200);
    expect(body.elementos.map((c: { id: string }) => c.id)).toEqual([ids.enB]);
  });

  it('el propietario y el barbero no tienen historial de cliente → 403; sin sesión → 401', async () => {
    const propietario = await tokenPara(a.barberia.tenantId, a.barberia.propietarioId, 'PROPIETARIO');
    await historial(propietario).expect(403);
    const barbero = await sembrarUsuario({ tenantId: a.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    await historial(await tokenPara(a.barberia.tenantId, barbero.usuarioId, 'BARBERO')).expect(403);
    await prueba.agente.get('/api/v1/clientes/yo/citas').expect(401);
  });
});
