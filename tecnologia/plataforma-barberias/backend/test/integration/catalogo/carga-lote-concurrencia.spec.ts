import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarBarbero } from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T043 y T044 de 011 · US3 (FR-015, SC-003): dos cargas a la vez (o una carga y una creación individual) nunca superan
// el cupo de barberos activos del plan, porque usan EL MISMO bloqueo de la fila de la suscripción. Las solicitudes se
// reparten entre DOS instancias de la aplicación (cada una con su pool), como PR16. El plan de prueba permite 5.

jest.setTimeout(300_000);

const MAXIMO = 5;
const REPETICIONES = 50;

describe('Carga en lote: concurrencia del cupo', () => {
  let instancias: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((i) => i.cerrar()));
    await cerrarPools();
  });

  /** Barbería con `activos` barberos y el token de su propietario. */
  async function barberiaCon(activos: number) {
    const b = await sembrarBarberia();
    for (let i = 0; i < activos; i++)
      await sembrarBarbero({ tenantId: b.tenantId, nombre: `Existente ${i}` });
    return { ...b, token: await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO') };
  }

  const cargarBarberos = (instancia: AppDePrueba, token: string, nombres: string[]) =>
    instancia.agente
      .post('/api/v1/barberos/lote')
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() })
      .send({ filas: nombres.map((nombre) => ({ nombre })) });

  const activosDe = async (tenantId: string) =>
    (
      await poolDe('seed').query<{ n: number }>(
        'SELECT count(*)::int AS n FROM barber WHERE tenant_id = $1 AND active',
        [tenantId],
      )
    ).rows[0].n;

  it(`T043: con cupo para 3, dos cargas de 2 a la vez → siempre una 201 y una 403 (${REPETICIONES} veces)`, async () => {
    const resultados: string[] = [];
    for (let vez = 0; vez < REPETICIONES; vez++) {
      const b = await barberiaCon(MAXIMO - 3);
      const [r1, r2] = await Promise.all([
        cargarBarberos(instancias[0], b.token, [`A${vez}`, `B${vez}`]),
        cargarBarberos(instancias[1], b.token, [`C${vez}`, `D${vez}`]),
      ]);
      const estados = [r1.status, r2.status].sort();
      resultados.push(estados.join('/'));
      expect(estados).toEqual([201, 403]);
      const perdedora = r1.status === 403 ? r1 : r2;
      expect(perdedora.body).toMatchObject({
        codigo: 'SUSCRIPCION_NO_PERMITE',
        detalles: [{ motivo: 'LIMITE_BARBEROS', maximo: MAXIMO, activos: 4, solicitados: 2 }],
      });
      expect(await activosDe(b.tenantId)).toBe(4);
    }
    expect(new Set(resultados)).toEqual(new Set(['201/403']));
  });

  it(`T044: una carga de 2 y una creación individual a la vez con cupo 2 → nunca más de ${MAXIMO} activos`, async () => {
    for (let vez = 0; vez < 20; vez++) {
      const b = await barberiaCon(MAXIMO - 2);
      const [lote, uno] = await Promise.all([
        cargarBarberos(instancias[0], b.token, [`Lote A${vez}`, `Lote B${vez}`]),
        instancias[1].agente
          .post('/api/v1/barberos')
          .set({ Authorization: `Bearer ${b.token}` })
          .send({ nombre: `Solo ${vez}`, servicioIds: [] }),
      ]);
      // Gana quien toma primero el bloqueo: o la carga entera (y la creación queda fuera) o la creación (y la carga no
      // cabe). Nunca ambas.
      expect([lote.status, uno.status].sort()).toEqual([201, 403]);
      expect(await activosDe(b.tenantId)).toBeLessThanOrEqual(MAXIMO);
    }
  });

  it('T044: dos cargas de servicios con un nombre en común a la vez → una se guarda y la otra no crea nada', async () => {
    for (let vez = 0; vez < 20; vez++) {
      const b = await barberiaCon(0);
      const cargar = (instancia: AppDePrueba, nombres: string[]) =>
        instancia.agente
          .post('/api/v1/servicios/lote')
          .set({ Authorization: `Bearer ${b.token}`, 'Idempotency-Key': randomUUID() })
          .send({ filas: nombres.map((nombre) => ({ nombre, duracionMinutos: 30, precio: '20' })) });
      const [r1, r2] = await Promise.all([
        cargar(instancias[0], ['Corte', 'Barba']),
        cargar(instancias[1], ['Cejas', 'corte']),
      ]);
      const estados = [r1.status, r2.status].sort();
      // La que pierde: 409 NOMBRE_DUPLICADO (chocó con el índice) o 400 "ya_existe" (si la otra ya había terminado).
      expect(estados[0]).toBe(201);
      expect([400, 409]).toContain(estados[1]);
      const { rows } = await poolDe('seed').query<{ n: number }>(
        'SELECT count(*)::int AS n FROM service WHERE tenant_id = $1',
        [b.tenantId],
      );
      expect(rows[0].n).toBe(2);
    }
  });
});
