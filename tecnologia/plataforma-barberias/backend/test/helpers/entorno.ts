import { generateKeyPairSync } from 'node:crypto';

// Entorno de cada worker de las pruebas de integración: la aplicación se conecta como barberias_app
// a la base temporal y firma tokens con un par de claves ES256 generado para esta ejecución.

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

export const KID_PRUEBAS = 'pruebas-1';

process.env.DATABASE_URL_APP = process.env.TEST_DB_APP_URL;
process.env.DATABASE_URL_PUBLICO = process.env.TEST_DB_PUBLICO_URL;
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
