import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { EstadoSimuladorWhatsapp, type MensajeSimulado } from './estado';
import { leerModo, type Modo, MODO_NORMAL } from './modos';

// T112 de 004 · Simulador de WhatsApp (ADR-026, research R11; contracts/notification-channel.md §3). Proceso aparte,
// con node:http y sin dependencias. NO es parte del monolito (ninguna parte de src/ lo importa, regla
// simulador-whatsapp-fuera-del-monolito de PR14) y NUNCA se despliega en producción: no habla con ningún
// proveedor real ni usa credenciales reales. Se inicia en el proceso de las pruebas con iniciarSimuladorWhatsapp()
// o como servicio de Docker Compose (`npm run whatsapp-simulado`).
//
//   POST /mensajes            Bearer <token>; { para, texto } con Idempotency-Key → { id } (201; 200 si se repite)
//   GET  /mensajes?para=      X-Control: <token de control> → { mensajes }
//   POST /control/modo        X-Control → cambia el comportamiento (modos.ts)
//   POST /control/reiniciar   X-Control → borra los mensajes y vuelve a normal
//
// No registra el texto ni el número de ningún mensaje: solo el arranque.

export type { MensajeSimulado } from './estado';

export interface OpcionesSimuladorWhatsapp {
  puerto: number;
  /** 127.0.0.1 por defecto; Docker Compose usa 0.0.0.0. */
  host?: string;
  /** Token de envío (WHATSAPP_TOKEN de la plataforma). */
  token: string;
  /** Token de las rutas /control/* y de la consulta de mensajes. */
  tokenControl: string;
}

export interface SimuladorWhatsapp {
  url: string;
  puerto: number;
  cambiarModo(modo: Modo): void;
  reiniciar(): void;
  /** Solicitudes de envío (POST /mensajes) que llegaron, en cualquier modo, también las cortadas en `caido`. */
  conexiones(): number;
  todos(): MensajeSimulado[];
  cerrar(): Promise<void>;
}

const MAX_CUERPO = 16 * 1024;
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

function iguales(recibido: string | undefined, esperado: string): boolean {
  const a = Buffer.from(recibido ?? '');
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const encabezado = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

async function leerCuerpo(solicitud: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of solicitud) {
    total += (parte as Buffer).length;
    if (total > MAX_CUERPO) throw new Error('cuerpo demasiado grande');
    partes.push(parte as Buffer);
  }
  return Buffer.concat(partes).toString('utf8');
}

function responder(
  respuesta: ServerResponse,
  estado: number,
  cuerpo?: unknown,
  extra: Record<string, string> = {},
) {
  if (cuerpo === undefined) {
    respuesta.writeHead(estado, extra).end();
    return;
  }
  respuesta
    .writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', ...extra })
    .end(JSON.stringify(cuerpo));
}

export async function iniciarSimuladorWhatsapp(
  opciones: OpcionesSimuladorWhatsapp,
): Promise<SimuladorWhatsapp> {
  const estado = new EstadoSimuladorWhatsapp();
  let modo: Modo = MODO_NORMAL;
  let fallosRestantes = 0;
  let envios = 0;
  let temporizador: NodeJS.Timeout | undefined;
  const colgadas = new Set<ServerResponse>();
  const sockets = new Set<Socket>();

  function cambiarModo(nuevo: Modo): void {
    modo = nuevo;
    fallosRestantes = nuevo.modo === 'fallar_n' ? (nuevo.veces ?? 1) : 0;
    clearTimeout(temporizador);
    if (nuevo.modo !== 'colgado') {
      for (const r of colgadas) r.socket?.destroy();
      colgadas.clear();
    }
    if (nuevo.modo === 'caido' && nuevo.duracionMs !== undefined) {
      temporizador = setTimeout(() => cambiarModo(MODO_NORMAL), nuevo.duracionMs);
      temporizador.unref();
    }
  }

  async function enviar(solicitud: IncomingMessage, respuesta: ServerResponse): Promise<void> {
    envios += 1;
    // Caído: corta la conexión sin responder, como un proveedor que no está.
    if (modo.modo === 'caido') {
      solicitud.socket.destroy();
      return;
    }
    const autorizacion = encabezado(solicitud.headers.authorization) ?? '';
    if (
      !iguales(autorizacion.replace(/^Bearer /, ''), opciones.token) ||
      !autorizacion.startsWith('Bearer ')
    ) {
      responder(respuesta, 401, { codigo: 'NO_AUTORIZADO' });
      return;
    }
    if (modo.modo === 'colgado') {
      colgadas.add(respuesta);
      return;
    }
    if (modo.modo === 'lento') await esperar(modo.retardoMs ?? 5000);
    if (modo.modo === 'rechazar') {
      responder(respuesta, 400, { codigo: 'NUMERO_INVALIDO' });
      return;
    }
    if (modo.modo === 'limite') {
      responder(respuesta, 429, { codigo: 'DEMASIADOS_MENSAJES' }, { 'Retry-After': '60' });
      return;
    }
    if (modo.modo === 'fallar_n' && fallosRestantes > 0) {
      fallosRestantes -= 1;
      responder(respuesta, 503, { codigo: 'FALLA_SIMULADA' });
      return;
    }

    const clave = encabezado(solicitud.headers['idempotency-key']);
    let datos: { para?: unknown; texto?: unknown };
    try {
      datos = JSON.parse(await leerCuerpo(solicitud)) as { para?: unknown; texto?: unknown };
    } catch {
      responder(respuesta, 400, { codigo: 'CUERPO_INVALIDO' });
      return;
    }
    if (!clave || typeof datos.para !== 'string' || typeof datos.texto !== 'string') {
      responder(respuesta, 400, { codigo: 'CUERPO_INVALIDO' });
      return;
    }
    const tipo = encabezado(solicitud.headers['content-type']) ?? '';
    const { mensaje, repetido } = estado.aceptar({
      para: datos.para,
      texto: datos.texto,
      claveIdempotencia: clave,
      charsetUtf8: /charset=utf-8/i.test(tipo),
    });
    responder(respuesta, repetido ? 200 : 201, { id: mensaje.id });
  }

  async function atender(solicitud: IncomingMessage, respuesta: ServerResponse): Promise<void> {
    const url = new URL(solicitud.url ?? '/', 'http://simulador');
    if (solicitud.method === 'POST' && url.pathname === '/mensajes') return enviar(solicitud, respuesta);

    // Consulta y control: con el token de control.
    if (!iguales(encabezado(solicitud.headers['x-control']), opciones.tokenControl)) {
      responder(respuesta, 401, { codigo: 'NO_AUTORIZADO' });
      return;
    }
    if (solicitud.method === 'GET' && url.pathname === '/mensajes') {
      const para = url.searchParams.get('para');
      responder(respuesta, 200, { mensajes: para ? estado.para(para) : estado.todos() });
      return;
    }
    if (solicitud.method === 'POST' && url.pathname === '/control/modo') {
      try {
        const nuevo = leerModo(JSON.parse((await leerCuerpo(solicitud)) || '{}'));
        cambiarModo(nuevo);
        responder(respuesta, 200, { modo: nuevo.modo });
      } catch (error) {
        responder(respuesta, 400, {
          codigo: 'MODO_INVALIDO',
          mensaje: error instanceof Error ? error.message : '',
        });
      }
      return;
    }
    if (solicitud.method === 'POST' && url.pathname === '/control/reiniciar') {
      estado.reiniciar();
      envios = 0;
      cambiarModo(MODO_NORMAL);
      responder(respuesta, 204);
      return;
    }
    responder(respuesta, 404, { codigo: 'NO_ENCONTRADO' });
  }

  const servidor: Server = createServer((solicitud, respuesta) => {
    atender(solicitud, respuesta).catch(() => {
      if (!respuesta.headersSent) responder(respuesta, 500, { codigo: 'ERROR_DEL_SIMULADOR' });
    });
  });
  servidor.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolver) =>
    servidor.listen(opciones.puerto, opciones.host ?? '127.0.0.1', resolver),
  );
  const { port } = servidor.address() as AddressInfo;
  const host = opciones.host && opciones.host !== '0.0.0.0' ? opciones.host : '127.0.0.1';

  return {
    url: `http://${host}:${port}`,
    puerto: port,
    cambiarModo,
    reiniciar: () => {
      estado.reiniciar();
      envios = 0;
      cambiarModo(MODO_NORMAL);
    },
    conexiones: () => envios,
    todos: () => estado.todos(),
    cerrar: async () => {
      clearTimeout(temporizador);
      for (const r of colgadas) r.socket?.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
    },
  };
}

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

// Arranque por línea de comandos (Docker Compose o `npm run whatsapp-simulado`).
if (require.main === module) {
  iniciarSimuladorWhatsapp({
    puerto: Number(process.env.PUERTO ?? 3200),
    host: '0.0.0.0',
    token: requerida('WHATSAPP_TOKEN'),
    tokenControl: requerida('WHATSAPP_TOKEN_CONTROL'),
  })
    .then((simulador) => {
      // Sin tokens ni mensajes en el registro.
      console.log(
        `WhatsApp simulado escuchando en el puerto ${simulador.puerto} (solo desarrollo y pruebas)`,
      );
    })
    .catch((error: unknown) => {
      console.error(
        `No se pudo iniciar el WhatsApp simulado: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    });
}
