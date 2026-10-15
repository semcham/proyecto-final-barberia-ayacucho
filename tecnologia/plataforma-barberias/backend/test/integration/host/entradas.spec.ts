import { randomBytes } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { crearEscenario, type Escenario } from '../../helpers/sesiones';

// T117 · PR10 (EQ-10): entradas mal formadas, demasiado largas o maliciosas se rechazan con un mensaje
// controlado o quedan neutralizadas (se guardan como texto, nunca se ejecutan), y no crean filas.

const TABLAS = [
  'tenant',
  'user_account',
  'membership',
  'subscription',
  'terms_acceptance',
  'account_activation',
];
const correoNuevo = () => `entrada-${randomBytes(4).toString('hex')}@prueba.pe`;
const CLAVE = 'una clave larga y propia';

async function conteos(): Promise<Record<string, number>> {
  const resultado: Record<string, number> = {};
  for (const tabla of TABLAS) {
    resultado[tabla] = (
      await poolDe('seed').query(`SELECT count(*)::int AS total FROM ${tabla}`)
    ).rows[0].total;
  }
  return resultado;
}

function registro(
  cambios: { nombreBarberia?: string; nombre?: string; correo?: string; contrasena?: string } = {},
) {
  return {
    nombreBarberia: cambios.nombreBarberia ?? 'Barbería Válida',
    propietario: {
      nombre: cambios.nombre ?? 'Dueño Válido',
      correo: cambios.correo ?? correoNuevo(),
      contrasena: cambios.contrasena ?? CLAVE,
    },
    aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
  };
}

/** Respuesta de error con el formato del contrato y sin trazas ni detalles internos. */
function esErrorControlado(cuerpo: Record<string, unknown>) {
  expect(Object.keys(cuerpo).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
  expect(JSON.stringify(cuerpo)).not.toMatch(/stack|at \w+ \(|node_modules|SELECT|INSERT|syntax error/i);
}

describe('PR10 · Validación de entradas', () => {
  let prueba: AppDePrueba;
  let escenario: Escenario;

  beforeAll(async () => {
    prueba = await crearApp();
    escenario = await crearEscenario();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('POST /barberias', () => {
    it.each([
      ['caracteres de control en el nombre', registro({ nombreBarberia: 'Barbería\u0000Oculta' })],
      ['salto de línea en el nombre del propietario', registro({ nombre: 'Rosa\nQuispe' })],
      ['nombre de 10 000 caracteres', registro({ nombreBarberia: 'x'.repeat(10_000) })],
      ['contraseña de 10 000 caracteres', registro({ contrasena: 'x'.repeat(10_000) })],
      ['inyección SQL en el correo', registro({ correo: "' OR 1=1 --" })],
      ['script en el correo', registro({ correo: '<script>alert(1)</script>@x.pe' })],
      ['tipo incorrecto (número en lugar de texto)', { ...registro(), nombreBarberia: 12345 }],
      ['objeto anidado en lugar de texto', { ...registro(), nombreBarberia: { $ne: null } }],
    ])('400 VALIDACION sin filas creadas: %s', async (_caso, cuerpo) => {
      const antes = await conteos();
      const respuesta = await prueba.agente.post('/api/v1/barberias').send(cuerpo).expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
      expect(await conteos()).toEqual(antes);
    });

    it('un nombre con <script> y comillas se guarda como texto literal (neutralizado, no ejecutado)', async () => {
      const nombre = `<script>alert('x')</script> "Barbería"; DROP TABLE tenant;--`;
      const respuesta = await prueba.agente
        .post('/api/v1/barberias')
        .send(registro({ nombreBarberia: nombre }))
        .expect(201);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.body.barberia.nombre).toBe(nombre);
      const { rows } = await poolDe('seed').query('SELECT name FROM tenant WHERE id = $1', [
        respuesta.body.barberia.id,
      ]);
      expect(rows[0].name).toBe(nombre);
      // La tabla sigue existiendo: el texto nunca se interpretó como SQL.
      await poolDe('seed').query('SELECT 1 FROM tenant LIMIT 1');
    });
  });

  describe('POST /auth/login', () => {
    it.each([
      ["' OR '1'='1", "' OR '1'='1"],
      ["admin@x.pe'--", 'cualquiera'],
      ['x'.repeat(10_000), 'cualquiera'],
    ])('correo %# malicioso o enorme → 400 o 401 genérico, nunca 500', async (correo, contrasena) => {
      const respuesta = await prueba.agente
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
        .send({ correo, contrasena });
      expect([400, 401]).toContain(respuesta.status);
      esErrorControlado(respuesta.body);
    });
  });

  describe('POST /usuarios', () => {
    const conPropietario = () => ({ Authorization: `Bearer ${escenario.tokenPropietario}` });

    it.each([
      [
        'inyección SQL en el correo',
        { nombre: 'Luis', correo: "x'); DROP TABLE membership;--@x.pe", rol: 'BARBERO' },
      ],
      [
        'script en el nombre con caracteres de control',
        { nombre: '<script>\u0007</script>', correo: correoNuevo(), rol: 'BARBERO' },
      ],
      ['nombre de 10 000 caracteres', { nombre: 'x'.repeat(10_000), correo: correoNuevo(), rol: 'BARBERO' }],
      ['rol con inyección', { nombre: 'Luis', correo: correoNuevo(), rol: "BARBERO' OR 1=1" }],
    ])('400 VALIDACION sin filas creadas: %s', async (_caso, cuerpo) => {
      const antes = await conteos();
      const respuesta = await prueba.agente
        .post('/api/v1/usuarios')
        .set(conPropietario())
        .send(cuerpo)
        .expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
      expect(await conteos()).toEqual(antes);
    });

    it('un id que no es UUID en la ruta → 400 VALIDACION', async () => {
      const respuesta = await prueba.agente
        .get("/api/v1/usuarios/1' OR '1'='1")
        .set(conPropietario())
        .expect(400);
      esErrorControlado(respuesta.body);
    });
  });

  describe('cuerpo de la solicitud', () => {
    it('más de 16 KB → 413 con mensaje controlado y sin filas creadas', async () => {
      const antes = await conteos();
      const respuesta = await prueba.agente
        .post('/api/v1/barberias')
        .send({ ...registro(), relleno: 'x'.repeat(20 * 1024) })
        .expect(413);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
      expect(await conteos()).toEqual(antes);
    });

    it('JSON mal formado → 400 con mensaje controlado', async () => {
      const respuesta = await prueba.agente
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"correo": "a@b.pe", "contrasena": ')
        .expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      esErrorControlado(respuesta.body);
    });
  });
});
