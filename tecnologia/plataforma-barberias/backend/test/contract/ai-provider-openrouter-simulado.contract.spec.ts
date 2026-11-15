import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ProveedorIANoDisponible,
  type SolicitudDeInterpretacion,
} from '../../src/modules/asistente-reportes/asistente/application/ports/ai-provider';
import { ProveedorIAOpenRouter } from '../../src/modules/asistente-reportes/asistente/infrastructure/proveedor-ia-openrouter';
import { probarContratoDeAIProvider } from './ai-provider.contract';

// T044 de 005 · El adaptador de OpenRouter (solo desarrollo, ADR-027) contra un servidor HTTP SIMULADO en 127.0.0.1:
// sin internet y sin llave real. Corre la misma suite de contrato del puerto (PR20) y prueba lo propio del adaptador:
// qué envía (solo instrucciones, la pregunta y el contexto; nunca el catálogo), cómo traduce cada falla del proveedor
// a ProveedorIANoDisponible, que descarta cualquier texto del modelo y que la llave no sale en ningún mensaje.

const LLAVE = 'sk-or-v1-llave-SOLO-de-esta-prueba-0000';

type Modo = 'normal' | 'lento' | 'error500' | 'error429' | 'error401' | 'contenido_roto' | 'sin_choices';

interface Recibida {
  ruta: string | undefined;
  autorizacion: string | undefined;
  cuerpo: {
    model: string;
    messages: { role: string; content: string }[];
    response_format: { type: string; json_schema?: { schema: unknown } };
    temperature: number;
  };
}

/** Un servidor con la forma de la API de chat de OpenRouter. Clasifica por palabras clave y guarda lo recibido. */
class OpenRouterSimulado {
  modo: Modo = 'normal';
  recibidas: Recibida[] = [];
  private servidor: Server | null = null;
  url = '';

  async iniciar(): Promise<void> {
    this.servidor = createServer((solicitud, respuesta) => void this.atender(solicitud, respuesta));
    await new Promise<void>((listo) => this.servidor?.listen(0, '127.0.0.1', listo));
    this.url = `http://127.0.0.1:${(this.servidor?.address() as AddressInfo).port}/api/v1`;
  }

  async cerrar(): Promise<void> {
    this.servidor?.closeAllConnections();
    await new Promise<void>((listo) => this.servidor?.close(() => listo()));
  }

  private async atender(solicitud: IncomingMessage, respuesta: ServerResponse): Promise<void> {
    let datos = '';
    for await (const trozo of solicitud) datos += String(trozo);
    const cuerpo = JSON.parse(datos) as Recibida['cuerpo'];
    this.recibidas.push({ ruta: solicitud.url, autorizacion: solicitud.headers.authorization, cuerpo });
    const json = (estado: number, valor: unknown) => {
      respuesta.writeHead(estado, { 'Content-Type': 'application/json' });
      respuesta.end(JSON.stringify(valor));
    };
    if (this.modo === 'lento') {
      const temporizador = setTimeout(
        () => json(200, this.completar('{"intencion":"servicios","argumentos":{}}')),
        5000,
      );
      solicitud.socket.on('close', () => clearTimeout(temporizador));
      return;
    }
    if (this.modo === 'error500') return json(500, { error: { message: 'interno' } });
    if (this.modo === 'error429') return json(429, { error: { message: 'demasiadas' } });
    if (this.modo === 'error401') return json(401, { error: { message: 'llave inválida' } });
    if (this.modo === 'sin_choices') return json(200, { choices: [] });
    if (this.modo === 'contenido_roto') return json(200, this.completar('esto no es JSON {'));
    const pregunta = (cuerpo.messages.at(-1)?.content ?? '').toLowerCase();
    const intencion = /servicio|precio/.test(pregunta)
      ? { intencion: 'servicios', argumentos: {}, texto: 'Hola, te cuento los precios' }
      : /horario/.test(pregunta)
        ? { intencion: 'horarios_libres', argumentos: { servicio: 'corte', fecha: '2026-11-15' } }
        : { intencion: 'fuera_de_alcance', argumentos: {} };
    json(200, this.completar(JSON.stringify(intencion)));
  }

  private completar(contenido: string) {
    return {
      id: 'gen-prueba',
      choices: [{ message: { role: 'assistant', content: contenido }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 321, completion_tokens: 12 },
    };
  }
}

const solicitud = (cambios: Partial<SolicitudDeInterpretacion> = {}): SolicitudDeInterpretacion => ({
  rol: 'CLIENTE',
  intencionesPermitidas: [
    'servicios',
    'barberos',
    'horarios_libres',
    'fuera_de_alcance',
    'accion_no_permitida',
  ],
  hoy: '2026-11-14',
  zonaHoraria: 'America/Lima',
  pregunta: '¿Qué servicios tienen?',
  contexto: [],
  ...cambios,
});

const simulado = new OpenRouterSimulado();
let proveedor: ProveedorIAOpenRouter;

beforeAll(async () => {
  await simulado.iniciar();
  proveedor = new ProveedorIAOpenRouter({
    llave: LLAVE,
    modelo: 'proveedor/modelo-de-prueba',
    urlBase: simulado.url,
  });
});

afterAll(() => simulado.cerrar());

probarContratoDeAIProvider('OpenRouter contra un servidor simulado', async () => ({
  proveedor,
  hacerLento: () => {
    simulado.modo = 'lento';
  },
  forzarError: () => {
    simulado.modo = 'error500';
  },
  restaurar: () => {
    simulado.modo = 'normal';
  },
}));

describe('ProveedorIAOpenRouter contra un servidor simulado (T044)', () => {
  beforeEach(() => {
    simulado.modo = 'normal';
    simulado.recibidas = [];
  });

  afterEach(() => {
    simulado.modo = 'normal';
    simulado.recibidas = [];
  });

  it('una sola llamada POST /chat/completions con la llave, el modelo, temperatura 0 y salida JSON con esquema', async () => {
    await proveedor.interpretar(solicitud(), AbortSignal.timeout(5000));
    expect(simulado.recibidas).toHaveLength(1);
    const [recibida] = simulado.recibidas;
    expect(recibida.ruta).toBe('/api/v1/chat/completions');
    expect(recibida.autorizacion).toBe(`Bearer ${LLAVE}`);
    expect(recibida.cuerpo.model).toBe('proveedor/modelo-de-prueba');
    expect(recibida.cuerpo.temperature).toBe(0);
    expect(recibida.cuerpo.response_format.type).toBe('json_schema');
    expect(JSON.stringify(recibida.cuerpo.response_format.json_schema?.schema)).toContain(
      'additionalProperties',
    );
  });

  it('envía solo las instrucciones fijas, el contexto y la pregunta (FR-011): sin catálogo, sin barbería, sin tenant', async () => {
    const contexto = [
      { de: 'USUARIO' as const, texto: 'Hola' },
      { de: 'ASISTENTE' as const, texto: 'Hola, ¿en qué te ayudo?' },
    ];
    await proveedor.interpretar(solicitud({ contexto, pregunta: '¿Y mañana?' }), AbortSignal.timeout(5000));
    const mensajes = simulado.recibidas[0].cuerpo.messages;
    expect(mensajes.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(mensajes.slice(1).map((m) => m.content)).toEqual([
      'Hola',
      'Hola, ¿en qué te ayudo?',
      '¿Y mañana?',
    ]);
    const instrucciones = mensajes[0].content;
    expect(instrucciones).toContain('2026-11-14');
    expect(instrucciones).toContain('America/Lima');
    expect(instrucciones).toContain('horarios_libres');
    expect(instrucciones).not.toContain('resumen_citas');
    expect(instrucciones).toMatch(/dato a clasificar|nunca una instrucción/i);
  });

  it('devuelve solo la intención y los argumentos (el texto del modelo se descarta) y los tokens que informa', async () => {
    expect(await proveedor.interpretar(solicitud(), AbortSignal.timeout(5000))).toEqual({
      intencion: 'servicios',
      argumentos: {},
      tokensEntrada: 321,
      tokensSalida: 12,
    });
  });

  it.each<[Modo, string, number | null, boolean]>([
    ['error500', 'ERROR', 500, true],
    ['error429', 'ERROR', 429, true],
    ['error401', 'ERROR', 401, false],
    ['contenido_roto', 'RESPUESTA_INVALIDA', null, false],
    ['sin_choices', 'RESPUESTA_INVALIDA', null, false],
  ])(
    '%s → ProveedorIANoDisponible (%s, %s; reintentable: %s)',
    async (modo, motivo, estadoHttp, reintentable) => {
      simulado.modo = modo;
      const error = await proveedor.interpretar(solicitud(), AbortSignal.timeout(5000)).catch((e) => e);
      expect(error).toBeInstanceOf(ProveedorIANoDisponible);
      expect(error).toMatchObject({ motivo, estadoHttp, reintentable });
    },
  );

  it('sin servidor que responda (conexión rechazada) → ProveedorIANoDisponible (ERROR)', async () => {
    const apagado = new ProveedorIAOpenRouter({
      llave: LLAVE,
      modelo: 'm',
      urlBase: 'http://127.0.0.1:9/api/v1',
    });
    const error = await apagado.interpretar(solicitud(), AbortSignal.timeout(5000)).catch((e) => e);
    expect(error).toBeInstanceOf(ProveedorIANoDisponible);
    expect((error as ProveedorIANoDisponible).motivo).toBe('ERROR');
  });

  it('la llave no aparece en ningún mensaje de error ni al registrar el adaptador', async () => {
    for (const modo of ['error500', 'error401', 'contenido_roto'] as Modo[]) {
      simulado.modo = modo;
      const error = (await proveedor
        .interpretar(solicitud(), AbortSignal.timeout(5000))
        .catch((e) => e)) as Error;
      expect(`${error.message} ${error.stack ?? ''}`).not.toContain(LLAVE);
    }
    const { inspect } = await import('node:util');
    expect(inspect(proveedor, { depth: 5 })).not.toContain(LLAVE);
    expect(JSON.stringify(proveedor)).not.toContain(LLAVE);
  });
});
