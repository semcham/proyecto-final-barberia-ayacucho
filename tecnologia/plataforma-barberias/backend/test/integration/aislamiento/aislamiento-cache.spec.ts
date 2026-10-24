import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBloqueo, sembrarCita, sembrarCliente, sembrarUsuario } from '../../helpers/fixtures';
import { iniciarRedis, type RedisDePrueba } from '../../helpers/redis';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T032 · PR09 de la caché compartida (006; FR-022, SC-004; ADR-029): dos barberías con servicios y
// barberos de nombres iguales y datos canario. Toda clave lleva el tenant de los datos que guarda, ninguna
// el enlace, ningún valor un dato privado, y un enlace reutilizado por otra barbería nunca sirve datos ajenos.

const PATRON_CLAVE = /^bp:v1:t:([0-9a-f-]{36}):/;

interface CatalogoRespuesta {
  servicios: { id: string }[];
  barberos: { id: string; servicioIds: string[] }[];
}

describe('PR09 · Aislamiento de la caché compartida (dos instancias)', () => {
  let redis: RedisDePrueba;
  let uno: AppDePrueba;
  let dos: AppDePrueba;
  let a: BarberiaParaReservar;
  let b: BarberiaParaReservar;
  const fecha = fechaEnDias(3);
  const sufijo = Date.now().toString(36);
  const canarios = {
    correoClienteA: `canario-cache-a-${sufijo}@prueba.pe`,
    correoClienteB: `canario-cache-b-${sufijo}@prueba.pe`,
    telefonoClienteA: `93${String(Date.now()).slice(-7)}`,
    telefonoClienteB: `94${String(Date.now()).slice(-7)}`,
    nombreClienteA: `Canario Cache Cliente A ${sufijo}`,
    nombreClienteB: `Canario Cache Cliente B ${sufijo}`,
    correoPersonalA: `canario-cache-personal-a-${sufijo}@prueba.pe`,
    nombrePersonalB: `Canario Cache Personal B ${sufijo}`,
    motivoBloqueoA: `canario cache motivo A ${sufijo}`,
    motivoBloqueoB: `canario cache motivo B ${sufijo}`,
  };

  const ids = (catalogo: CatalogoRespuesta) => [
    ...catalogo.servicios.map((s) => s.id),
    ...catalogo.barberos.map((barbero) => barbero.id),
  ];
  const idsDe = (e: BarberiaParaReservar) => [e.servicioId, e.barberoId, e.otroBarberoId];

  /** Visita el catálogo y los horarios de ambas barberías por ambas instancias. */
  async function visitarTodo(): Promise<void> {
    for (const app of [uno, dos]) {
      for (const e of [a, b]) {
        await app.agente.get(`/api/v1/publico/${e.barberia.slug}`).expect(200);
        await app.agente
          .get(`/api/v1/publico/${e.barberia.slug}/horarios?servicio=${e.servicioId}&fecha=${fecha}`)
          .expect(200);
      }
    }
  }

  beforeAll(async () => {
    redis = await iniciarRedis();
    uno = await crearApp({ entorno: { INSTANCIA_ID: 'backend-1' } });
    dos = await crearApp({ entorno: { INSTANCIA_ID: 'backend-2' } });
    // Mismos nombres en ambas: servicio "Corte", barberos "Luis" y "Ana".
    a = await barberiaParaReservar();
    b = await barberiaParaReservar();

    const clienteA = await sembrarCliente({
      tenantId: a.barberia.tenantId,
      correo: canarios.correoClienteA,
      telefono: canarios.telefonoClienteA,
      nombre: canarios.nombreClienteA,
    });
    const clienteB = await sembrarCliente({
      tenantId: b.barberia.tenantId,
      correo: canarios.correoClienteB,
      telefono: canarios.telefonoClienteB,
      nombre: canarios.nombreClienteB,
    });
    await sembrarUsuario({
      tenantId: a.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'ACTIVA',
      correo: canarios.correoPersonalA,
    });
    await sembrarUsuario({
      tenantId: b.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'ACTIVA',
      nombre: canarios.nombrePersonalB,
    });
    for (const [e, cliente, motivo] of [
      [a, clienteA, canarios.motivoBloqueoA],
      [b, clienteB, canarios.motivoBloqueoB],
    ] as const) {
      await sembrarBloqueo({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        inicio: new Date(horaLima(fecha, '09:00')),
        fin: new Date(horaLima(fecha, '10:00')),
        motivo,
      });
      await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(horaLima(fecha, '11:00')),
      });
    }
  });

  afterAll(async () => {
    await uno.cerrar();
    await dos.cerrar();
    await redis.cerrar();
    await cerrarPools();
  });

  it('cada clave lleva el tenant de los datos que guarda, ninguna lleva un enlace y ningún valor un dato canario', async () => {
    await redis.vaciar();
    await visitarTodo();

    const claves = await redis.claves('bp:v1:*');
    expect(claves.sort()).toEqual(
      [a, b].flatMap((e) => [`bp:v1:t:${e.barberia.tenantId}:catalogo-publico`]).sort(),
    );
    for (const clave of claves) {
      const tenant = PATRON_CLAVE.exec(clave)?.[1];
      expect(tenant).toBeDefined();
      for (const e of [a, b]) expect(clave).not.toContain(e.barberia.slug);

      // El contenido coincide con la base: todos sus servicios y barberos son del tenant de la clave.
      const sobre = JSON.parse((await redis.cliente().get(clave)) as string) as { d: CatalogoRespuesta };
      const { rows } = await poolDe('seed').query<{ tenant_id: string }>(
        `SELECT tenant_id FROM service WHERE id = ANY($1::uuid[])
         UNION ALL SELECT tenant_id FROM barber WHERE id = ANY($1::uuid[])`,
        [ids(sobre.d)],
      );
      expect(rows.length).toBe(ids(sobre.d).length);
      expect(new Set(rows.map((f) => f.tenant_id))).toEqual(new Set([tenant]));
    }

    const valores = (await redis.valores()).join('\n');
    for (const canario of Object.values(canarios)) expect(valores).not.toContain(canario);
    expect(valores).not.toMatch(/@prueba\.pe/);
    for (const e of [a, b]) expect(valores).not.toContain(e.barberia.slug);
  });

  it('/publico/{slug-A} nunca devuelve ids de servicios ni barberos de B, por ninguna instancia', async () => {
    for (const app of [uno, dos]) {
      for (const [propia, ajena] of [
        [a, b],
        [b, a],
      ] as const) {
        const { body } = await app.agente.get(`/api/v1/publico/${propia.barberia.slug}`).expect(200);
        expect(new Set(ids(body))).toEqual(new Set(idsDe(propia)));
        for (const id of idsDe(ajena)) expect(ids(body)).not.toContain(id);
      }
    }
  });

  it('enlace reutilizado: A pasa de x a y, B toma x; /publico/x muestra B y /publico/y muestra A, por ambas instancias', async () => {
    const x = `reutilizado-${sufijo}`;
    const y = `nuevo-${sufijo}`;
    const tokenA = await tokenPara(a.barberia.tenantId, a.barberia.propietarioId, 'PROPIETARIO');
    const tokenB = await tokenPara(b.barberia.tenantId, b.barberia.propietarioId, 'PROPIETARIO');
    await uno.agente
      .patch('/api/v1/barberia')
      .set({ Authorization: `Bearer ${tokenA}` })
      .send({ slug: x })
      .expect(200);
    // Ambas instancias guardan el catálogo de A mientras A usa x.
    for (const app of [uno, dos]) {
      const { body } = await app.agente.get(`/api/v1/publico/${x}`).expect(200);
      expect(new Set(ids(body))).toEqual(new Set(idsDe(a)));
    }

    await dos.agente
      .patch('/api/v1/barberia')
      .set({ Authorization: `Bearer ${tokenA}` })
      .send({ slug: y })
      .expect(200);
    await uno.agente
      .patch('/api/v1/barberia')
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ slug: x })
      .expect(200);

    for (const app of [uno, dos]) {
      const enX = await app.agente.get(`/api/v1/publico/${x}`).expect(200);
      expect(new Set(ids(enX.body))).toEqual(new Set(idsDe(b)));
      expect(enX.body.barberia.slug).toBe(x);
      const enY = await app.agente.get(`/api/v1/publico/${y}`).expect(200);
      expect(new Set(ids(enY.body))).toEqual(new Set(idsDe(a)));
      const horariosX = await app.agente
        .get(`/api/v1/publico/${x}/horarios?servicio=${a.servicioId}&fecha=${fecha}`)
        .expect(200);
      // El servicio de A no existe en B: no hay horarios con él por el enlace de B.
      expect(horariosX.body.horas).toEqual([]);
    }
    a.barberia.slug = y;
    b.barberia.slug = x;
  });

  it('50 consultas a enlaces inexistentes no crean ninguna clave (FR-009)', async () => {
    await redis.vaciar();
    for (let i = 0; i < 50; i += 1) {
      const app = i % 2 === 0 ? uno : dos;
      const ruta =
        i % 4 < 2
          ? `/api/v1/publico/no-existe-${sufijo}-${i}`
          : `/api/v1/publico/no-existe-${sufijo}-${i}/horarios?servicio=${a.servicioId}&fecha=${fecha}`;
      const respuesta = await app.agente.get(ruta);
      expect(respuesta.status).toBe(404);
    }
    expect(await redis.claves('*')).toEqual([]);
  });
});
