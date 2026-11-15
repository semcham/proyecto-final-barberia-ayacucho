import { type AppDePrueba, crearApp } from '../../helpers/app';
import { barberiaDelAsistente, falsoDe, preguntar, preguntasDe } from '../../helpers/asistente';
import { filasDe } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T035 de 005 · FR-010, FR-029, SC-007 y research R09: cada pregunta deja una fila en assistant_question con quién,
// el rol, la intención, el resultado, la duración y los tokens, y una fila ASISTENTE_CONSULTADO en la auditoría. Se
// prueban los siete resultados. NUNCA se guarda ni se registra el texto de la pregunta ni de la respuesta, ni la llave.

const MARCADOR = 'zorro-violeta-8231';
const LLAVE_DE_PRUEBA = 'sk-or-v1-llave-que-no-debe-aparecer-en-ningun-lado';
const ENTORNO = {
  IA_PROVEEDOR: 'falso',
  IA_CUOTA_USUARIO_DIA: '6',
  IA_CUOTA_BARBERIA_DIA: '100',
  // Aunque esté en el entorno, con el proveedor falso la llave no se lee; y nunca debe salir en ningún registro.
  IA_OPENROUTER_LLAVE: LLAVE_DE_PRUEBA,
};

describe('T035 · Registro de preguntas sin texto y auditoría (FR-010, FR-029, SC-007)', () => {
  let prueba: AppDePrueba;
  const salida: string[] = [];
  const escrituras = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };

  beforeAll(async () => {
    prueba = await crearApp({ entorno: ENTORNO });
    // Captura lo que la aplicación escribe en la consola (registros) mientras dura la prueba.
    process.stdout.write = ((trozo: unknown, ...resto: unknown[]) => {
      salida.push(String(trozo));
      return (escrituras.stdout as (...a: unknown[]) => boolean)(trozo, ...resto);
    }) as typeof process.stdout.write;
    process.stderr.write = ((trozo: unknown, ...resto: unknown[]) => {
      salida.push(String(trozo));
      return (escrituras.stderr as (...a: unknown[]) => boolean)(trozo, ...resto);
    }) as typeof process.stderr.write;
  });

  afterAll(async () => {
    process.stdout.write = escrituras.stdout;
    process.stderr.write = escrituras.stderr;
    await prueba.cerrar();
    await cerrarPools();
  });

  it('los siete resultados quedan registrados con el usuario, el rol, la intención y la duración; sin texto', async () => {
    const b = await barberiaDelAsistente();
    const falso = falsoDe(prueba);
    const t = b.cliente.token;
    await preguntar(prueba, t, `precios ${MARCADOR}`).expect(200); // RESPONDIDA
    await preguntar(prueba, t, `¿Hay horario el 2026-13-45 para un corte clásico? ${MARCADOR}`).expect(200); // SIN_DATOS
    await preguntar(prueba, t, `¿Atienden a domicilio? ${MARCADOR}`).expect(200); // FUERA_DE_ALCANCE
    await preguntar(prueba, t, `Resérvame mañana a las 10 ${MARCADOR}`).expect(200); // ACCION_NO_PERMITIDA
    await preguntar(prueba, t, `${MARCADOR} ${'x'.repeat(501)}`).expect(422); // INVALIDA (sin cuota)
    falso.fijarModo({ tipo: 'caido' });
    await preguntar(prueba, t, `precios ${MARCADOR}`).expect(503); // PROVEEDOR_NO_DISPONIBLE (cuota devuelta)
    falso.restaurar();
    await preguntar(prueba, t, `precios ${MARCADOR}`).expect(200); // RESPONDIDA (5.ª de la cuota)
    await preguntar(prueba, t, `precios ${MARCADOR}`).expect(200); // 6.ª
    await preguntar(prueba, t, `precios ${MARCADOR}`).expect(429); // CUOTA_AGOTADA

    const preguntas = await preguntasDe(b.tenantId);
    expect(preguntas.map((p) => [p.result, p.intent])).toEqual([
      ['RESPONDIDA', 'servicios'],
      ['SIN_DATOS', 'horarios_libres'],
      ['FUERA_DE_ALCANCE', 'fuera_de_alcance'],
      ['ACCION_NO_PERMITIDA', 'accion_no_permitida'],
      ['INVALIDA', null],
      ['PROVEEDOR_NO_DISPONIBLE', null],
      ['RESPONDIDA', 'servicios'],
      ['RESPONDIDA', 'servicios'],
      ['CUOTA_AGOTADA', null],
    ]);
    for (const p of preguntas) {
      expect(p).toMatchObject({ tenant_id: b.tenantId, user_id: b.cliente.usuarioId, role: 'CLIENTE' });
      expect(p.duration_ms).toEqual(expect.any(Number));
      expect(p.duration_ms as number).toBeGreaterThanOrEqual(0);
      // El proveedor falso no informa tokens.
      expect([p.tokens_in, p.tokens_out]).toEqual([null, null]);
    }
    expect(JSON.stringify(preguntas)).not.toContain(MARCADOR);

    // La auditoría: una fila por pregunta, con el rol y el resultado; sin el texto.
    const auditoria = (await filasDe('audit_log', b.tenantId)).filter(
      (f) => f.action === 'ASISTENTE_CONSULTADO',
    );
    expect(auditoria.map((f) => f.resource)).toEqual(
      preguntas.map((p) => `asistente:CLIENTE;${p.result as string}`),
    );
    for (const fila of auditoria) {
      expect(fila).toMatchObject({ actor_id: b.cliente.usuarioId, reason: null });
    }
    expect(JSON.stringify(await filasDe('audit_log', b.tenantId))).not.toContain(MARCADOR);
  });

  it('ni el texto ni la llave aparecen en los registros de la aplicación', () => {
    const registros = salida.join('');
    expect(registros).not.toContain(MARCADOR);
    expect(registros).not.toContain(LLAVE_DE_PRUEBA);
  });

  it('ni la llave ni el texto aparecen en la base (todas las tablas del asistente y la auditoría)', async () => {
    const b = await barberiaDelAsistente();
    await preguntar(prueba, b.cliente.token, `precios ${MARCADOR}`).expect(200);
    const todo = JSON.stringify([
      await filasDe('assistant_question', b.tenantId),
      await filasDe('assistant_quota', b.tenantId),
      await filasDe('audit_log', b.tenantId),
    ]);
    expect(todo).not.toContain(MARCADOR);
    expect(todo).not.toContain(LLAVE_DE_PRUEBA);
  });
});
