import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  barberiaDelAsistente,
  type BarberiaDelAsistente,
  conteosDeNegocio,
  ENTORNO_SIN_LIMITE,
  falsoDe,
  preguntar,
  usoDeCuota,
} from '../../helpers/asistente';
import { erroresDeContrato005 } from '../../helpers/contrato';
import { fechaEnDias } from '../../helpers/reservas';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T031 de 005 · US1-1 a US1-5, FR-001, FR-013, FR-017, FR-018, SC-001 y SC-008: con el proveedor falso en modo
// normal, los precios, duraciones, barberos y horas de las respuestas son EXACTAMENTE los del catálogo y del cálculo
// de horarios de la barbería; los horarios salen con una sola pregunta y llevan a Reservar con todo elegido; con la
// suscripción vencida se responde igual pero sin ofrecer reservar; una pregunta inválida es 422 sin cuota; nada se
// escribe en el negocio.

interface ServicioPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  duracionMinutos: number;
}

describe('T031 · Asistente del cliente con el proveedor falso (US1)', () => {
  let prueba: AppDePrueba;
  let b: BarberiaDelAsistente;

  beforeAll(async () => {
    prueba = await crearApp({ entorno: ENTORNO_SIN_LIMITE });
    b = await barberiaDelAsistente();
  });

  afterEach(() => falsoDe(prueba).restaurar());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('servicios: el 100 % de nombres, precios y duraciones son los del catálogo público (SC-001)', async () => {
    const { body } = await preguntar(
      prueba,
      b.cliente.token,
      '¿Qué servicios tienen y cuánto cuestan?',
    ).expect(200);
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 200, body)).toEqual([]);
    expect(body.resultado).toBe('RESPONDIDA');
    const catalogo = (await prueba.agente.get(`/api/v1/publico/${b.slug}`).expect(200)).body
      .servicios as ServicioPublico[];
    expect(body.datos).toEqual({
      tipo: 'SERVICIOS',
      servicios: catalogo.map((s) => ({
        servicioId: s.id,
        nombre: s.nombre,
        descripcion: s.descripcion,
        precio: s.precio,
        duracionMinutos: s.duracionMinutos,
      })),
    });
    for (const s of catalogo)
      expect(body.texto).toContain(`${s.nombre} — S/ ${s.precio} (${s.duracionMinutos} min)`);
    expect(body.cuota).toEqual({
      restantesUsuario: 999,
      restantesBarberia: 99_999,
      reiniciaEn: expect.any(String),
    });
  });

  it('barberos: los del catálogo que hacen el servicio', async () => {
    const { body } = await preguntar(prueba, b.cliente.token, '¿Qué barberos atienden la barba?').expect(200);
    expect(body.datos).toEqual({
      tipo: 'BARBEROS',
      servicio: { servicioId: b.barba, nombre: 'Barba' },
      barberos: [{ barberoId: b.luis, nombre: 'Luis' }],
    });
  });

  it('horarios: con UNA pregunta, exactamente las horas de GET /horarios, con la fecha exacta y el enlace a Reservar (SC-008)', async () => {
    const manana = fechaEnDias(1);
    const { body } = await preguntar(
      prueba,
      b.cliente.token,
      '¿Hay horario mañana para un corte clásico con Luis?',
    ).expect(200);
    expect(body.resultado).toBe('RESPONDIDA');
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 200, body)).toEqual([]);
    const consulta = new URLSearchParams({ servicio: b.corte, fecha: manana, barbero: b.luis });
    const esperadas = (
      await prueba.agente
        .get(`/api/v1/horarios?${consulta.toString()}`)
        .set('Authorization', `Bearer ${b.cliente.token}`)
        .expect(200)
    ).body.horas as { inicio: string; barberoIds: string[] }[];
    expect(esperadas.length).toBeGreaterThan(0);
    expect(body.datos.tipo).toBe('HORARIOS');
    expect(body.datos.fecha).toBe(manana);
    expect(body.datos.servicio).toEqual({ servicioId: b.corte, nombre: 'Corte clásico' });
    expect(body.datos.horas.map((h: { inicio: string }) => h.inicio)).toEqual(esperadas.map((h) => h.inicio));
    for (const hora of body.datos.horas as {
      inicio: string;
      barberos: { barberoId: string }[];
      enlace: string;
    }[]) {
      expect(hora.barberos.map((x) => x.barberoId)).toEqual([b.luis]);
      const url = new URL(hora.enlace, 'http://interfaz');
      expect(url.pathname).toBe(`/b/${b.slug}/reservar`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        servicio: b.corte,
        barbero: b.luis,
        inicio: hora.inicio,
      });
    }
    expect(body.sugerencia).toEqual({
      tipo: 'RESERVAR',
      enlace: `/b/${b.slug}/reservar?servicio=${b.corte}`,
    });
    // Una sola llamada al proveedor por pregunta.
    expect(falsoDe(prueba).llamadas.at(-1)?.pregunta).toBe(
      '¿Hay horario mañana para un corte clásico con Luis?',
    );
  });

  it('con la suscripción VENCIDA: responde con el catálogo y los horarios, pero NO ofrece reservar (FR-018)', async () => {
    const vencida = await barberiaDelAsistente();
    await poolDe('seed').query(
      `UPDATE subscription SET status = 'EXPIRED', grace_ends_at = NULL WHERE tenant_id = $1`,
      [vencida.tenantId],
    );
    const servicios = await preguntar(prueba, vencida.cliente.token, '¿Qué servicios tienen?').expect(200);
    expect(servicios.body.resultado).toBe('RESPONDIDA');
    const horarios = await preguntar(
      prueba,
      vencida.cliente.token,
      '¿Hay horario mañana para un corte clásico?',
    ).expect(200);
    expect(horarios.body.resultado).toBe('RESPONDIDA');
    expect(horarios.body.datos.horas.length).toBeGreaterThan(0);
    expect(horarios.body.texto).toContain('no acepta reservas');
    expect(horarios.body.sugerencia).toBeUndefined();
    expect(JSON.stringify(horarios.body)).not.toContain('/reservar');
  });

  it.each([
    ['vacía', ''],
    ['de 501 caracteres', 'x'.repeat(501)],
  ])(
    'una pregunta %s → 422 VALIDACION, sin consumir cuota ni llamar al proveedor',
    async (_caso, mensaje) => {
      const fresca = await barberiaDelAsistente();
      const llamadas = falsoDe(prueba).llamadas.length;
      const { body } = await preguntar(prueba, fresca.cliente.token, mensaje).expect(422);
      expect(body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo: 'mensaje' }] });
      expect(erroresDeContrato005('/asistente/mensajes', 'post', 422, body)).toEqual([]);
      expect(await usoDeCuota(fresca.tenantId, 'USUARIO', fresca.cliente.usuarioId)).toBe(0);
      expect(await usoDeCuota(fresca.tenantId, 'BARBERIA', fresca.tenantId)).toBe(0);
      expect(falsoDe(prueba).llamadas.length).toBe(llamadas);
    },
  );

  it('7 intervenciones de contexto → 422 en el campo contexto, sin cuota', async () => {
    const fresca = await barberiaDelAsistente();
    const contexto = Array.from({ length: 7 }, (_, i) => ({
      de: i % 2 ? 'ASISTENTE' : 'USUARIO',
      texto: `t${i}`,
    }));
    const { body } = await preguntar(prueba, fresca.cliente.token, 'precios', contexto).expect(422);
    expect(body.detalles).toEqual([{ campo: 'contexto', problema: 'maximo_6' }]);
    expect(await usoDeCuota(fresca.tenantId, 'USUARIO', fresca.cliente.usuarioId)).toBe(0);
  });

  it('6 intervenciones de contexto se aceptan y llegan tal cual al proveedor', async () => {
    const contexto = Array.from({ length: 6 }, (_, i) => ({
      de: i % 2 ? 'ASISTENTE' : 'USUARIO',
      texto: `t${i}`,
    }));
    await preguntar(prueba, b.cliente.token, 'precios', contexto).expect(200);
    expect(falsoDe(prueba).llamadas.at(-1)?.contexto).toEqual(contexto);
  });

  it('ninguna pregunta escribe en el negocio (citas, clientes, catálogo)', async () => {
    const antes = await conteosDeNegocio();
    for (const mensaje of [
      'precios',
      '¿Hay horario mañana para un corte clásico?',
      'Resérvame mañana a las 10',
    ]) {
      await preguntar(prueba, b.cliente.token, mensaje).expect(200);
    }
    expect(await conteosDeNegocio()).toEqual(antes);
  });
});
