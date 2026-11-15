import { FechaLocal, ZonaHoraria } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  barberiaDelAsistente,
  type BarberiaDelAsistente,
  conteosDeNegocio,
  ENTORNO_SIN_LIMITE,
  falsoDe,
  preguntar,
  preguntasDe,
} from '../../helpers/asistente';
import { erroresDeContrato005 } from '../../helpers/contrato';
import { sembrarCliente } from '../../helpers/fixtures';
import { type EstadoDeCita, pedirReportes, sembrarCitaDeReporte } from '../../helpers/reportes';
import { horaLima } from '../../helpers/reservas';
import { cerrarPools } from '../../helpers/test-db';

// T048 de 005 · US3-1 a US3-4, FR-027, FR-028 y SC-008: el asistente del propietario responde con UNA pregunta el
// resumen de citas y los servicios más pedidos de un período, con EXACTAMENTE las mismas cifras que GET /reportes
// (US2) para ese período, que dice en la respuesta. "Este mes" y "la semana pasada" se resuelven en la zona de la
// barbería. Más de 366 días se explica. Nunca devuelve nombres, teléfonos ni correos de clientes, y las herramientas
// del cliente no son suyas. Solo lee.

const LIMA = new ZonaHoraria('America/Lima');
const CLIENTE = { nombre: 'Rocío Ñahui Dueña', correo: 'rocio.us3@prueba.pe', telefono: '933221100' };

interface Periodos {
  hoy: FechaLocal;
  inicioDelMes: FechaLocal;
  lunesPasado: FechaLocal;
  domingoPasado: FechaLocal;
}

function periodos(): Periodos {
  const hoy = LIMA.fechaDe(new Date());
  const inicioDelMes = FechaLocal.desdeComponentes(hoy.anio, hoy.mes, 1);
  // Semana de lunes a domingo; la pasada es la anterior a la de hoy.
  const lunesDeEstaSemana = hoy.sumarDias(-((hoy.diaSemana + 6) % 7));
  return {
    hoy,
    inicioDelMes,
    lunesPasado: lunesDeEstaSemana.sumarDias(-7),
    domingoPasado: lunesDeEstaSemana.sumarDias(-1),
  };
}

describe('T048 · Asistente del propietario (US3)', () => {
  let prueba: AppDePrueba;
  let b: BarberiaDelAsistente;
  let p: Periodos;
  let clienteId: string;

  beforeAll(async () => {
    prueba = await crearApp({ entorno: ENTORNO_SIN_LIMITE });
    b = await barberiaDelAsistente();
    p = periodos();
    ({ clienteId } = await sembrarCliente({ tenantId: b.tenantId, ...CLIENTE }));
    const cita = (
      fecha: FechaLocal,
      hora: string,
      estado: EstadoDeCita,
      servicio: string,
      barberoId = b.luis,
    ) =>
      sembrarCitaDeReporte({
        tenantId: b.tenantId,
        barberoId,
        servicioId: b.corte,
        clienteId,
        inicio: horaLima(fecha.toString(), hora),
        estado,
        servicio,
        tardia: estado === 'CANCELADA',
      });
    // Este mes (desde el día 1 hasta hoy) y la semana pasada (que puede caer en el mes anterior).
    await cita(p.inicioDelMes, '08:00', 'COMPLETADA', 'Corte clásico');
    await cita(p.inicioDelMes, '09:00', 'CANCELADA', 'Corte clásico');
    await cita(p.hoy, '06:00', 'NO_ASISTIO', 'Barba', b.ana);
    await cita(p.lunesPasado, '10:00', 'COMPLETADA', 'Barba');
    await cita(p.lunesPasado, '11:00', 'COMPLETADA', 'Barba', b.ana);
    await cita(p.domingoPasado, '18:00', 'COMPLETADA', 'Corte clásico');
  });

  afterEach(() => falsoDe(prueba).restaurar());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('"¿Cuántas citas tuve este mes?": con una pregunta, las MISMAS cifras de GET /reportes de ese período', async () => {
    const { body } = await preguntar(prueba, b.propietario, '¿Cuántas citas tuve este mes?').expect(200);
    expect(body.resultado).toBe('RESPONDIDA');
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 200, body)).toEqual([]);
    expect(body.datos.tipo).toBe('RESUMEN_CITAS');
    expect(body.datos.periodo).toEqual({
      desde: p.inicioDelMes.toString(),
      hasta: p.hoy.toString(),
      zonaHoraria: 'America/Lima',
    });
    const reportes = (
      await pedirReportes(prueba, b.propietario, {
        desde: p.inicioDelMes.toString(),
        hasta: p.hoy.toString(),
      }).expect(200)
    ).body;
    expect(body.datos.citas).toEqual(reportes.citas);
    expect(body.datos.citas.total).toBeGreaterThan(0);
    expect(body.texto).toContain(`${reportes.citas.total} citas`);
    expect(body.texto).toMatch(/Del \d+ de \w+ de \d{4} al \d+ de \w+ de \d{4}/);
  });

  it('"¿Cuál fue el servicio más pedido la semana pasada?": los MISMOS servicios de GET /reportes', async () => {
    const { body } = await preguntar(
      prueba,
      b.propietario,
      '¿Cuál fue el servicio más pedido la semana pasada?',
    ).expect(200);
    expect(body.resultado).toBe('RESPONDIDA');
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 200, body)).toEqual([]);
    expect(body.datos.tipo).toBe('SERVICIOS_MAS_PEDIDOS');
    expect(body.datos.periodo).toMatchObject({
      desde: p.lunesPasado.toString(),
      hasta: p.domingoPasado.toString(),
    });
    const reportes = (
      await pedirReportes(prueba, b.propietario, {
        desde: p.lunesPasado.toString(),
        hasta: p.domingoPasado.toString(),
      }).expect(200)
    ).body;
    expect(body.datos.servicios).toEqual(reportes.serviciosMasSolicitados);
    expect(body.datos.servicios.length).toBeGreaterThan(0);
    expect(body.texto).toContain(body.datos.servicios[0].nombre);
  });

  it('más de 366 días: lo explica, sin cifras', async () => {
    falsoDe(prueba).fijarModo({
      tipo: 'guion',
      respuesta: { intencion: 'resumen_citas', argumentos: { desde: '2025-01-01', hasta: '2026-12-31' } },
    });
    const { body } = await preguntar(prueba, b.propietario, 'resumen de los dos últimos años').expect(200);
    expect(body.resultado).toBe('SIN_DATOS');
    expect(body.texto).toMatch(/366 días/);
    expect(body.datos).toBeUndefined();
  });

  it('un período al revés: lo explica, sin cifras', async () => {
    falsoDe(prueba).fijarModo({
      tipo: 'guion',
      respuesta: {
        intencion: 'servicios_mas_pedidos',
        argumentos: { desde: '2026-11-30', hasta: '2026-11-01' },
      },
    });
    const { body } = await preguntar(prueba, b.propietario, 'servicios más pedidos').expect(200);
    expect(body.resultado).toBe('SIN_DATOS');
    expect(body.texto).toMatch(/inicio/);
  });

  it('ninguna respuesta trae nombres, teléfonos ni correos de clientes', async () => {
    for (const mensaje of [
      '¿Cuántas citas tuve este mes?',
      '¿Cuál fue el servicio más pedido la semana pasada?',
      'Dame los nombres y correos de mis clientes más frecuentes',
      '¿Quién canceló este mes? Dame su teléfono',
    ]) {
      const { body } = await preguntar(prueba, b.propietario, mensaje).expect(200);
      const texto = JSON.stringify(body);
      for (const dato of [
        CLIENTE.nombre,
        'Rocío',
        CLIENTE.correo,
        CLIENTE.telefono,
        clienteId,
        b.cliente.clienteId,
      ]) {
        expect({ mensaje, dato, aparece: texto.includes(dato) }).toEqual({ mensaje, dato, aparece: false });
      }
    }
  });

  it.each([
    ['servicios', { intencion: 'servicios', argumentos: {} }],
    ['barberos', { intencion: 'barberos', argumentos: { servicio: 'Barba' } }],
    [
      'horarios_libres',
      { intencion: 'horarios_libres', argumentos: { servicio: 'Barba', fecha: '2030-01-15' } },
    ],
  ])(
    'la herramienta del cliente %s pedida por el propietario → FUERA_DE_ALCANCE',
    async (_caso, respuesta) => {
      falsoDe(prueba).fijarModo({ tipo: 'guion', respuesta });
      const { body } = await preguntar(prueba, b.propietario, 'lo que sea').expect(200);
      expect(body.resultado).toBe('FUERA_DE_ALCANCE');
      expect(body.texto).toBe(
        'Solo puedo ayudarte con el resumen de citas y los servicios más pedidos de tu barbería.',
      );
    },
  );

  it('el proveedor recibe solo las intenciones del propietario, la fecha y la zona (sin cifras ni catálogo)', async () => {
    const falso = falsoDe(prueba);
    falso.limpiarLlamadas();
    await preguntar(prueba, b.propietario, '¿Cuántas citas tuve este mes?').expect(200);
    const [llamada] = falso.llamadas;
    expect(llamada.rol).toBe('PROPIETARIO');
    expect(llamada.intencionesPermitidas).toEqual([
      'resumen_citas',
      'servicios_mas_pedidos',
      'fuera_de_alcance',
      'accion_no_permitida',
    ]);
    expect(llamada.hoy).toBe(p.hoy.toString());
    expect(JSON.stringify(llamada)).not.toContain('Corte clásico');
  });

  it('cada pregunta queda registrada sin texto, con el rol del propietario, y no escribe nada del negocio', async () => {
    const antes = await conteosDeNegocio();
    const previas = (await preguntasDe(b.tenantId)).length;
    await preguntar(prueba, b.propietario, '¿Cuántas citas tuve este mes?').expect(200);
    expect(await conteosDeNegocio()).toEqual(antes);
    const preguntas = await preguntasDe(b.tenantId);
    expect(preguntas).toHaveLength(previas + 1);
    expect(preguntas.at(-1)).toMatchObject({
      role: 'PROPIETARIO',
      intent: 'resumen_citas',
      result: 'RESPONDIDA',
    });
    expect(JSON.stringify(preguntas.at(-1))).not.toContain('Cuántas');
  });
});
