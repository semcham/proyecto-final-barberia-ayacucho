import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { ipUnica } from '../../helpers/enlaces';
import {
  type BarberiaSembrada,
  type ClienteSembrado,
  sembrarBarberia,
  sembrarCliente,
} from '../../helpers/fixtures';
import { enlaceUsado, percentil } from '../../helpers/respuestas-neutras';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T072 (b) de 010 · MEDICIÓN de tiempos de las respuestas neutras (SC-005; research R07; quickstart §1.1). No la recoge
// `npm run test:int`: corre con `npm run test:medicion`. En la verificación local es estricta; en la CI corre en un paso
// propio y NO bloqueante (continue-on-error), porque los tiempos de los ejecutores compartidos varían por causas ajenas
// al código.
//
// Criterio: 100 solicitudes por serie (con cuenta y sin cuenta), en recuperación, reenvío y verificación; diferencia de
// medianas menor de 30 ms; percentil 90 de ambas series dentro del piso (400 ms, el valor por defecto) más 50 ms. Las
// dos series se intercalan, para que una carga pasajera de la máquina afecte a las dos por igual. Cada solicitud usa su
// propio origen y, con cuenta, su propia cuenta: los límites de R08 no entran en la medición.

jest.setTimeout(900_000);

const PISO_MS = 400;
const POR_SERIE = 100;

interface Resultado {
  medianaCon: number;
  medianaSin: number;
  p90Con: number;
  p90Sin: number;
}

describe('Medición de las respuestas neutras (T072 b de 010, SC-005)', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;

  async function ms(
    solicitud: (http: ReturnType<typeof request>) => request.Test,
    estado: number,
  ): Promise<number> {
    const inicio = performance.now();
    const respuesta = await solicitud(request(prueba.app.getHttpServer())).set('X-Forwarded-For', ipUnica());
    const duracion = performance.now() - inicio;
    expect(respuesta.status).toBe(estado);
    return duracion;
  }

  /** Mide las dos series intercaladas, las registra y aplica el criterio. */
  async function medirSeries(
    nombre: string,
    con: (i: number) => Promise<number>,
    sin: (i: number) => Promise<number>,
  ): Promise<Resultado> {
    const serieCon: number[] = [];
    const serieSin: number[] = [];
    for (let i = 0; i < POR_SERIE; i++) {
      serieCon.push(await con(i));
      serieSin.push(await sin(i));
    }
    const resultado = {
      medianaCon: Math.round(percentil(serieCon, 50)),
      medianaSin: Math.round(percentil(serieSin, 50)),
      p90Con: Math.round(percentil(serieCon, 90)),
      p90Sin: Math.round(percentil(serieSin, 90)),
    };
    console.info(`SC-005 · ${nombre}`, { piso: PISO_MS, porSerie: POR_SERIE, ...resultado });
    expect(Math.abs(resultado.medianaCon - resultado.medianaSin)).toBeLessThan(30);
    expect(resultado.p90Con).toBeLessThanOrEqual(PISO_MS + 50);
    expect(resultado.p90Sin).toBeLessThanOrEqual(PISO_MS + 50);
    return resultado;
  }

  beforeAll(async () => {
    prueba = await crearApp({ entorno: { CUENTA_RESPUESTA_MINIMA_MS: String(PISO_MS) } });
    a = await sembrarBarberia();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('recuperación: con cuenta y sin cuenta', async () => {
    const clientes: ClienteSembrado[] = [];
    for (let i = 0; i < POR_SERIE; i++) clientes.push(await sembrarCliente({ tenantId: a.tenantId }));
    await medirSeries(
      'recuperación',
      (i) => ms((http) => http.post('/api/v1/cuenta/recuperacion').send({ correo: clientes[i].correo }), 202),
      (i) =>
        ms(
          (http) =>
            http.post('/api/v1/cuenta/recuperacion').send({ correo: `nadie-${i}-${Date.now()}@prueba.pe` }),
          202,
        ),
    );
  });

  it('reenvío: cuenta sin verificar (envía) y verificada (no envía)', async () => {
    const sinVerificar: { token: string }[] = [];
    const verificadas: { token: string }[] = [];
    for (let i = 0; i < POR_SERIE; i++) {
      sinVerificar.push(await sesionCliente(a.tenantId, undefined, { verificado: false }));
      verificadas.push(await sesionCliente(a.tenantId));
    }
    const reenviar = (token: string) => (http: ReturnType<typeof request>) =>
      http.post('/api/v1/cuenta/verificacion/reenvio').set('Authorization', `Bearer ${token}`);
    await medirSeries(
      'reenvío',
      (i) => ms(reenviar(sinVerificar[i].token), 202),
      (i) => ms(reenviar(verificadas[i].token), 202),
    );
  });

  it('verificación: enlace de una cuenta (ya usado) y token desconocido', async () => {
    const usados: string[] = [];
    for (let i = 0; i < POR_SERIE; i++) {
      const cliente = await sembrarCliente({ tenantId: a.tenantId, verificado: false });
      usados.push(await enlaceUsado(a.tenantId, cliente.usuarioId as string));
    }
    const verificar = (token: string) => (http: ReturnType<typeof request>) =>
      http.post('/api/v1/cuenta/verificacion').send({ token });
    await medirSeries(
      'verificación',
      (i) => ms(verificar(usados[i]), 410),
      () => ms(verificar(randomBytes(32).toString('base64url')), 410),
    );
  });
});
