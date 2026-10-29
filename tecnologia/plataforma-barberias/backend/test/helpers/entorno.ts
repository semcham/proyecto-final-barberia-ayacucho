import { generateKeyPairSync } from 'node:crypto';

// Entorno de cada worker de las pruebas de integración: la aplicación se conecta como barberias_app
// a la base temporal y firma tokens con un par de claves ES256 generado para esta ejecución.

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

export const KID_PRUEBAS = 'pruebas-1';

process.env.DATABASE_URL_APP = process.env.TEST_DB_APP_URL;
process.env.DATABASE_URL_PUBLICO = process.env.TEST_DB_PUBLICO_URL;
process.env.DATABASE_URL_PLATAFORMA = process.env.TEST_DB_PLATAFORMA_URL;
// 003: pasarela (el ayudante helpers/simulador.ts fija la URL real del simulador iniciado en el proceso),
// llave de los secretos TOTP y tareas programadas apagadas: cada prueba las ejecuta con `ejecutarAhora`.
process.env.PAGOS_PROVEEDOR = 'simulado';
process.env.PAGOS_URL_BASE = 'http://127.0.0.1:9';
process.env.PAGOS_LLAVE_SECRETA = 'sk_pruebas_integracion';
process.env.PAGOS_SECRETO_FIRMA = 'whsec_pruebas_integracion_0123456789';
process.env.PLATAFORMA_LLAVE_TOTP = Buffer.alloc(32, 42).toString('base64');
// US3: cuenta de la plataforma para las transferencias (datos de prueba, no reales).
process.env.PAGOS_CUENTA_BANCO = 'Banco de Pruebas';
process.env.PAGOS_CUENTA_TITULAR = 'Plataforma de Barberías SAC';
process.env.PAGOS_CUENTA_NUMERO = '191-0000000-0-00';
process.env.PAGOS_CUENTA_CCI = '00219100000000000000';
process.env.TAREAS_ACTIVAS = 'false';
process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.JWT_PUBLIC_KEYS = JSON.stringify({
  [KID_PRUEBAS]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
});
process.env.JWT_ACTIVE_KID = KID_PRUEBAS;
process.env.JWT_ISSUER = 'plataforma-barberias';
process.env.JWT_AUDIENCE = 'plataforma-barberias-web';
process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.FRONTEND_BASE_URL = 'http://localhost:5173';
process.env.TERMS_VERSION = '2026-10';
process.env.PRIVACY_POLICY_VERSION = '2026-10';
// Las pruebas registran muchas barberías desde la misma IP; el límite real (10 por minuto) no aplica aquí.
process.env.REGISTRO_LIMITE_POR_MINUTO = '1000';
process.env.ACTIVACION_LIMITE_POR_MINUTO = '1000';
process.env.PUBLICO_LIMITE_POR_MINUTO = '10000';
