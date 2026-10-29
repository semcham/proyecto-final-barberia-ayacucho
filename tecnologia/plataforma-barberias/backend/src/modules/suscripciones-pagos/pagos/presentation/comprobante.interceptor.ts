import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { ComprobanteInvalido } from '../domain/errores';
import { TAMANO_MAXIMO_COMPROBANTE } from '../domain/tipo-de-archivo';

/**
 * Tipo mínimo propio del archivo que deja multer en memoria (R16: en lugar de agregar @types/multer). Solo
 * lo que se usa: el contenido y su tamaño. El nombre original y el Content-Type del navegador existen en el
 * objeto, pero no se leen ni se guardan nunca.
 */
export interface ArchivoEnMemoria {
  buffer: Buffer;
  size: number;
}

/** Campo del formulario multipart con el archivo (contracts/openapi.yaml). */
export const CAMPO_ARCHIVO = 'archivo';

const Base = FileInterceptor(CAMPO_ARCHIVO, {
  // Sin `storage` ni `dest`: multer guarda el archivo en memoria, nunca en el disco del servidor.
  limits: {
    files: 1,
    fileSize: TAMANO_MAXIMO_COMPROBANTE,
    // Solo numeroOperacion y fechaTransferencia, cortos.
    fields: 2,
    fieldSize: 100,
    parts: 3,
  },
});

/**
 * T083 · Subida del comprobante: el FileInterceptor de Nest con multer en memoria, un archivo y 5 MB. Un
 * archivo más grande responde 400 VALIDACION (`archivo`, `demasiado_grande`), como dice el contrato, y no el
 * 413 genérico; el resto de los errores de multer (otro campo de archivo, demasiadas partes) ya son 400.
 */
@Injectable()
export class ComprobanteInterceptor extends Base implements NestInterceptor {
  override async intercept(contexto: ExecutionContext, siguiente: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(contexto, siguiente);
    } catch (error) {
      if (error instanceof PayloadTooLargeException)
        throw new ComprobanteInvalido('archivo', 'demasiado_grande');
      throw error;
    }
  }
}
