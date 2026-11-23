import { v7 as uuidv7 } from 'uuid';
import { PurgarEnlacesDeCuenta } from '../../../src/modules/acceso-barberias';
import { EjecutorTareas } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T036 de 010 · Retención de los enlaces de cuenta (data-model §2): la tarea purgar-enlaces-de-cuenta borra los usados,
// anulados o vencidos hace más de 30 días, en todas las barberías y con RLS (barbería por barbería); deja los recientes
// y los vigentes. Dos réplicas a la vez no duplican nada ni fallan.

jest.setTimeout(180_000);

type Caso =
  'USADO_VIEJO' | 'ANULADO_VIEJO' | 'VENCIDO_VIEJO' | 'USADO_RECIENTE' | 'VENCIDO_RECIENTE' | 'VIGENTE';

/** Fechas de cada caso, relativas a ahora (en SQL, para no depender del reloj del proceso). */
const FECHAS: Record<Caso, string> = {
  USADO_VIEJO: `now() - interval '40 days', now() - interval '39 days', now() - interval '35 days', NULL`,
  ANULADO_VIEJO: `now() - interval '40 days', now() - interval '39 days', NULL, now() - interval '31 days'`,
  VENCIDO_VIEJO: `now() - interval '40 days', now() - interval '39 days', NULL, NULL`,
  USADO_RECIENTE: `now() - interval '3 days', now() - interval '2 days', now() - interval '2 days', NULL`,
  VENCIDO_RECIENTE: `now() - interval '3 days', now() - interval '2 days', NULL, NULL`,
  VIGENTE: `now(), now() + interval '24 hours', NULL, NULL`,
};
const BORRADOS: Caso[] = ['USADO_VIEJO', 'ANULADO_VIEJO', 'VENCIDO_VIEJO'];

/** Siembra un enlace de cada caso en una barbería nueva (cada uno de una cuenta distinta). */
async function sembrarCasos(): Promise<Record<Caso, string>> {
  const { tenantId } = await sembrarBarberia();
  const ids = {} as Record<Caso, string>;
  for (const caso of Object.keys(FECHAS) as Caso[]) {
    const usuarioId = (await sembrarCliente({ tenantId })).usuarioId as string;
    ids[caso] = uuidv7();
    await poolDe('seed').query(
      `INSERT INTO account_link (id, tenant_id, user_id, purpose, requested_at, expires_at, used_at, revoked_at)
       VALUES ($1, $2, $3, 'VERIFICAR_CORREO', ${FECHAS[caso]})`,
      [ids[caso], tenantId, usuarioId],
    );
  }
  return ids;
}

async function quedan(ids: string[]): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ id: string }>(
    'SELECT id FROM account_link WHERE id = ANY($1)',
    [ids],
  );
  return rows.map((f) => f.id).sort();
}

describe('Retención de los enlaces de cuenta (purgar-enlaces-de-cuenta)', () => {
  let replicas: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    replicas = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(replicas.map((r) => r.cerrar()));
    await cerrarPools();
  });

  it('borra en todas las barberías los terminados hace más de 30 días y deja los recientes y los vigentes', async () => {
    const [a, b] = [await sembrarCasos(), await sembrarCasos()];
    const corrida = await replicas[0].app.get(EjecutorTareas).ejecutarAhora('purgar-enlaces-de-cuenta');
    expect(corrida).toMatchObject({ ejecutada: true, fallidos: 0 });

    for (const ids of [a, b]) {
      const conservados = (Object.keys(ids) as Caso[]).filter((caso) => !BORRADOS.includes(caso));
      expect(await quedan(Object.values(ids))).toEqual(conservados.map((caso) => ids[caso]).sort());
    }
  });

  it('dos réplicas a la vez (sin el candado): cada enlace se borra una vez y ninguna falla', async () => {
    const ids = await sembrarCasos();
    const resultados = await Promise.all(replicas.map((r) => r.app.get(PurgarEnlacesDeCuenta).ejecutar()));
    expect(resultados.every((r) => r.fallidos === 0)).toBe(true);
    expect(await quedan(Object.values(ids))).toEqual(
      (['USADO_RECIENTE', 'VENCIDO_RECIENTE', 'VIGENTE'] as Caso[]).map((caso) => ids[caso]).sort(),
    );
  });
});
