import { RelojDePrueba, conReloj } from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  barberiaDelAsistente,
  type BarberiaDelAsistente,
  falsoDe,
  preguntar,
  preguntasDe,
  usoDeCuota,
} from '../../helpers/asistente';
import { erroresDeContrato005 } from '../../helpers/contrato';
import { JoseTokenSigner } from '../../../src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer';
import { Configuracion } from '../../../src/shared';
import { sembrarCliente, sembrarSesion } from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T033 de 005 · FR-007, SC-004 y research R08: cuotas por usuario y por barbería, en PostgreSQL y atómicas. Al
// agotarse, 429 CUOTA_ASISTENTE_AGOTADA con Retry-After y, en detalles[0], el alcance, la hora de reinicio y los
// segundos. Las dos cuotas se suman en una transacción corta que confirma ANTES de llamar al proveedor; si una está
// agotada no sube ninguna. Con dos instancias a la vez nunca se pasa del límite. Se devuelve la unidad si el proveedor
// falla; cerrar sesión no la reinicia; la medianoche local sí.

const LIMITES = { IA_PROVEEDOR: 'falso', IA_CUOTA_USUARIO_DIA: '3', IA_CUOTA_BARBERIA_DIA: '5' };

/** Un token del cliente con su sesión sembrada como usada en `instante` (para el reloj controlado de la prueba). */
async function tokenConSesionEn(tenantId: string, usuarioId: string, instante: Date): Promise<string> {
  const { sesionId } = await sembrarSesion({
    tenantId,
    usuarioId,
    ultimoUso: instante,
    venceAbsoluto: new Date(instante.getTime() + 30 * 24 * 60 * 60 * 1000),
  });
  const { token } = await new JoseTokenSigner(new Configuracion()).firmar({
    sub: usuarioId,
    tid: tenantId,
    rol: 'CLIENTE',
    sid: sesionId,
  });
  return token;
}

async function otroCliente(b: BarberiaDelAsistente): Promise<{ token: string; usuarioId: string }> {
  const c = await sembrarCliente({ tenantId: b.tenantId });
  return {
    token: await tokenPara(b.tenantId, c.usuarioId as string, 'CLIENTE'),
    usuarioId: c.usuarioId as string,
  };
}

describe('T033 · Cuotas del asistente (FR-007, SC-004)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp({ entorno: LIMITES });
  });

  afterEach(() => falsoDe(prueba).restaurar());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('al llegar al límite del usuario, la siguiente → 429 con Retry-After y los datos en detalles[0]', async () => {
    const b = await barberiaDelAsistente();
    for (let i = 0; i < 3; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(200);
    const respuesta = await preguntar(prueba, b.cliente.token, 'precios').expect(429);
    expect(respuesta.body).toEqual({
      codigo: 'CUOTA_ASISTENTE_AGOTADA',
      mensaje: expect.stringMatching(/límite/),
      detalles: [
        {
          alcance: 'USUARIO',
          reiniciaEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00-05:00$/),
          reintentarEnSegundos: expect.any(Number),
        },
      ],
    });
    expect(Number(respuesta.headers['retry-after'])).toBe(respuesta.body.detalles[0].reintentarEnSegundos);
    expect(respuesta.body.detalles[0].reintentarEnSegundos).toBeGreaterThan(0);
    expect(respuesta.body.detalles[0].reintentarEnSegundos).toBeLessThanOrEqual(24 * 60 * 60);
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 429, respuesta.body)).toEqual([]);
    expect(await usoDeCuota(b.tenantId, 'USUARIO', b.cliente.usuarioId)).toBe(3);
  });

  it('el límite de la barbería con dos clientes: el que choca no suma ni su propia cuota (una sola transacción)', async () => {
    const b = await barberiaDelAsistente();
    const otro = await otroCliente(b);
    for (let i = 0; i < 3; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(200);
    for (let i = 0; i < 2; i++) await preguntar(prueba, otro.token, 'precios').expect(200);
    const respuesta = await preguntar(prueba, otro.token, 'precios').expect(429);
    expect(respuesta.body.detalles[0].alcance).toBe('BARBERIA');
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(5);
    // La cuota del usuario se habría sumado antes que la de la barbería: se revirtió con ella.
    expect(await usoDeCuota(b.tenantId, 'USUARIO', otro.usuarioId)).toBe(2);
  });

  it('la pregunta rechazada por cuota queda registrada (CUOTA_AGOTADA), aunque la suma se revierta', async () => {
    const b = await barberiaDelAsistente();
    for (let i = 0; i < 3; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(200);
    await preguntar(prueba, b.cliente.token, 'precios').expect(429);
    const resultados = (await preguntasDe(b.tenantId)).map((p) => p.result);
    expect(resultados).toEqual(['RESPONDIDA', 'RESPONDIDA', 'RESPONDIDA', 'CUOTA_AGOTADA']);
  });

  it('T050 · el propietario tiene la misma cuota de usuario y suma en la de su barbería', async () => {
    const b = await barberiaDelAsistente();
    const propietarioId = b.e.barberia.propietarioId;
    const resumen = '¿Cuántas citas tuve este mes?';
    for (let i = 0; i < 3; i++) {
      expect((await preguntar(prueba, b.propietario, resumen).expect(200)).body.resultado).toBe('RESPONDIDA');
    }
    const agotada = await preguntar(prueba, b.propietario, resumen).expect(429);
    expect(agotada.body.detalles[0].alcance).toBe('USUARIO');
    expect(Number(agotada.headers['retry-after'])).toBe(agotada.body.detalles[0].reintentarEnSegundos);
    expect(await usoDeCuota(b.tenantId, 'USUARIO', propietarioId)).toBe(3);
    // Las 3 del propietario cuentan en la barbería: al cliente le quedan 2 y la tercera choca con la de la barbería.
    for (let i = 0; i < 2; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(200);
    const delCliente = await preguntar(prueba, b.cliente.token, 'precios').expect(429);
    expect(delCliente.body.detalles[0].alcance).toBe('BARBERIA');
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(5);
    expect(
      (await preguntasDe(b.tenantId)).filter((p) => p.role === 'PROPIETARIO').map((p) => p.result),
    ).toEqual(['RESPONDIDA', 'RESPONDIDA', 'RESPONDIDA', 'CUOTA_AGOTADA']);
  });

  it('T050 · si el proveedor falla con el propietario, su unidad también se devuelve', async () => {
    const b = await barberiaDelAsistente();
    falsoDe(prueba).fijarModo({ tipo: 'caido' });
    const caido = await preguntar(prueba, b.propietario, '¿Cuántas citas tuve este mes?').expect(503);
    expect(caido.body.detalles[0]).toMatchObject({ alternativa: { tipo: 'REPORTES' } });
    expect(await usoDeCuota(b.tenantId, 'USUARIO', b.e.barberia.propietarioId)).toBe(0);
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(0);
  });

  it('si el proveedor falla, la unidad se devuelve', async () => {
    const b = await barberiaDelAsistente();
    falsoDe(prueba).fijarModo({ tipo: 'caido' });
    await preguntar(prueba, b.cliente.token, 'precios').expect(503);
    expect(await usoDeCuota(b.tenantId, 'USUARIO', b.cliente.usuarioId)).toBe(0);
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(0);
  });

  it('cerrar sesión e iniciar otra no reinicia la cuota', async () => {
    const b = await barberiaDelAsistente();
    for (let i = 0; i < 3; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(200);
    await prueba.agente.post('/api/v1/auth/logout').set('Authorization', `Bearer ${b.cliente.token}`);
    const nuevaSesion = await tokenPara(b.tenantId, b.cliente.usuarioId, 'CLIENTE');
    await preguntar(prueba, nuevaSesion, 'precios').expect(429);
  });

  it('dos instancias reciben a la vez más preguntas que la cuota: nunca se pasa del límite y 0 × 5xx', async () => {
    const otra = await crearApp({ entorno: LIMITES });
    try {
      const b = await barberiaDelAsistente();
      const clientes = [b.cliente, await otroCliente(b), await otroCliente(b)];
      // 3 clientes × 4 preguntas = 12, repartidas entre las dos instancias, todas a la vez.
      const respuestas = await Promise.all(
        clientes.flatMap((c, i) =>
          Array.from({ length: 4 }, (_, j) =>
            preguntar((i + j) % 2 === 0 ? prueba : otra, c.token, 'precios'),
          ),
        ),
      );
      const estados = respuestas.map((r) => r.status);
      expect(estados.filter((e) => e >= 500)).toEqual([]);
      expect(estados.filter((e) => e === 200)).toHaveLength(5);
      expect(estados.filter((e) => e === 429)).toHaveLength(7);
      expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(5);
      for (const c of clientes) {
        expect(await usoDeCuota(b.tenantId, 'USUARIO', c.usuarioId)).toBeLessThanOrEqual(3);
      }
    } finally {
      await otra.cerrar();
    }
  });

  it('a la medianoche local de la barbería (reloj controlado) la cuota se reinicia', async () => {
    const reloj = new RelojDePrueba();
    const conRelojFijo = await crearApp({ entorno: LIMITES, ajustar: conReloj(reloj) });
    try {
      const b = await barberiaDelAsistente();
      // 23:50 de Lima (04:50 UTC del día siguiente). La sesión también se valida con este reloj: se siembra una cuyo
      // último uso es ese instante.
      const instante = new Date('2030-03-15T04:50:00Z');
      reloj.fijar(instante);
      const token = await tokenConSesionEn(b.tenantId, b.cliente.usuarioId, instante);
      for (let i = 0; i < 3; i++) await preguntar(conRelojFijo, token, 'precios').expect(200);
      const agotada = await preguntar(conRelojFijo, token, 'precios').expect(429);
      expect(agotada.body.detalles[0]).toMatchObject({
        reiniciaEn: '2030-03-15T00:00:00-05:00',
        reintentarEnSegundos: 10 * 60,
      });
      reloj.fijar(new Date('2030-03-15T05:00:01Z'));
      await preguntar(conRelojFijo, token, 'precios').expect(200);
    } finally {
      await conRelojFijo.cerrar();
    }
  });
});
