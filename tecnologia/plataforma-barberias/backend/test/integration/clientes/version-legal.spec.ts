import { type AppDePrueba, crearApp } from '../../helpers/app';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T009 de 010 · La versión aceptada de los textos legales (US3; FR-026, SC-008). Los tres caminos que guardan una
// aceptación (registro del cliente, registro de la barbería y unión a otra barbería) rechazan, sin guardar nada, una
// versión distinta de la vigente, y con la vigente guardan esa versión exacta. "Vigente" es la configurada en el entorno
// (TERMS_VERSION y PRIVACY_POLICY_VERSION), la misma que publica la interfaz en /terminos y /privacidad.

const VERSION_TERMINOS = process.env.TERMS_VERSION as string;
const VERSION_POLITICA = process.env.PRIVACY_POLICY_VERSION as string;
const OTRA = '2020-01';

const correoNuevo = (prefijo: string) =>
  `${prefijo}-${Date.now()}-${Math.round(Math.random() * 1e6)}@prueba.pe`;

describe('Versión aceptada de los textos legales', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  const filas = async (sql: string, parametros: unknown[]) => (await poolDe('seed').query(sql, parametros)).rows;
  const cuentaDe = (correo: string) => filas('SELECT id FROM user_account WHERE email = $1', [correo]);

  beforeAll(async () => {
    expect(VERSION_TERMINOS).toBeTruthy();
    expect(VERSION_POLITICA).toBeTruthy();
    prueba = await crearApp();
    a = await sembrarBarberia({ nombre: 'Barbería A' });
    b = await sembrarBarberia({ nombre: 'Barbería B' });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('registro del cliente (POST /clientes/registro)', () => {
    const registro = (correo: string, version: string) =>
      prueba.agente.post('/api/v1/clientes/registro').send({
        barberia: a.slug,
        nombre: 'Rosa Quispe',
        correo,
        telefono: '966 123 456',
        contrasena: 'clave-de-rosa-segura',
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: version,
      });

    it('con otra versión de la política: 400 y no guarda cuenta ni consentimiento', async () => {
      const correo = correoNuevo('cliente-otra-version');
      await registro(correo, OTRA).expect(400);
      expect(await cuentaDe(correo)).toEqual([]);
    });

    it('con la versión vigente: el consentimiento guarda esa versión exacta', async () => {
      const correo = correoNuevo('cliente-vigente');
      const { body } = await registro(correo, VERSION_POLITICA).expect(201);
      const consentimientos = await filas(
        `SELECT c.text_version FROM consent_record c
           JOIN customer_profile p ON p.tenant_id = c.tenant_id AND p.id = c.customer_id
          WHERE p.user_id = $1`,
        [body.usuario.id],
      );
      expect(consentimientos).toEqual([{ text_version: VERSION_POLITICA }]);
    });
  });

  describe('registro de la barbería (POST /barberias)', () => {
    const registro = (correo: string, terminos: string, politica: string) =>
      prueba.agente.post('/api/v1/barberias').send({
        nombreBarberia: `Barbería ${Date.now()}`,
        propietario: { nombre: 'Rosa Quispe', correo, contrasena: 'mi barberia en huamanga' },
        aceptaciones: { terminosVersion: terminos, politicaDatosVersion: politica },
      });

    it.each([
      ['los términos', OTRA, 'vigente'],
      ['la política', 'vigente', OTRA],
    ])('con otra versión de %s: 400 y no guarda nada', async (_caso, terminos, politica) => {
      const correo = correoNuevo('barberia-otra-version');
      const respuesta = await registro(
        correo,
        terminos === 'vigente' ? VERSION_TERMINOS : terminos,
        politica === 'vigente' ? VERSION_POLITICA : politica,
      ).expect(400);
      expect(respuesta.body.codigo).toBe('VALIDACION');
      expect(await cuentaDe(correo)).toEqual([]);
    });

    it('con las versiones vigentes: guarda cada aceptación con su versión exacta', async () => {
      const correo = correoNuevo('barberia-vigente');
      const { body } = await registro(correo, VERSION_TERMINOS, VERSION_POLITICA).expect(201);
      const aceptaciones = await filas(
        'SELECT document, text_version FROM terms_acceptance WHERE tenant_id = $1 ORDER BY document',
        [body.barberia.id],
      );
      expect(aceptaciones).toEqual([
        { document: 'POLITICA_DATOS', text_version: VERSION_POLITICA },
        { document: 'TERMINOS', text_version: VERSION_TERMINOS },
      ]);
    });
  });

  describe('unión a otra barbería (POST /auth/login con la aceptación)', () => {
    const unirse = (credenciales: { correo: string; contrasena: string }, version: string) =>
      prueba.agente.post('/api/v1/auth/login').send({
        ...credenciales,
        barberia: b.slug,
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: version,
        telefono: '955 000 111',
      });

    it('con otra versión: 400 y no crea la membresía ni el consentimiento en la otra barbería', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      await unirse({ correo: cliente.correo as string, contrasena: cliente.contrasena as string }, OTRA).expect(400);
      expect(
        await filas('SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2', [b.tenantId, cliente.usuarioId]),
      ).toEqual([]);
    });

    it('con la versión vigente: el consentimiento en la otra barbería guarda esa versión exacta', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      await unirse(
        { correo: cliente.correo as string, contrasena: cliente.contrasena as string },
        VERSION_POLITICA,
      ).expect(200);
      const consentimientos = await filas(
        `SELECT c.text_version FROM consent_record c
           JOIN customer_profile p ON p.tenant_id = c.tenant_id AND p.id = c.customer_id
          WHERE p.tenant_id = $1 AND p.user_id = $2`,
        [b.tenantId, cliente.usuarioId],
      );
      expect(consentimientos).toEqual([{ text_version: VERSION_POLITICA }]);
    });
  });
});
