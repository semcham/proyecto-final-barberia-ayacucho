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

function urlHttp(nombre: string, valor: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`La variable de entorno ${nombre} debe ser una URL http:// o https://`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`La variable de entorno ${nombre} debe ser una URL http:// o https://`);
  }
  return valor.replace(/\/+$/, '');
}

/** Secreto obligatorio con un largo mínimo. El mensaje de error nunca incluye el valor. */
function secreto(nombre: string, largoMinimo: number): string {
  const valor = requerida(nombre);
  if (valor.length < largoMinimo) {
    throw new Error(`La variable de entorno ${nombre} debe tener al menos ${largoMinimo} caracteres`);
  }
  return valor;
}

const PROVEEDORES_DE_PAGO = ['simulado', 'culqi'] as const;
export type ProveedorDePago = (typeof PROVEEDORES_DE_PAGO)[number];

function proveedorDePago(nombre: string): ProveedorDePago {
  const valor = opcional(nombre) ?? 'simulado';
  if (!(PROVEEDORES_DE_PAGO as readonly string[]).includes(valor)) {
    throw new Error(`La variable de entorno ${nombre} debe ser ${PROVEEDORES_DE_PAGO.join(' o ')}`);
  }
  return valor as ProveedorDePago;
}

/**
 * Llave AES-256 en base64: exactamente 32 bytes. El mensaje de error nunca incluye el valor. Exportada para la
 * orden plataforma:crear-admin, que cifra el secreto TOTP sin necesitar todo el entorno del servidor.
 */
export function llave32Bytes(nombre: string): Buffer {
  const valor = requerida(nombre).trim();
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(valor) ? Buffer.from(valor, 'base64') : Buffer.alloc(0);
  if (bytes.length !== 32) {
    throw new Error(`La variable de entorno ${nombre} debe ser una llave de 32 bytes en base64`);
  }
  return bytes;
}

/** Parámetros de Argon2id del entorno (mínimo OWASP por defecto). Los usa también plataforma:crear-admin. */
export function parametrosArgon2(): { memoriaKib: number; iteraciones: number; paralelismo: number } {
  return {
    memoriaKib: entero('ARGON2_MEMORY_KIB', 19456),
    iteraciones: entero('ARGON2_TIME_COST', 2),
    paralelismo: entero('ARGON2_PARALLELISM', 1),
  };
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
  readonly argon2 = parametrosArgon2();
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
    plataformaMax: enteroEnRango('DB_POOL_PLATAFORMA_MAX', 4, 2, 20),
  };
  /** Pasarela de pagos detrás de PaymentGateway (ADR-022): se cambia por configuración, no por código. */
  readonly pagos = {
    proveedor: proveedorDePago('PAGOS_PROVEEDOR'),
    urlBase: urlHttp('PAGOS_URL_BASE', requerida('PAGOS_URL_BASE')),
    llavePublica: opcional('PAGOS_LLAVE_PUBLICA'),
    llaveSecreta: secreto('PAGOS_LLAVE_SECRETA', 8),
    /** Secreto HMAC-SHA256 de las notificaciones firmadas (FR-013). */
    secretoFirma: secreto('PAGOS_SECRETO_FIRMA', 16),
    urlRetorno: urlHttp(
      'PAGOS_URL_RETORNO',
      opcional('PAGOS_URL_RETORNO') ?? `${this.frontendBaseUrl}/app/suscripcion`,
    ),
    tiempoLimiteMs: enteroEnRango('PAGOS_TIEMPO_LIMITE_MS', 2000, 100, 10_000),
    /** Límite propio del punto de notificaciones por IP y minuto (FR-013a). */
    notificacionesPorMinuto: enteroEnRango('PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO', 600, 1, 100_000),
    /** Cuenta a la que se transfiere (FR-019); se usa con el medio TRANSFERENCIA. */
    cuenta: {
      banco: opcional('PAGOS_CUENTA_BANCO'),
      titular: opcional('PAGOS_CUENTA_TITULAR'),
      numero: opcional('PAGOS_CUENTA_NUMERO'),
      cci: opcional('PAGOS_CUENTA_CCI'),
    },
  };
  /** Operaciones de la plataforma (ADR-031). */
  readonly plataforma = {
    /** Rol barberias_plataforma: lecturas entre barberías, solo lectura. */
    databaseUrl: requerida('DATABASE_URL_PLATAFORMA'),
    /** Llave AES-256-GCM de los secretos TOTP del administrador (R07). */
    llaveTotp: llave32Bytes('PLATAFORMA_LLAVE_TOTP'),
  };
  /** Tareas programadas (ADR-024). */
  readonly tareas = {
    activas: booleano('TAREAS_ACTIVAS', true),
    intervaloMs: enteroEnRango('TAREAS_INTERVALO_MS', 300_000, 10_000, 86_400_000),
  };
}
