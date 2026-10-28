import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { paginaDeCheckout } from './checkout';
import { EstadoSimulador, type Sesion } from './estado';
import { ENCABEZADO_FIRMA, firmar } from './firma';
import { leerModo, type Modo, MODO_NORMAL } from './modos';

// Simulador de la pasarela de pagos (ADR-022, research R02; contrato en
// specs/003-suscripciones-pagos/contracts/pasarela-simulada.md). Proceso aparte, con node:http y
// node:crypto, sin dependencias. NO es parte del monolito (ningún archivo de src/ lo importa, regla de PR14)
// y NUNCA se despliega en producción. Se inicia en el proceso de las pruebas con iniciarSimulador() o como
// servicio de Docker Compose (`npm run simulador`).

export interface OpcionesSimulador {
  puerto: number;
  /** 127.0.0.1 por defecto; Docker Compose usa 0.0.0.0. */
  host?: string;
  secretoFirma: string;
  llaveSecreta: string;
  tokenControl: string;
  urlNotificaciones: string;
  /** Vida de una sesión de pago (30 min, como un proveedor real). */
  vidaSesionMs?: number;
  /** Espera antes del primer reintento de una notificación; luego se duplica (1, 2, 4, 8 y 16 s). */
  esperaReintentoMs?: number;
  /** Intentos de cada notificación mientras la plataforma no responda 2xx (5). */
  intentos?: number;
  /**
   * Teléfono del pagador que se agrega a cada notificación, como podría hacerlo un proveedor real. La
   * plataforma debe descartarlo (FR-013b); las pruebas de datos canario lo usan.
   */
  telefonoPagador?: string;
}

export interface SolicitudRegistrada {
  metodo: string;
  ruta: string;
  en: Date;
}

export interface Simulador {
  url: string;
  puerto: number;
  cambiarModo(modo: Modo): Promise<void>;
  /** Adónde se envían las notificaciones desde ahora (p. ej. la aplicación de prueba ya iniciada). */
  cambiarDestino(urlNotificaciones: string): void;
  reiniciar(): Promise<void>;
  /** Solicitudes recibidas en la API /v1 (no las de control ni las del checkout). */
  solicitudes(): readonly SolicitudRegistrada[];
  /** Espera a que terminen las notificaciones en curso (pruebas). */
  esperarNotificaciones(): Promise<void>;
  cerrar(): Promise<void>;
}

/** Montos de Yape que acepta el simulador (R15: el proveedor real se verifica con su ambiente de pruebas). */
export const LIMITES_YAPE = { minimoCentimos: 600, maximoCentimos: 50_000 };

const MAX_CUERPO = 16 * 1024;
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

function iguales(recibido: string | undefined, esperado: string): boolean {
  const a = Buffer.from(recibido ?? '');
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

class ErrorHttp extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
  ) {
    super(codigo);
  }
}

async function leerJson(solicitud: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of solicitud) {
    total += (parte as Buffer).length;
    if (total > MAX_CUERPO) throw new ErrorHttp(413, 'CUERPO_DEMASIADO_GRANDE');
    partes.push(parte as Buffer);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErrorHttp(400, 'JSON_INVALIDO');
  }
}

function responderJson(respuesta: ServerResponse, estado: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  respuesta.writeHead(estado, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(texto),
  });
  respuesta.end(texto);
}

/** Estado informado a la plataforma: una sesión cancelada se cerró sin pago, como una vencida. */
function estadoParaLaPlataforma(estado: string): string {
  return estado === 'CANCELADO' ? 'EXPIRADO' : estado;
}

export async function iniciarSimulador(opciones: OpcionesSimulador): Promise<Simulador> {
  const host = opciones.host ?? '127.0.0.1';
  const estado = new EstadoSimulador(opciones.vidaSesionMs ?? 30 * 60 * 1000);
  const esperaReintentoMs = opciones.esperaReintentoMs ?? 1000;
  const intentos = opciones.intentos ?? 5;
  let modo: Modo = MODO_NORMAL;
  const registro: SolicitudRegistrada[] = [];
  const enVuelo = new Set<Promise<void>>();
  const colgadas = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const temporizadores = new Set<NodeJS.Timeout>();
  let escuchando = false;
  let cerrado = false;
  let puerto = opciones.puerto;
  let urlNotificaciones = opciones.urlNotificaciones;

  const programar = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      temporizadores.delete(t);
      fn();
    }, ms);
    temporizadores.add(t);
  };

  // --- Notificaciones firmadas con reintentos (contrato §4) ---

  async function enviar(cuerpo: string): Promise<void> {
    for (let intento = 0; intento < intentos && !cerrado; intento += 1) {
      if (intento > 0) await esperar(esperaReintentoMs * 2 ** (intento - 1));
      const encabezados: Record<string, string> = { 'Content-Type': 'application/json' };
      const t = Math.floor(Date.now() / 1000);
      if (modo.modo === 'firma_invalida')
        encabezados[ENCABEZADO_FIRMA] = firmar(`${opciones.secretoFirma}-otra`, cuerpo, t);
      else if (modo.modo !== 'sin_firma')
        encabezados[ENCABEZADO_FIRMA] = firmar(opciones.secretoFirma, cuerpo, t);
      try {
        const respuesta = await fetch(urlNotificaciones, {
          method: 'POST',
          headers: encabezados,
          body: cuerpo,
          signal: AbortSignal.timeout(5000),
        });
        await respuesta.arrayBuffer();
        if (respuesta.ok) return;
      } catch {
        // La plataforma no respondió: se reintenta, como un proveedor real.
      }
    }
  }

  function cuerpoDeNotificacion(
    sesion: Sesion,
    estadoNotificado: string,
    extra: { emitidoEn?: Date } = {},
  ): string {
    const importe =
      modo.modo === 'importe_distinto' ? Math.max(1, sesion.importeCentimos - 100) : sesion.importeCentimos;
    return JSON.stringify({
      evento_id: `evt_${randomUUID().replace(/-/g, '')}`,
      tipo: 'pago.actualizado',
      referencia: sesion.referencia,
      estado: estadoNotificado,
      importe_centimos: importe,
      moneda: sesion.moneda,
      emitido_en: (extra.emitidoEn ?? new Date()).toISOString(),
      ...(opciones.telefonoPagador ? { pagador: { telefono: opciones.telefonoPagador } } : {}),
    });
  }

  function notificar(sesion: Sesion, estadoNotificado: string): void {
    const tarea = (async () => {
      if (modo.modo === 'lento') await esperar(modo.retardoMs ?? 0);
      const cuerpo = cuerpoDeNotificacion(sesion, estadoNotificado);
      const veces = modo.modo === 'duplicar' ? (modo.veces ?? 2) : 1;
      for (let i = 0; i < veces; i += 1) await enviar(cuerpo);
      if (modo.modo === 'fuera_de_orden' && estadoNotificado === 'APROBADO') {
        // Un PENDIENTE atrasado, emitido antes de la aprobación.
        await enviar(cuerpoDeNotificacion(sesion, 'PENDIENTE', { emitidoEn: sesion.creadaEn }));
      }
    })();
    enVuelo.add(tarea);
    void tarea.finally(() => enVuelo.delete(tarea));
  }

  /** Decide una sesión. `forzar`: aprueba aunque la plataforma ya la haya cancelado (aprobar_despues). */
  function decidir(
    sesion: Sesion,
    accion: 'aprobar' | 'rechazar' | 'devolver',
    { notificar: avisar = true, forzar = false } = {},
  ): void {
    const visible = estado.estadoVisible(sesion);
    if (accion === 'devolver') {
      if (sesion.estado !== 'APROBADO' || sesion.devuelta) throw new ErrorHttp(409, 'NO_SE_PUEDE_DEVOLVER');
      sesion.devuelta = true;
      if (avisar) notificar(sesion, 'DEVUELTO');
      return;
    }
    const decidible = visible === 'PENDIENTE' || (forzar && sesion.estado !== 'APROBADO');
    if (!decidible) throw new ErrorHttp(409, 'SESION_NO_PENDIENTE');
    sesion.estado = accion === 'aprobar' && modo.modo !== 'rechazar' ? 'APROBADO' : 'RECHAZADO';
    if (avisar) notificar(sesion, sesion.estado);
  }

  // --- API /v1 (Bearer PAGOS_LLAVE_SECRETA) ---

  async function api(solicitud: IncomingMessage, respuesta: ServerResponse, ruta: string): Promise<void> {
    if (!iguales(solicitud.headers.authorization, `Bearer ${opciones.llaveSecreta}`)) {
      throw new ErrorHttp(401, 'NO_AUTORIZADO');
    }
    if (modo.modo === 'colgado') {
      // Acepta la conexión y no responde nunca (para el tiempo límite).
      colgadas.add(respuesta);
      respuesta.on('close', () => colgadas.delete(respuesta));
      return;
    }
    if (modo.modo === 'lento') await esperar(modo.retardoMs ?? 0);
    const metodo = solicitud.method ?? 'GET';
    if (metodo === 'POST' && ruta === '/v1/sesiones') {
      const cuerpo = (await leerJson(solicitud)) as Record<string, unknown>;
      const { pago_id, importe_centimos, moneda, descripcion, metodo: medio, url_retorno } = cuerpo;
      if (
        typeof pago_id !== 'string' ||
        typeof importe_centimos !== 'number' ||
        !Number.isSafeInteger(importe_centimos) ||
        importe_centimos <= 0 ||
        moneda !== 'PEN' ||
        medio !== 'YAPE' ||
        typeof url_retorno !== 'string'
      ) {
        throw new ErrorHttp(400, 'SOLICITUD_INVALIDA');
      }
      if (importe_centimos < LIMITES_YAPE.minimoCentimos || importe_centimos > LIMITES_YAPE.maximoCentimos) {
        throw new ErrorHttp(422, 'IMPORTE_FUERA_DE_LIMITES');
      }
      const sesion = estado.crear({
        pagoId: pago_id,
        importeCentimos: importe_centimos,
        moneda,
        descripcion: typeof descripcion === 'string' ? descripcion.slice(0, 120) : 'Suscripción',
        urlRetorno: url_retorno,
      });
      if (modo.modo === 'rechazar') setImmediate(() => decidir(sesion, 'rechazar'));
      if (modo.modo === 'aprobar_despues') {
        programar(modo.retardoMs ?? 0, () => {
          try {
            decidir(sesion, 'aprobar', { forzar: true });
          } catch {
            // Ya estaba aprobada.
          }
        });
      }
      responderJson(respuesta, 201, {
        referencia: sesion.referencia,
        url_pago: `${direccion()}/checkout/${sesion.referencia}`,
        expira_en: sesion.expiraEn.toISOString(),
      });
      return;
    }
    const coincidencia = /^\/v1\/sesiones\/([A-Za-z0-9_]+)(\/cancelar)?$/.exec(ruta);
    const sesion = coincidencia ? estado.buscar(coincidencia[1]) : undefined;
    if (!coincidencia) throw new ErrorHttp(404, 'RUTA_DESCONOCIDA');
    if (!sesion) throw new ErrorHttp(404, 'SESION_DESCONOCIDA');
    if (metodo === 'GET' && !coincidencia[2]) {
      responderJson(respuesta, 200, {
        referencia: sesion.referencia,
        estado: estadoParaLaPlataforma(estado.estadoVisible(sesion)),
        importe_centimos: sesion.importeCentimos,
        moneda: sesion.moneda,
      });
      return;
    }
    if (metodo === 'POST' && coincidencia[2]) {
      // Con aprobar_despues el pagador ya está pagando: el proveedor no deja cancelar.
      const cancelable = estado.estadoVisible(sesion) === 'PENDIENTE' && modo.modo !== 'aprobar_despues';
      if (cancelable) sesion.estado = 'CANCELADO';
      responderJson(respuesta, 200, { cancelada: cancelable });
      return;
    }
    throw new ErrorHttp(405, 'METODO_NO_PERMITIDO');
  }

  // --- Control (X-Control: SIMULADOR_TOKEN_CONTROL) ---

  async function control(solicitud: IncomingMessage, respuesta: ServerResponse, ruta: string): Promise<void> {
    if (!iguales(headerTexto(solicitud.headers['x-control']), opciones.tokenControl)) {
      throw new ErrorHttp(401, 'NO_AUTORIZADO');
    }
    if (solicitud.method !== 'POST') throw new ErrorHttp(405, 'METODO_NO_PERMITIDO');
    const cuerpo = await leerJson(solicitud);
    if (ruta === '/control/modo') {
      let nuevo: Modo;
      try {
        nuevo = leerModo(cuerpo);
      } catch {
        throw new ErrorHttp(400, 'MODO_INVALIDO');
      }
      // Se aplica cuando la respuesta ya salió: `caido` cierra el puerto y sus conexiones.
      respuesta.once('finish', () => void cambiarModo(nuevo));
      responderJson(respuesta, 200, { modo: nuevo.modo });
      return;
    }
    if (ruta === '/control/reiniciar') {
      await reiniciar();
      responderJson(respuesta, 200, { reiniciado: true });
      return;
    }
    const coincidencia = /^\/control\/sesiones\/([A-Za-z0-9_]+)\/(aprobar|rechazar|devolver)$/.exec(ruta);
    if (!coincidencia) throw new ErrorHttp(404, 'RUTA_DESCONOCIDA');
    const sesion = estado.buscar(coincidencia[1]);
    if (!sesion) throw new ErrorHttp(404, 'SESION_DESCONOCIDA');
    const { notificar: avisar } = cuerpo as { notificar?: unknown };
    decidir(sesion, coincidencia[2] as 'aprobar' | 'rechazar' | 'devolver', { notificar: avisar !== false });
    responderJson(respuesta, 200, {
      referencia: sesion.referencia,
      estado: estadoParaLaPlataforma(estado.estadoVisible(sesion)),
    });
  }

  // --- Checkout alojado ---

  async function checkout(
    solicitud: IncomingMessage,
    respuesta: ServerResponse,
    ruta: string,
  ): Promise<void> {
    const coincidencia = /^\/checkout\/([A-Za-z0-9_]+)(?:\/(aprobar|rechazar|pendiente))?$/.exec(ruta);
    const sesion = coincidencia ? estado.buscar(coincidencia[1]) : undefined;
    if (!coincidencia || !sesion) throw new ErrorHttp(404, 'SESION_DESCONOCIDA');
    const accion = coincidencia[2];
    if (solicitud.method === 'GET' && !accion) {
      const html = paginaDeCheckout(sesion, estado.estadoVisible(sesion));
      respuesta.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      respuesta.end(html);
      return;
    }
    if (solicitud.method !== 'POST' || !accion) throw new ErrorHttp(405, 'METODO_NO_PERMITIDO');
    if (accion !== 'pendiente' && estado.estadoVisible(sesion) === 'PENDIENTE') {
      decidir(sesion, accion as 'aprobar' | 'rechazar');
    }
    const destino = new URL(sesion.urlRetorno);
    destino.searchParams.set('pago', sesion.pagoId);
    respuesta.writeHead(303, { Location: destino.toString() });
    respuesta.end();
  }

  const servidor: Server = createServer((solicitud, respuesta) => {
    const ruta = new URL(solicitud.url ?? '/', 'http://simulador').pathname;
    const manejar = async () => {
      if (ruta.startsWith('/v1/')) {
        registro.push({ metodo: solicitud.method ?? 'GET', ruta, en: new Date() });
        return api(solicitud, respuesta, ruta);
      }
      if (ruta.startsWith('/control/')) return control(solicitud, respuesta, ruta);
      if (ruta.startsWith('/checkout/')) return checkout(solicitud, respuesta, ruta);
      if (ruta === '/salud') return responderJson(respuesta, 200, { estado: 'ok', modo: modo.modo });
      throw new ErrorHttp(404, 'RUTA_DESCONOCIDA');
    };
    manejar().catch((error: unknown) => {
      if (respuesta.headersSent) return;
      const { estado: codigoHttp, codigo } =
        error instanceof ErrorHttp ? error : { estado: 500, codigo: 'ERROR_INTERNO' };
      responderJson(respuesta, codigoHttp, { codigo });
    });
  });
  servidor.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  function direccion(): string {
    return `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${puerto}`;
  }

  function escuchar(): Promise<void> {
    return new Promise((resolver, rechazar) => {
      servidor.once('error', rechazar);
      servidor.listen(puerto, host, () => {
        servidor.off('error', rechazar);
        puerto = (servidor.address() as AddressInfo).port;
        escuchando = true;
        resolver();
      });
    });
  }

  function dejarDeEscuchar(): Promise<void> {
    if (!escuchando) return Promise.resolve();
    escuchando = false;
    return new Promise((resolver) => {
      servidor.close(() => resolver());
      for (const r of colgadas) r.destroy();
      for (const socket of sockets) socket.destroy();
    });
  }

  function soltarColgadas(): void {
    for (const r of colgadas) r.destroy();
    colgadas.clear();
  }

  async function cambiarModo(nuevo: Modo): Promise<void> {
    modo = nuevo;
    if (nuevo.modo !== 'colgado') soltarColgadas();
    if (nuevo.modo === 'caido') {
      // Cierra el puerto: conexión rechazada, como un proveedor caído.
      await dejarDeEscuchar();
      if (nuevo.duracionMs !== undefined) programar(nuevo.duracionMs, () => void cambiarModo(MODO_NORMAL));
      return;
    }
    if (!escuchando && !cerrado) await escuchar();
  }

  async function reiniciar(): Promise<void> {
    estado.reiniciar();
    registro.length = 0;
    await cambiarModo(MODO_NORMAL);
  }

  await escuchar();

  return {
    get url() {
      return direccion();
    },
    get puerto() {
      return puerto;
    },
    cambiarModo,
    cambiarDestino: (url: string) => {
      urlNotificaciones = url;
    },
    reiniciar,
    solicitudes: () => [...registro],
    esperarNotificaciones: async () => {
      while (enVuelo.size > 0) await Promise.allSettled([...enVuelo]);
    },
    cerrar: async () => {
      cerrado = true;
      for (const t of temporizadores) clearTimeout(t);
      temporizadores.clear();
      soltarColgadas();
      await dejarDeEscuchar();
      await Promise.allSettled([...enVuelo]);
    },
  };
}

function headerTexto(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

// Arranque por línea de comandos (Docker Compose o `npm run simulador`).
if (require.main === module) {
  iniciarSimulador({
    puerto: Number(process.env.PUERTO ?? 3100),
    host: '0.0.0.0',
    secretoFirma: requerida('PAGOS_SECRETO_FIRMA'),
    llaveSecreta: requerida('PAGOS_LLAVE_SECRETA'),
    tokenControl: requerida('SIMULADOR_TOKEN_CONTROL'),
    urlNotificaciones: requerida('PAGOS_URL_NOTIFICACIONES'),
  })
    .then((simulador) => {
      // Sin secretos en el registro.
      console.log(
        `Pasarela simulada escuchando en el puerto ${simulador.puerto} (solo desarrollo y pruebas)`,
      );
    })
    .catch((error: unknown) => {
      console.error(
        `No se pudo iniciar la pasarela simulada: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    });
}
