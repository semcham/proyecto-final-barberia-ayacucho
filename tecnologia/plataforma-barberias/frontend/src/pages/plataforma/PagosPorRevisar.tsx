import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { apiPagosPorRevisar, type PagoPorRevisar } from '../../api/plataforma';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Alerta, Boton, Campo, EstadoVacio, EtiquetaEstado, Tarjeta, useAvisos } from '../../components/ui';
import type { TonoEtiqueta } from '../../components/ui/EtiquetaEstado';
import estilos from '../panel/Panel.module.css';

// T091 · Pagos por revisar del administrador de la plataforma (US4; FR-025a): pagos duplicados, importes
// distintos, aprobaciones posteriores a un rechazo, devoluciones o contracargos, y notificaciones de pagos
// desconocidos. Cada caso de un pago se marca resuelto con una nota; no mueve dinero (la devolución o el cobro
// se hacen fuera de la plataforma) y queda en la auditoría de la barbería.

const CLAVE = ['plataforma', 'pagos-por-revisar'] as const;
const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fechaHora = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Lima',
});

/** Cada marca con las palabras de FR-025a y qué hacer. */
const MARCAS: Record<PagoPorRevisar['marca'], { texto: string; tono: TonoEtiqueta; ayuda: string }> = {
  DUPLICADO: {
    texto: 'Pago duplicado',
    tono: 'aviso',
    ayuda: 'El período ya estaba pagado: devuelve el dinero fuera de la plataforma y anota cómo.',
  },
  IMPORTE_DISTINTO: {
    texto: 'Importe distinto',
    tono: 'error',
    ayuda:
      'El proveedor informó otro importe: no se aplicó ningún período. Acuerda la diferencia con la barbería.',
  },
  APROBADO_TRAS_RECHAZO: {
    texto: 'Aprobado tras un rechazo',
    tono: 'aviso',
    ayuda:
      'El proveedor aprobó un pago ya rechazado: decide si se devuelve o se aplica por activación manual.',
  },
  DEVOLUCION: {
    texto: 'Devolución o contracargo',
    tono: 'error',
    ayuda: 'El proveedor devolvió el dinero: la suscripción no cambió. Revisa el caso con la barbería.',
  },
  SIN_PAGO: {
    texto: 'Notificación sin pago',
    tono: 'neutro',
    ayuda:
      'El proveedor notificó un pago que no existe en la plataforma: revísalo en su panel con este identificador.',
  },
};

const esquema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, 'Escribe la nota (de 5 a 300 caracteres).')
    .max(300, 'Máximo 300 caracteres.'),
});

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  return error.message;
}

function Resolver({
  caso,
  alResolver,
}: {
  caso: PagoPorRevisar & { pagoId: string };
  alResolver: () => void;
}) {
  const avisar = useAvisos();
  const formulario = useForm<z.infer<typeof esquema>>({ resolver: zodResolver(esquema) });
  const resolver = useMutation({
    mutationFn: ({ motivo }: z.infer<typeof esquema>) =>
      apiPagosPorRevisar.resolver(caso.barberia?.id as string, caso.pagoId, motivo),
    onSuccess: () => {
      avisar({ tono: 'exito', titulo: 'Caso resuelto' });
      alResolver();
    },
  });
  return (
    <form
      className={estilos.formulario}
      aria-label={`Resolver el caso de ${caso.barberia?.nombre ?? 'la barbería'}`}
      noValidate
      onSubmit={formulario.handleSubmit((datos) => resolver.mutate(datos))}
    >
      <Campo
        id={`nota-${caso.pagoId}`}
        etiqueta="Nota de la resolución"
        ayuda="Qué se hizo y dónde (por ejemplo, la operación de la devolución). Queda guardada con el pago."
        registro={formulario.register('motivo')}
        error={formulario.formState.errors.motivo?.message}
      />
      {resolver.isError && <Alerta>{mensajeDeError(resolver.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={resolver.isPending} textoCargando="Guardando…">
          Marcar como resuelto
        </Boton>
      </div>
    </form>
  );
}

function Caso({ caso, alResolver }: { caso: PagoPorRevisar; alResolver: () => void }) {
  const marca = MARCAS[caso.marca];
  const titulo = caso.barberia?.nombre ?? 'Sin barbería';
  const partes = [
    caso.importeCentimos !== null ? soles.format(caso.importeCentimos / 100) : null,
    `detectado el ${fechaHora.format(new Date(caso.detectadoEn))}`,
  ].filter(Boolean);
  return (
    <li>
      <Tarjeta
        titulo={titulo}
        descripcion={partes.join(' · ')}
        icono="dinero"
        acciones={<EtiquetaEstado tono={marca.tono}>{marca.texto}</EtiquetaEstado>}
      >
        <p className={estilos.aviso}>{marca.ayuda}</p>
        {caso.eventoId && (
          <p className={estilos.enlace}>
            Evento del proveedor: <code>{caso.eventoId}</code>
          </p>
        )}
        {caso.pagoId && caso.barberia ? (
          <Resolver caso={{ ...caso, pagoId: caso.pagoId }} alResolver={alResolver} />
        ) : (
          <p className={estilos.aviso} role="note">
            Sin pago en la plataforma no hay nada que marcar aquí: deja de aparecer a los 30 días.
          </p>
        )}
      </Tarjeta>
    </li>
  );
}

/** /plataforma/pagos-por-revisar · Casos por revisar, del más antiguo al más reciente. */
export default function PagosPorRevisarPagina() {
  const consultas = useQueryClient();
  const lista = useQuery({ queryKey: CLAVE, queryFn: apiPagosPorRevisar.lista });
  const recargar = () => void consultas.invalidateQueries({ queryKey: CLAVE });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Plataforma', a: '/plataforma' }, { etiqueta: 'Pagos por revisar' }]}
        antetitulo="Administración"
        titulo="Pagos por revisar"
        descripcion="Casos que el sistema no resolvió solo. Marcarlos resueltos no mueve dinero: deja constancia de lo que hiciste."
      />
      {lista.isError ? (
        <Alerta>{mensajeDeError(lista.error)}</Alerta>
      ) : !lista.data ? (
        <p aria-busy="true">Cargando los casos…</p>
      ) : lista.data.length === 0 ? (
        <EstadoVacio icono="check" titulo="No hay pagos por revisar" descripcion="Todo está al día." />
      ) : (
        <ul className={estilos.lista} aria-label="Pagos por revisar">
          {lista.data.map((caso) => (
            <Caso key={caso.pagoId ?? caso.eventoId} caso={caso} alResolver={recargar} />
          ))}
        </ul>
      )}
    </>
  );
}
