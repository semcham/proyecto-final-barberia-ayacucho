import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === '') {
    throw new Error(`Falta la variable de entorno obligatoria ${nombre}`);
  }
  return valor;
}

function entero(nombre: string, porDefecto: number): number {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`La variable de entorno ${nombre} debe ser un entero positivo`);
  }
  return numero;
}

function enteroEnRango(nombre: string, porDefecto: number, minimo: number, maximo: number): number {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`La variable de entorno ${nombre} debe ser un entero entre ${minimo} y ${maximo}`);
  }
  return numero;
}

function pasoDeHorarios(nombre: string, porDefecto: number): number {
  const numero = enteroEnRango(nombre, porDefecto, 5, 60);
  if (60 % numero !== 0) {
    throw new Error(`La variable de entorno ${nombre} debe ser un divisor de 60`);
  }
  return numero;
}

/** Valor opcional: ausente o vacío equivale a no definido. */
function opcional(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor === undefined || valor.trim() === '' ? undefined : valor.trim();
}

function booleano(nombre: string, porDefecto: boolean): boolean {
  const valor = opcional(nombre);
  if (valor === undefined) return porDefecto;
  if (valor !== 'true' && valor !== 'false') {
    throw new Error(`La variable de entorno ${nombre} debe ser true o false`);
  }
  return valor === 'true';
}

function urlRedis(nombre: string): string | undefined {
  const valor = opcional(nombre);
  if (valor === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`La variable de entorno ${nombre} debe ser una URL redis:// o rediss://`);
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`La variable de entorno ${nombre} debe ser una URL redis:// o rediss://`);
  }
  return valor;
}

// Palabras que Express entiende en `trust proxy`, además de IP y subredes (R04 de 006).
const PROXIES_CON_NOMBRE = new Set(['loopback', 'linklocal', 'uniquelocal']);

function proxyValido(valor: string): boolean {
  if (PROXIES_CON_NOMBRE.has(valor)) return true;
  const [ip, prefijo, ...resto] = valor.split('/');
  const version = isIP(ip);
  if (version === 0 || resto.length > 0) return false;
  if (prefijo === undefined) return true;
  const bits = Number(prefijo);
  return /^\d{1,3}$/.test(prefijo) && bits <= (version === 4 ? 32 : 128);
}

/** Proxies de confianza para X-Forwarded-For: lista de palabras de Express, IP o subredes. */
function proxies(nombre: string, porDefecto: string): string[] {
  const lista = (opcional(nombre) ?? porDefecto).split(',').map((parte) => parte.trim());
  if (!lista.every(proxyValido)) {
    throw new Error(
      `La variable de entorno ${nombre} debe ser una lista de IP, subredes o loopback/linklocal/uniquelocal`,
    );
  }
  return lista;
}

function identificador(nombre: string): string | undefined {
  const valor = opcional(nombre);
  if (valor !== undefined && !/^[a-z0-9-]{1,32}$/.test(valor)) {
    throw new Error(`La variable de entorno ${nombre} debe tener de 1 a 32 caracteres a-z, 0-9 o "-"`);
  }
  return valor;
}

// Los PEM pueden venir en una sola línea con "\n" literales (formato de .env).
function pem(valor: string): string {
  return valor.replace(/\\n/g, '\n');
}

/**
 * Configuración leída de variables de entorno (secretos fuera del código, EQ-11).
 * Se lee al construir la instancia para que las pruebas puedan fijar el entorno antes.
 */
@Injectable()
export class Configuracion {
  readonly databaseUrlApp = requerida('DATABASE_URL_APP');
  /** Rol barberias_publico: lecturas públicas por enlace (ADR-021). */
  readonly databaseUrlPublico = requerida('DATABASE_URL_PUBLICO');
  readonly horarios = {
    /** Paso entre horas de inicio ofrecidas (R08): divisor de 60, de 5 a 60 minutos. */
    pasoMinutos: pasoDeHorarios('HORARIOS_PASO_MINUTOS', 15),
    /** Días hacia adelante en los que se puede reservar (R08). */
    horizonteDias: enteroEnRango('RESERVA_HORIZONTE_DIAS', 30, 1, 90),
  };
  readonly jwt = {
    clavePrivada: pem(requerida('JWT_PRIVATE_KEY')),
    clavesPublicas: Object.fromEntries(
      Object.entries(JSON.parse(requerida('JWT_PUBLIC_KEYS')) as Record<string, string>).map(
        ([kid, clave]) => [kid, pem(clave)],
      ),
    ),
    kidActivo: requerida('JWT_ACTIVE_KID'),
    emisor: requerida('JWT_ISSUER'),
    audiencia: requerida('JWT_AUDIENCE'),
    vidaSegundos: entero('ACCESS_TOKEN_TTL_SECONDS', 900),
  };
  readonly argon2 = {
    memoriaKib: entero('ARGON2_MEMORY_KIB', 19456),
    iteraciones: entero('ARGON2_TIME_COST', 2),
    paralelismo: entero('ARGON2_PARALLELISM', 1),
  };
  readonly sesion = {
    /** Período de gracia de la rotación del token de renovación (FR-008a): 10 s; 0 lo desactiva. */
    graciaRenovacionSegundos: enteroEnRango('REFRESH_GRACIA_SEGUNDOS', 10, 0, 30),
  };
  readonly corsOrigen = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  readonly frontendBaseUrl = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';
  readonly versionTerminos = process.env.TERMS_VERSION ?? '';
  readonly versionPoliticaDatos = process.env.PRIVACY_POLICY_VERSION ?? '';
  readonly puerto = entero('PORT', 3000);
  /** Redis para la caché compartida y los límites (ADR-029). Sin valor: sin caché y límite por instancia. */
  readonly redisUrl = urlRedis('REDIS_URL');
  readonly cache = {
    catalogoActiva: booleano('CACHE_CATALOGO_ACTIVA', true),
    /** Caché de horarios calculados (FR-013b): solo si la medición lo exige. */
    horariosActiva: booleano('CACHE_HORARIOS_ACTIVA', false),
    /** Tiempo máximo de vida de la entrada del catálogo (FR-012: como máximo 5 minutos). */
    ttlCatalogoSegundos: enteroEnRango('CACHE_CATALOGO_TTL_SEGUNDOS', 120, 10, 300),
    timeoutMs: enteroEnRango('CACHE_TIMEOUT_MS', 100, 10, 1000),
    fallosParaAbrir: enteroEnRango('CACHE_FALLOS_PARA_ABRIR', 5, 1, 50),
    pausaMs: enteroEnRango('CACHE_PAUSA_MS', 10_000, 1000, 60_000),
  };
  /** `trust proxy` de Express: solo el balanceador (R04 de 006); por defecto, loopback. */
  readonly proxiesConfiables = proxies('PROXIES_CONFIABLES', 'loopback');
  /** Nombre lógico de la réplica (encabezado X-Instancia). */
  readonly instanciaId = identificador('INSTANCIA_ID');
  readonly pools = {
    appMax: enteroEnRango('DB_POOL_APP_MAX', 10, 2, 50),
    publicoMax: enteroEnRango('DB_POOL_PUBLICO_MAX', 10, 2, 50),
  };
}
