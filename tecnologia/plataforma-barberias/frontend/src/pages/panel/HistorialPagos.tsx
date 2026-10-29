import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiSuscripcion, type Pago } from '../../api/suscripcion';
import { Alerta, Boton, EstadoVacio, EtiquetaEstado, Tarjeta } from '../../components/ui';
import type { TonoEtiqueta } from '../../components/ui/EtiquetaEstado';
import { mensajeDeError } from './datos-barberia';
import estilos from './Panel.module.css';
import { MEDIOS_PAGO, textoDelPago } from './textos-pagos';

// T091 · Historial de pagos del propietario (RF25, HU20; FR-025): del más reciente al más antiguo, de a 20.
// Muestra lo que trae el contrato y nada más: fecha, plan, importe, medio, estado (con sus textos), período,
// motivo del rechazo y los últimos 4 caracteres del número de operación. Nada de tarjetas, cuentas ni del
// comprobante más allá del estado del pago.

export const TAMANO_PAGINA = 20;

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const dia = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' });

function tonoDe(pago: Pago): TonoEtiqueta {
  if (pago.estado === 'APROBADO') return pago.marca === 'DUPLICADO' ? 'aviso' : 'exito';
  if (pago.estado === 'RECHAZADO') return 'error';
  if (pago.estado === 'ANULADO' || pago.estado === 'EXPIRADO') return 'neutro';
  return 'acento';
}

function FilaDePago({ pago }: { pago: Pago }) {
  return (
    <li className={estilos.elemento}>
      <div className={estilos.elementoTextos}>
        <span className={estilos.elementoNombre}>
          {pago.plan.nombre} · {soles.format(pago.importeCentimos / 100)} · {MEDIOS_PAGO[pago.medio]}
        </span>
        <span className={estilos.elementoDetalle}>
          {dia.format(new Date(pago.creadoEn))}
          {pago.periodo?.iniciaEn && pago.periodo.terminaEn
            ? ` · período del ${dia.format(new Date(pago.periodo.iniciaEn))} al ${dia.format(new Date(pago.periodo.terminaEn))}`
            : ''}
          {pago.numeroOperacionFinal ? ` · operación terminada en ${pago.numeroOperacionFinal}` : ''}
        </span>
        {pago.estado === 'RECHAZADO' && pago.motivoRechazo && (
          <span className={estilos.elementoDetalle}>Motivo: {pago.motivoRechazo}</span>
        )}
      </div>
      <EtiquetaEstado tono={tonoDe(pago)}>{textoDelPago(pago)}</EtiquetaEstado>
    </li>
  );
}

/** Historial de pagos en /app/suscripcion. */
export function HistorialDePagos() {
  const [pagina, setPagina] = useState(1);
  const historial = useQuery({
    queryKey: ['suscripcion', 'historial', pagina],
    queryFn: () => apiSuscripcion.historial(pagina),
    placeholderData: keepPreviousData,
  });
  const paginas = historial.data ? Math.max(1, Math.ceil(historial.data.total / TAMANO_PAGINA)) : 1;

  let contenido;
  if (historial.isError) contenido = <Alerta>{mensajeDeError(historial.error)}</Alerta>;
  else if (!historial.data) contenido = <p aria-busy="true">Cargando el historial…</p>;
  else if (historial.data.total === 0) {
    contenido = (
      <EstadoVacio
        icono="dinero"
        titulo="Aún no hay pagos"
        descripcion="Aquí verás cada pago de tu suscripción."
      />
    );
  } else {
    contenido = (
      <>
        <ul className={estilos.lista} aria-label="Pagos">
          {historial.data.pagos.map((pago) => (
            <FilaDePago key={pago.id} pago={pago} />
          ))}
        </ul>
        {paginas > 1 && (
          <nav aria-label="Páginas del historial" className={estilos.acciones}>
            <Boton
              type="button"
              variante="secundario"
              tamano="sm"
              disabled={pagina === 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anteriores
            </Boton>
            <span className={estilos.aviso}>
              Página {pagina} de {paginas}
            </span>
            <Boton
              type="button"
              variante="secundario"
              tamano="sm"
              disabled={pagina >= paginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguientes
            </Boton>
          </nav>
        )}
      </>
    );
  }

  return (
    <Tarjeta titulo="Historial de pagos" descripcion="Del más reciente al más antiguo." icono="calendario">
      {contenido}
    </Tarjeta>
  );
}
