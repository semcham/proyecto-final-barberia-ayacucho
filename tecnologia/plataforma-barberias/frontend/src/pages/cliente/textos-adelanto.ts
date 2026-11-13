import type { EstadoAdelanto } from '../../api/adelanto';
import type { TonoEtiqueta } from '../../components/ui';

// 008 (fase 3, US2) · Cómo se nombra cada estado del adelanto ante el cliente: en su pantalla de pago (corto) y en
// Mis citas (con la palabra "adelanto", junto al estado de la cita).

export const ESTADO_ADELANTO: Record<EstadoAdelanto, { texto: string; enLista: string; tono: TonoEtiqueta }> =
  {
    POR_PAGAR: { texto: 'Por pagar', enLista: 'Adelanto por pagar', tono: 'aviso' },
    POR_REVISAR: { texto: 'Pago por revisar', enLista: 'Pago del adelanto por revisar', tono: 'aviso' },
    CONFIRMADO: { texto: 'Confirmado', enLista: 'Adelanto confirmado', tono: 'exito' },
    VENCIDO: { texto: 'Vencido', enLista: 'Adelanto vencido', tono: 'neutro' },
    ANULADO: { texto: 'Anulado', enLista: 'Adelanto anulado', tono: 'neutro' },
    POR_DEVOLVER: { texto: 'Por devolver', enLista: 'Adelanto por devolver', tono: 'aviso' },
    DEVUELTO: { texto: 'Devuelto', enLista: 'Adelanto devuelto', tono: 'neutro' },
    RETENIDO: { texto: 'Retenido', enLista: 'Adelanto retenido', tono: 'neutro' },
  };

const formatoSoles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

/** Céntimos enteros como soles ("S/ 4.00"). */
export const soles = (centimos: number): string => formatoSoles.format(centimos / 100);
