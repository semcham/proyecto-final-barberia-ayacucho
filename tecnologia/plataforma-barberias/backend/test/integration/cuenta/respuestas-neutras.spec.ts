import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { ipUnica } from '../../helpers/enlaces';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { enlaceUsado } from '../../helpers/respuestas-neutras';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T072 (a) de 010 · Respuestas neutras, parte FUNCIONAL y bloqueante (SC-005; research R07): con y sin cuenta, en la
// recuperación, el reenvío y la verificación, el mismo estado y el mismo cuerpo, y ninguna respuesta por debajo del piso
// CUENTA_RESPUESTA_MINIMA_MS. La medición de tiempos va aparte (respuestas-neutras.medicion.spec.ts, test:medicion).

const PISO_MS = Number(process.env.CUENTA_RESPUESTA_MINIMA_MS);

describe('Respuestas neutras de los enlaces de cuenta (T072 a de 010)', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;

  /** Estado, cuerpo y milisegundos de una solicitud (con un origen propio para no tocar los límites de otras). */
  async function medir(solicitud: (http: ReturnType<typeof request>) => request.Test) {
    const inicio = performance.now();
    const respuesta = await solicitud(request(prueba.app.getHttpServer())).set('X-Forwarded-For', ipUnica());
    return { estado: respuesta.status, cuerpo: respuesta.body as unknown, ms: performance.now() - inicio };
  }

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('recuperación: con cuenta, sin cuenta y con un correo mal escrito, la misma respuesta y nunca bajo el piso', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    const casos = await Promise.all(
      [cliente.correo as string, `nadie-${Date.now()}@prueba.pe`, 'no-es-un-correo'].map((correo) =>
        medir((http) => http.post('/api/v1/cuenta/recuperacion').send({ correo })),
      ),
    );
    for (const caso of casos) {
      expect({ estado: caso.estado, cuerpo: caso.cuerpo }).toEqual({
        estado: casos[0].estado,
        cuerpo: casos[0].cuerpo,
      });
      expect(caso.ms).toBeGreaterThanOrEqual(PISO_MS - 5);
    }
    expect(casos[0].estado).toBe(202);
  });

  it('reenvío: con la cuenta verificada y sin verificar, la misma respuesta y nunca bajo el piso', async () => {
    const sinVerificar = await sesionCliente(a.tenantId, undefined, { verificado: false });
    const verificada = await sesionCliente(a.tenantId);
    const casos = [];
    for (const { token } of [sinVerificar, verificada]) {
      casos.push(
        await medir((http) =>
          http.post('/api/v1/cuenta/verificacion/reenvio').set('Authorization', `Bearer ${token}`),
        ),
      );
    }
    expect({ estado: casos[1].estado, cuerpo: casos[1].cuerpo }).toEqual({
      estado: casos[0].estado,
      cuerpo: casos[0].cuerpo,
    });
    expect(casos[0].estado).toBe(202);
    for (const caso of casos) expect(caso.ms).toBeGreaterThanOrEqual(PISO_MS - 5);
  });

  it('verificación: un token desconocido y el de un enlace de una cuenta ya usado, el mismo 410 y nunca bajo el piso', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId, verificado: false });
    const usado = await enlaceUsado(a.tenantId, cliente.usuarioId as string);
    const casos = [];
    for (const token of [randomBytes(32).toString('base64url'), usado]) {
      casos.push(await medir((http) => http.post('/api/v1/cuenta/verificacion').send({ token })));
    }
    expect({ estado: casos[1].estado, cuerpo: casos[1].cuerpo }).toEqual({
      estado: casos[0].estado,
      cuerpo: casos[0].cuerpo,
    });
    expect(casos[0].estado).toBe(410);
    for (const caso of casos) expect(caso.ms).toBeGreaterThanOrEqual(PISO_MS - 5);
  });
});
