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
}
