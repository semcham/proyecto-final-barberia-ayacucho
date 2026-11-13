import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  mixin,
  type NestInterceptor,
  PayloadTooLargeException,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';

/**
 * Tipo mínimo propio del archivo que deja multer en memoria (R16 de 003: en lugar de agregar @types/multer). Solo
 * lo que se usa: el contenido y su tamaño. El nombre original y el Content-Type del navegador existen en el
 * objeto, pero no se leen ni se guardan nunca.
 */
export interface ArchivoEnMemoria {
  buffer: Buffer;
  size: number;
}

/** Campo del formulario multipart con el archivo (contratos de 003 y 008). */
export const CAMPO_ARCHIVO = 'archivo';

export interface OpcionesDeArchivo {
  /** Tamaño máximo del archivo en bytes. */
  tamanoMaximo: number;
  /** Cuántos campos de texto cortos acompañan al archivo. */
  camposDeTexto: number;
  /**
   * El error que reemplaza al 413 genérico cuando el archivo supera el tamaño (el comprobante de 003 responde 400
   * VALIDACION). Sin él, se responde 413, como pide el contrato de 008 para el QR.
   */
  alExcederTamano?: () => Error;
}

/**
 * T017 de 008 · Subida de un archivo privado, extraída del interceptor del comprobante de 003: el FileInterceptor
 * de Nest con multer en memoria (sin `storage` ni `dest`: nunca toca el disco del servidor), un solo archivo con
 * tope configurable y pocos campos cortos. Un archivo de más, otro campo de archivo o demasiadas partes ya son 400.
 */
export function InterceptorDeArchivo(opciones: OpcionesDeArchivo): Type<NestInterceptor> {
  const Base = FileInterceptor(CAMPO_ARCHIVO, {
    limits: {
      files: 1,
      fileSize: opciones.tamanoMaximo,
      fields: opciones.camposDeTexto,
      fieldSize: 100,
      parts: opciones.camposDeTexto + 1,
    },
  });

  @Injectable()
  class Interceptor extends Base implements NestInterceptor {
    override async intercept(
      contexto: ExecutionContext,
      siguiente: CallHandler,
    ): Promise<Observable<unknown>> {
      try {
        return await super.intercept(contexto, siguiente);
      } catch (error) {
        if (error instanceof PayloadTooLargeException && opciones.alExcederTamano) {
          throw opciones.alExcederTamano();
        }
        throw error;
      }
    }
  }
  return mixin(Interceptor);
}
