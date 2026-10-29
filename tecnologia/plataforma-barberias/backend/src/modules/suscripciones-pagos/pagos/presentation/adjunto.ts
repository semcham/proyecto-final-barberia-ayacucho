import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { ArchivoComprobante } from '../application/comprobantes';
import { extensionDe } from '../domain/tipo-de-archivo';

/**
 * Respuesta de un comprobante (R09, FR-041), igual para el propietario y el administrador:
 * - el Content-Type es el verificado por los bytes, nunca el que declaró el navegador;
 * - `attachment` con un nombre neutro (el nombre original no se guarda), así el navegador no lo abre como
 *   página de este sitio;
 * - `nosniff`, para que el navegador no adivine otro tipo;
 * - `no-store`, para que no quede en ninguna caché.
 */
export function comoAdjunto(
  respuesta: Response,
  pagoId: string,
  archivo: ArchivoComprobante,
): StreamableFile {
  respuesta.setHeader('X-Content-Type-Options', 'nosniff');
  respuesta.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(archivo.contenido, {
    type: archivo.tipo,
    length: archivo.contenido.length,
    disposition: `attachment; filename="comprobante-${pagoId}.${extensionDe(archivo.tipo)}"`,
  });
}
