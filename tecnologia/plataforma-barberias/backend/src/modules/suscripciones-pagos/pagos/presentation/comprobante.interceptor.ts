import { ComprobanteInvalido } from '../domain/errores';
import { TAMANO_MAXIMO_COMPROBANTE } from '../domain/tipo-de-archivo';
import { InterceptorDeArchivo } from './archivo.interceptor';

export { type ArchivoEnMemoria, CAMPO_ARCHIVO } from './archivo.interceptor';

/**
 * T083 · Subida del comprobante: multer en memoria, un archivo de hasta 5 MB y dos campos cortos
 * (numeroOperacion y fechaTransferencia). Un archivo más grande responde 400 VALIDACION (`archivo`,
 * `demasiado_grande`), como dice el contrato de 003, y no el 413 genérico. Desde 008 usa el interceptor de tope
 * configurable (archivo.interceptor.ts), con el mismo comportamiento.
 */
export const ComprobanteInterceptor = InterceptorDeArchivo({
  tamanoMaximo: TAMANO_MAXIMO_COMPROBANTE,
  camposDeTexto: 2,
  alExcederTamano: () => new ComprobanteInvalido('archivo', 'demasiado_grande'),
});
