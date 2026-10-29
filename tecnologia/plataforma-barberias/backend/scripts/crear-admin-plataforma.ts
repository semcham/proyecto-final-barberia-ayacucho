/**
 * T070 · Alta de un administrador de la plataforma (ADR-031, R07): `npm run plataforma:crear-admin -- --correo
 * admin@ejemplo.pe --nombre "Nombre Apellido"`.
 *
 * - La contraseña se pide dos veces sin eco en la terminal. Sin terminal (CI, scripts), con
 *   `--contrasena-desde-entorno` se toma de la variable PLATAFORMA_ADMIN_CONTRASENA, que se borra del proceso
 *   al leerla. Nunca se acepta como argumento (quedaría en el historial de la terminal) y nunca se imprime.
 * - Imprime UNA SOLA VEZ la URI `otpauth://` (para escribirla o pegarla en la aplicación de autenticación) y
 *   los 10 códigos de recuperación. No se pueden volver a ver: en la base solo quedan el secreto cifrado con
 *   AES-256-GCM (PLATAFORMA_LLAVE_TOTP) y los hashes Argon2id de los códigos.
 * - Rechaza un correo ya registrado.
 *
 * Usa el rol dueño (DATABASE_URL_OWNER): el de la aplicación no tiene ningún permiso sobre platform_admin.
 * Necesita además PLATAFORMA_LLAVE_TOTP (la misma del servidor) y, si se cambiaron, ARGON2_*.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import argon2 from 'argon2';
import { Pool } from 'pg';
import type { SegundoFactor } from '../src/modules/acceso-barberias/identidad/application/ports/segundo-factor';
import { Contrasena } from '../src/modules/acceso-barberias/identidad/domain/contrasena';
import { Correo } from '../src/modules/acceso-barberias/identidad/domain/correo';
import { ValorInvalido } from '../src/modules/acceso-barberias/identidad/domain/errores';
import { NombrePersona } from '../src/modules/acceso-barberias/identidad/domain/nombre-persona';
import { TotpNode } from '../src/modules/acceso-barberias/identidad/infrastructure/totp-node';
import { llave32Bytes, parametrosArgon2 } from '../src/shared/config/configuracion';
import type { Configuracion } from '../src/shared';

export const VARIABLE_CONTRASENA = 'PLATAFORMA_ADMIN_CONTRASENA';

/** Error de uso de la orden: se muestra tal cual y termina con código 1 (sin traza). */
export class ErrorDeUso extends Error {}

export interface AdminCreado {
  adminId: string;
  correo: string;
  uri: string;
  codigosRecuperacion: string[];
}

const PROBLEMAS: Record<string, string> = {
  requerido: 'es obligatorio',
  formato: 'no tiene un formato válido',
  demasiado_largo: 'es demasiado largo',
  demasiada_larga: 'es demasiado larga',
  muy_corto: 'es demasiado corto',
  muy_corta: 'debe tener al menos 10 caracteres',
  muy_comun: 'es demasiado común',
  contiene_correo: 'no puede contener el correo',
  caracteres_no_permitidos: 'tiene caracteres no permitidos',
};

function validar<T>(crear: () => T): T {
  try {
    return crear();
  } catch (error) {
    if (!(error instanceof ValorInvalido)) throw error;
    const [{ campo, problema }] = error.detalles as { campo: string; problema: string }[];
    throw new ErrorDeUso(`El campo ${campo} ${PROBLEMAS[problema] ?? `no es válido (${problema})`}.`);
  }
}

/**
 * Crea el administrador y devuelve lo que se muestra una sola vez. Separado de la línea de comandos para
 * probarlo con datos descartables.
 */
export async function crearAdminPlataforma(
  pool: Pool,
  segundoFactor: SegundoFactor,
  datos: { correo: string; nombre: string; contrasena: string },
  opcionesArgon2 = parametrosArgon2(),
): Promise<AdminCreado> {
  const correo = validar(() => Correo.crear(datos.correo));
  const nombre = validar(() => NombrePersona.crear(datos.nombre));
  const contrasena = validar(() => Contrasena.crear(datos.contrasena, correo));

  const { rowCount } = await pool.query('SELECT 1 FROM platform_admin WHERE email = $1', [correo.valor]);
  if (rowCount) throw new ErrorDeUso('Ya existe un administrador con ese correo.');

  const adminId = randomUUID();
  const secreto = segundoFactor.generarSecreto();
  const { codigos, hashes } = await segundoFactor.generarCodigosRecuperacion();
  const hashContrasena = await argon2.hash(contrasena.valor, {
    type: argon2.argon2id,
    memoryCost: opcionesArgon2.memoriaKib,
    timeCost: opcionesArgon2.iteraciones,
    parallelism: opcionesArgon2.paralelismo,
  });
  try {
    await pool.query(
      `INSERT INTO platform_admin (id, email, full_name, password_hash, totp_secret_enc, recovery_codes_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, correo.valor, nombre.valor, hashContrasena, segundoFactor.cifrar(secreto, adminId), hashes],
    );
  } catch (error) {
    // Dos altas simultáneas con el mismo correo: la restricción UNIQUE deja una sola.
    if ((error as { code?: string }).code === '23505')
      throw new ErrorDeUso('Ya existe un administrador con ese correo.');
    throw error;
  }
  const uri = segundoFactor.uri(secreto, correo.valor);
  secreto.fill(0);
  return { adminId, correo: correo.valor, uri, codigosRecuperacion: codigos };
}

/** Lee una línea sin repetirla en la pantalla. */
function preguntarSinEco(pregunta: string): Promise<string> {
  return new Promise((resolve) => {
    const lector = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(pregunta);
    // readline repite lo que se escribe; aquí no se muestra nada (ni asteriscos, que dirían el largo).
    (lector as unknown as { _writeToOutput: (texto: string) => void })._writeToOutput = () => undefined;
    lector.question('', (respuesta) => {
      lector.close();
      process.stdout.write('\n');
      resolve(respuesta);
    });
  });
}

async function leerContrasena(desdeEntorno: boolean): Promise<string> {
  if (desdeEntorno) {
    const valor = process.env[VARIABLE_CONTRASENA];
    delete process.env[VARIABLE_CONTRASENA];
    if (!valor) throw new ErrorDeUso(`Falta la variable ${VARIABLE_CONTRASENA}.`);
    return valor;
  }
  if (!process.stdin.isTTY) {
    throw new ErrorDeUso(
      `Sin terminal no se puede pedir la contraseña: usa --contrasena-desde-entorno y la variable ${VARIABLE_CONTRASENA}.`,
    );
  }
  const primera = await preguntarSinEco('Contraseña del administrador (no se muestra): ');
  const segunda = await preguntarSinEco('Repítela: ');
  if (primera !== segunda) throw new ErrorDeUso('Las contraseñas no coinciden.');
  return primera;
}

function argumentos(): { correo: string; nombre: string; desdeEntorno: boolean } {
  let valores;
  try {
    ({ values: valores } = parseArgs({
      options: {
        correo: { type: 'string' },
        nombre: { type: 'string' },
        'contrasena-desde-entorno': { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch {
    // No se repite el argumento recibido: podría ser una contraseña escrita por error.
    throw new ErrorDeUso(
      'Uso: npm run plataforma:crear-admin -- --correo <correo> --nombre "<nombre>" [--contrasena-desde-entorno]. ' +
        'La contraseña nunca va como argumento.',
    );
  }
  if (!valores.correo || !valores.nombre) throw new ErrorDeUso('Faltan --correo y --nombre.');
  return {
    correo: valores.correo,
    nombre: valores.nombre,
    desdeEntorno: valores['contrasena-desde-entorno'] === true,
  };
}

async function principal(): Promise<void> {
  const { correo, nombre, desdeEntorno } = argumentos();
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new ErrorDeUso('Falta DATABASE_URL_OWNER (rol dueño de la base).');
  const configuracion = {
    plataforma: { llaveTotp: llave32Bytes('PLATAFORMA_LLAVE_TOTP') },
    argon2: parametrosArgon2(),
  } as unknown as Configuracion;
  const contrasena = await leerContrasena(desdeEntorno);

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const creado = await crearAdminPlataforma(pool, new TotpNode(configuracion), {
      correo,
      nombre,
      contrasena,
    });
    process.stdout.write(
      [
        '',
        `Administrador creado: ${creado.correo} (${creado.adminId})`,
        '',
        'Se muestra UNA SOLA VEZ. Guárdalo ahora: no se puede volver a ver.',
        '',
        '1. Agrega esta cuenta en tu aplicación de autenticación (escribe o pega la URI):',
        `   ${creado.uri}`,
        '',
        '2. Códigos de recuperación (cada uno sirve una sola vez, si pierdes el teléfono):',
        ...creado.codigosRecuperacion.map((codigo, i) => `   ${String(i + 1).padStart(2, ' ')}. ${codigo}`),
        '',
      ].join('\n'),
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  principal().catch((error: unknown) => {
    // Solo el mensaje propio; nunca el error completo (podría incluir la consulta o sus parámetros).
    process.stderr.write(
      `${error instanceof ErrorDeUso ? error.message : 'No se pudo crear el administrador. Revisa la conexión y la configuración.'}\n`,
    );
    process.exit(1);
  });
}
