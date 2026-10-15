import { randomBytes } from 'node:crypto';
import { SuscripcionesApi } from '../../../src/modules/suscripciones-pagos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { cerrarPools } from '../../helpers/test-db';
import { crearEscenario } from '../../helpers/sesiones';

// T118 · Los registros de la aplicación (logger de Nest, consola, stdout y stderr) nunca contienen
// contraseñas, tokens, cookies ni el encabezado Authorization, ni siquiera cuando ocurre un error 500.

const CLAVE_REGISTRO = `clave-secreta-registro-${randomBytes(4).toString('hex')}`;

describe('Registros sin datos sensibles', () => {
  let prueba: AppDePrueba;
  let capturado = '';
  const restaurar: (() => void)[] = [];

  function capturar(objeto: Record<string, unknown>, metodo: string) {
    const original = objeto[metodo] as (...args: unknown[]) => unknown;
    objeto[metodo] = (...args: unknown[]) => {
      capturado += args
        .map((arg) => (typeof arg === 'string' ? arg : (JSON.stringify(arg) ?? String(arg))))
        .join(' ');
      capturado += '\n';
      return metodo === 'write' ? true : undefined;
    };
    restaurar.push(() => {
      objeto[metodo] = original;
    });
  }

  beforeAll(async () => {
    // Un alta de barbería que falla a mitad: obliga a pasar por el registro de errores 500.
    prueba = await crearApp({
      ajustar: (constructor) =>
        constructor.overrideProvider(SuscripcionesApi).useValue({
          iniciarPruebaGratuita: async () => {
            throw new Error('falla simulada al iniciar la prueba gratuita');
          },
          obtenerLimiteUsuarios: async () => 5,
          bloquearYObtenerLimiteUsuarios: async () => 5,
        }),
    });
    prueba.app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug']) capturar(console as never, metodo);
    capturar(process.stdout as never, 'write');
    capturar(process.stderr as never, 'write');
  });

  afterAll(async () => {
    restaurar.forEach((deshacer) => deshacer());
    await prueba.cerrar();
    await cerrarPools();
  });

  it('registro (con error 500), login, renovación, alta de usuario y activación no dejan secretos en los registros', async () => {
    const secretos: string[] = [CLAVE_REGISTRO];

    // 1. Registro de barbería que falla con 500 (el filtro registra la traza del error).
    const fallido = await prueba.agente
      .post('/api/v1/barberias')
      .send({
        nombreBarberia: 'Barbería con Fallo',
        propietario: {
          nombre: 'Dueño',
          correo: `log-${randomBytes(4).toString('hex')}@prueba.pe`,
          contrasena: CLAVE_REGISTRO,
        },
        aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
      })
      .expect(500);
    expect(fallido.body.codigo).toBe('ERROR_INTERNO');

    // 2. Login, renovación y una llamada autenticada.
    const e = await crearEscenario();
    secretos.push(e.barberoActivo.contrasena, e.tokenPropietario);
    const inicio = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: e.barberoActivo.correo, contrasena: e.barberoActivo.contrasena })
      .expect(200);
    const cookie = ([] as string[])
      .concat(inicio.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('rt='))
      ?.split(';')[0] as string;
    secretos.push(inicio.body.tokenAcceso, cookie.slice(3));
    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);

    // 3. Alta de usuario y activación con contraseña.
    const creado = await prueba.agente
      .post('/api/v1/usuarios')
      .set('Authorization', `Bearer ${e.tokenPropietario}`)
      .send({
        nombre: 'Barbero Log',
        correo: `log-${randomBytes(4).toString('hex')}@prueba.pe`,
        rol: 'BARBERO',
      })
      .expect(201);
    const tokenActivacion = new URL(creado.body.activacion.enlace).searchParams.get('token') as string;
    const claveActivacion = `clave-secreta-activacion-${randomBytes(4).toString('hex')}`;
    secretos.push(tokenActivacion, claveActivacion);
    await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token: tokenActivacion, contrasena: claveActivacion })
      .expect(204);

    // El 500 sí se registró (la prueba no es trivial)...
    expect(capturado).toContain('falla simulada al iniciar la prueba gratuita');
    // ...pero ningún secreto ni encabezado de credenciales aparece.
    for (const secreto of secretos) expect(capturado).not.toContain(secreto);
    expect(capturado).not.toMatch(/authorization|bearer |set-cookie|rt=/i);
  });
});
