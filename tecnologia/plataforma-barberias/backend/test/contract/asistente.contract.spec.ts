import { type AppDePrueba, crearApp } from '../helpers/app';
import { barberiaDelAsistente, falsoDe, preguntar } from '../helpers/asistente';
import { erroresDeContrato005 } from '../helpers/contrato';
import { cerrarPools } from '../helpers/test-db';

// T037 de 005 · Las respuestas de POST /asistente/mensajes cumplen specs/005-asistente-ia-reportes/contracts/openapi.yaml:
// 200 RespuestaAsistente (servicios, barberos, horarios, sin datos, fuera de alcance, acción no permitida), 422 Error,
// 429 ErrorCuota y 503 ErrorNoDisponible. Los errores tienen SOLO codigo, mensaje y detalles, como todos.

describe('Contrato de 005 · POST /asistente/mensajes (T037)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp({
      entorno: { IA_PROVEEDOR: 'falso', IA_CUOTA_USUARIO_DIA: '8', IA_CUOTA_BARBERIA_DIA: '100' },
    });
  });

  afterEach(() => falsoDe(prueba).restaurar());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it.each([
    ['servicios', '¿Qué servicios tienen?', 'RESPONDIDA'],
    ['barberos', '¿Qué barberos atienden la barba?', 'RESPONDIDA'],
    ['horarios', '¿Hay horario mañana para un corte clásico?', 'RESPONDIDA'],
    ['sin datos', '¿Hay horario el 2026-13-45 para un corte clásico?', 'SIN_DATOS'],
    ['fuera de alcance', '¿Atienden a domicilio?', 'FUERA_DE_ALCANCE'],
    ['acción no permitida', 'Resérvame mañana a las 10', 'ACCION_NO_PERMITIDA'],
  ])('200 (%s): RespuestaAsistente', async (_caso, mensaje, resultado) => {
    const b = await barberiaDelAsistente();
    const { body } = await preguntar(prueba, b.cliente.token, mensaje).expect(200);
    expect(body.resultado).toBe(resultado);
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 200, body)).toEqual([]);
  });

  it('422: Error', async () => {
    const b = await barberiaDelAsistente();
    const { body } = await preguntar(prueba, b.cliente.token, '').expect(422);
    expect(Object.keys(body).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 422, body)).toEqual([]);
  });

  it('429: ErrorCuota, con los datos en detalles[0]', async () => {
    const b = await barberiaDelAsistente();
    for (let i = 0; i < 8; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(200);
    const { body } = await preguntar(prueba, b.cliente.token, 'precios').expect(429);
    expect(Object.keys(body).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 429, body)).toEqual([]);
  });

  it('503: ErrorNoDisponible, con la alternativa en detalles[0]', async () => {
    const b = await barberiaDelAsistente();
    falsoDe(prueba).fijarModo({ tipo: 'caido' });
    const { body } = await preguntar(prueba, b.cliente.token, 'precios').expect(503);
    expect(Object.keys(body).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 503, body)).toEqual([]);
  });
});
