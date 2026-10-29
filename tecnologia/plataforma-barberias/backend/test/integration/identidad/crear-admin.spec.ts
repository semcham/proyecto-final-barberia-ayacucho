import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { VARIABLE_CONTRASENA } from '../../../scripts/crear-admin-plataforma';
import { codigoTotp, pasoDe } from '../../../src/modules/acceso-barberias/identidad/infrastructure/totp-node';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T070 · Orden plataforma:crear-admin, ejecutada de verdad (tsx) con datos descartables: imprime una sola vez
// la URI otpauth:// y 10 códigos, nunca la contraseña; la cuenta creada entra con contraseña y TOTP, o con un
// código de recuperación; un correo repetido, una contraseña débil o la falta de terminal se rechazan sin
// escribir nada.

const RAIZ = join(__dirname, '..', '..', '..');
const TSX = join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = join(RAIZ, 'scripts', 'crear-admin-plataforma.ts');

interface Salida {
  codigo: number | null;
  stdout: string;
  stderr: string;
}

function ejecutar(args: string[], contrasena?: string): Promise<Salida> {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [TSX, SCRIPT, ...args], {
      cwd: RAIZ,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        DATABASE_URL_OWNER: process.env.TEST_DB_OWNER_URL,
        PLATAFORMA_LLAVE_TOTP: process.env.PLATAFORMA_LLAVE_TOTP,
        ...(contrasena === undefined ? {} : { [VARIABLE_CONTRASENA]: contrasena }),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    hijo.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    hijo.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    hijo.stdin.end();
    hijo.on('error', reject);
    hijo.on('close', (codigo) => resolve({ codigo, stdout, stderr }));
  });
}

function desdeBase32(texto: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const caracter of texto) {
    valor = (valor << 5) | alfabeto.indexOf(caracter);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

const correoNuevo = () => `admin-cli-${Date.now()}-${Math.floor(Math.random() * 1e6)}@plataforma.prueba`;
const CONTRASENA = 'clave-descartable-de-prueba-cli';

describe('plataforma:crear-admin (T070)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('crea la cuenta, imprime la URI y 10 códigos una vez, nunca la contraseña, y la cuenta entra con TOTP', async () => {
    const correo = correoNuevo();
    const salida = await ejecutar(
      ['--correo', correo, '--nombre', 'Admin Descartable', '--contrasena-desde-entorno'],
      CONTRASENA,
    );
    expect({ codigo: salida.codigo, stderr: salida.stderr }).toEqual({ codigo: 0, stderr: '' });
    expect(salida.stdout).not.toContain(CONTRASENA);
    const uris = salida.stdout.match(/otpauth:\/\/totp\/\S+/g) ?? [];
    expect(uris).toHaveLength(1);
    const codigos = salida.stdout.match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/g) ?? [];
    expect(codigos).toHaveLength(10);

    const secreto = desdeBase32(new URL(uris[0] as string).searchParams.get('secret') as string);
    expect(secreto).toHaveLength(20);
    const { rows } = await poolDe('seed').query(
      'SELECT password_hash, totp_secret_enc, recovery_codes_hash, status FROM platform_admin WHERE email = $1',
      [correo],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ACTIVA');
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect((rows[0].totp_secret_enc as Buffer).includes(secreto)).toBe(false);
    expect(JSON.stringify(rows[0])).not.toContain(CONTRASENA);
    for (const codigo of codigos)
      expect(JSON.stringify(rows[0].recovery_codes_hash)).not.toContain(codigo.replace(/-/g, ''));

    // Cada solicitud se crea después de resolver la anterior: comparten el servidor de supertest.
    const desafio = async () =>
      (
        await prueba.agente
          .post('/api/v1/plataforma/auth/ingresar')
          .send({ correo, contrasena: CONTRASENA })
          .expect(200)
      ).body.desafio as string;
    const primero = await desafio();
    await prueba.agente
      .post('/api/v1/plataforma/auth/segundo-factor')
      .send({ desafio: primero, codigo: codigoTotp(secreto, pasoDe(new Date())) })
      .expect(200);
    const segundo = await desafio();
    await prueba.agente
      .post('/api/v1/plataforma/auth/segundo-factor')
      .send({ desafio: segundo, codigoRecuperacion: codigos[0] })
      .expect(200);
  });

  it('rechaza un correo repetido sin crear otra cuenta', async () => {
    const correo = correoNuevo();
    const args = ['--correo', correo, '--nombre', 'Admin Descartable', '--contrasena-desde-entorno'];
    expect((await ejecutar(args, CONTRASENA)).codigo).toBe(0);
    const repetido = await ejecutar(['--correo', correo.toUpperCase(), ...args.slice(2)], CONTRASENA);
    expect(repetido.codigo).toBe(1);
    expect(repetido.stderr).toMatch(/Ya existe un administrador con ese correo/);
    expect(repetido.stdout).not.toMatch(/otpauth/);
    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM platform_admin WHERE email = $1',
      [correo],
    );
    expect(rows[0].n).toBe(1);
  });

  it('rechaza una contraseña débil, la falta de terminal y una contraseña como argumento, sin mostrarla', async () => {
    const correo = correoNuevo();
    const debil = await ejecutar(
      ['--correo', correo, '--nombre', 'Admin', '--contrasena-desde-entorno'],
      'corta',
    );
    expect(debil.codigo).toBe(1);
    expect(debil.stderr).toMatch(/contrasena debe tener al menos 10 caracteres/);
    expect(`${debil.stdout}${debil.stderr}`).not.toContain('corta\n');

    const sinTerminal = await ejecutar(['--correo', correo, '--nombre', 'Admin']);
    expect(sinTerminal.codigo).toBe(1);
    expect(sinTerminal.stderr).toMatch(/--contrasena-desde-entorno/);

    const comoArgumento = await ejecutar([
      '--correo',
      correo,
      '--nombre',
      'Admin',
      '--contrasena',
      'secreta-123456',
    ]);
    expect(comoArgumento.codigo).toBe(1);
    expect(`${comoArgumento.stdout}${comoArgumento.stderr}`).not.toContain('secreta-123456');
    expect(comoArgumento.stderr).toMatch(/nunca va como argumento/);

    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM platform_admin WHERE email = $1',
      [correo],
    );
    expect(rows[0].n).toBe(0);
  });
});
