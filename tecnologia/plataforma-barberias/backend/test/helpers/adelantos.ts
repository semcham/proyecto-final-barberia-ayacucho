import type { AppDePrueba } from './app';
import { poolDe } from './test-db';

// Ayudantes de las pruebas de 008 (adelanto de reserva con QR): las llamadas a las rutas de configuración y lo
// que quedó en la base, leído sin RLS con el superusuario de las pruebas.

const como = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {});

/** GET /barberia/adelanto. */
export function verConfiguracion(prueba: AppDePrueba, token: string | null) {
  return prueba.agente.get('/api/v1/barberia/adelanto').set(como(token));
}

/** PUT /barberia/adelanto con el cuerpo tal cual. */
export function cambiarConfiguracion(prueba: AppDePrueba, token: string | null, cuerpo: object) {
  return prueba.agente.put('/api/v1/barberia/adelanto').set(como(token)).send(cuerpo);
}

/** PUT /barberia/adelanto/qr (multipart, campo "archivo"). El nombre del archivo no cuenta: mandan los bytes. */
export function subirQr(prueba: AppDePrueba, token: string | null, archivo: Buffer, nombre = 'qr-yape.png') {
  return prueba.agente
    .put('/api/v1/barberia/adelanto/qr')
    .set(como(token))
    .attach('archivo', archivo, { filename: nombre });
}

/** GET /barberia/adelanto/qr, con el contenido como Buffer. */
export function verQr(prueba: AppDePrueba, token: string | null) {
  return prueba.agente
    .get('/api/v1/barberia/adelanto/qr')
    .set(como(token))
    .buffer(true)
    .parse((respuesta, listo) => {
      const partes: Buffer[] = [];
      respuesta.on('data', (parte: Buffer) => partes.push(parte));
      respuesta.on('end', () => listo(null, Buffer.concat(partes)));
    });
}

/** La fila de booking_deposit_settings de la barbería, o undefined. */
export async function filaConfiguracion(tenantId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await poolDe('seed').query('SELECT * FROM booking_deposit_settings WHERE tenant_id = $1', [
    tenantId,
  ]);
  return rows[0];
}

/** Los archivos del adelanto de la barbería, del más antiguo al más reciente. */
export async function archivosDeAdelanto(tenantId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    `SELECT id, kind, content_type, size_bytes, sha256, content, created_by
       FROM booking_deposit_file WHERE tenant_id = $1 ORDER BY created_at, id`,
    [tenantId],
  );
  return rows;
}
