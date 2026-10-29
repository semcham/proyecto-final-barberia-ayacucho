import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { apiComprobantesPlataforma, type ComprobantePorRevisar, type Revision } from '../../api/plataforma';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { useArchivoLocal } from '../../components/archivo-local';
import { Alerta, Boton, Campo, EstadoVacio, EtiquetaEstado, Tarjeta, useAvisos } from '../../components/ui';
import estilos from '../panel/Panel.module.css';

// T084 · Comprobantes por revisar del administrador de la plataforma (US3; FR-022 a FR-024; R05, R09). La cola
// solo trae los últimos 4 caracteres del número de operación; el número completo, en el detalle (H2). El
// archivo se ve como una URL `blob:` local que se revoca a los 60 s.

const CLAVE_COLA = ['plataforma', 'comprobantes'] as const;
const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fechaHora = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Lima',
});

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  return error.message;
}

const esquemaAprobar = z.object({
  importe: z
    .string()
    .trim()
    .regex(/^[0-9]{1,5}(\.[0-9]{1,2})?$/, 'Escribe el importe que ves en la cuenta, por ejemplo 49 o 49.00.'),
});
const esquemaRechazar = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, 'Explica el motivo (de 5 a 300 caracteres).')
    .max(300, 'Máximo 300 caracteres.'),
});

/** Soles escritos ("49.9") a céntimos enteros, sin decimales flotantes (FR-005b). */
function aCentimos(texto: string): number {
  const [enteros, decimales = ''] = texto.split('.');
  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

function Revisar({ item, alTerminar }: { item: ComprobantePorRevisar; alTerminar: () => void }) {
  const avisar = useAvisos();
  const [modo, setModo] = useState<'APROBAR' | 'RECHAZAR' | null>(null);
  const aprobar = useForm<z.infer<typeof esquemaAprobar>>({ resolver: zodResolver(esquemaAprobar) });
  const rechazar = useForm<z.infer<typeof esquemaRechazar>>({ resolver: zodResolver(esquemaRechazar) });
  const revision = useMutation({
    mutationFn: (datos: Revision) => apiComprobantesPlataforma.revisar(item.barberia.id, item.pago.id, datos),
    onSuccess: (_pago, datos) => {
      avisar({
        tono: 'exito',
        titulo: datos.resultado === 'APROBADO' ? 'Comprobante aprobado' : 'Comprobante rechazado',
      });
      alTerminar();
    },
  });

  return (
    <div className={estilos.formulario}>
      <div className={estilos.acciones}>
        <Boton
          type="button"
          variante={modo === 'APROBAR' ? 'primario' : 'secundario'}
          onClick={() => setModo('APROBAR')}
        >
          Aprobar
        </Boton>
        <Boton
          type="button"
          variante={modo === 'RECHAZAR' ? 'peligro' : 'secundario'}
          onClick={() => setModo('RECHAZAR')}
        >
          Rechazar
        </Boton>
      </div>
      {modo === 'APROBAR' && (
        <form
          className={estilos.formulario}
          aria-label={`Aprobar el pago de ${item.barberia.nombre}`}
          noValidate
          onSubmit={aprobar.handleSubmit(({ importe }) =>
            revision.mutate({ resultado: 'APROBADO', importeTransferidoCentimos: aCentimos(importe) }),
          )}
        >
          <Campo
            id={`importe-${item.pago.id}`}
            etiqueta="Importe recibido en la cuenta (S/)"
            inputMode="decimal"
            ayuda={`Debe ser exactamente ${soles.format(item.pago.importeCentimos / 100)}.`}
            registro={aprobar.register('importe')}
            error={aprobar.formState.errors.importe?.message}
          />
          <Boton type="submit" cargando={revision.isPending} textoCargando="Aprobando…">
            Confirmar la aprobación
          </Boton>
        </form>
      )}
      {modo === 'RECHAZAR' && (
        <form
          className={estilos.formulario}
          aria-label={`Rechazar el pago de ${item.barberia.nombre}`}
          noValidate
          onSubmit={rechazar.handleSubmit(({ motivo }) =>
            revision.mutate({ resultado: 'RECHAZADO', motivo }),
          )}
        >
          <Campo
            id={`motivo-${item.pago.id}`}
            etiqueta="Motivo del rechazo"
            ayuda="El propietario lo verá. No incluyas datos de la cuenta ni del pagador."
            registro={rechazar.register('motivo')}
            error={rechazar.formState.errors.motivo?.message}
          />
          <Boton type="submit" variante="peligro" cargando={revision.isPending} textoCargando="Rechazando…">
            Confirmar el rechazo
          </Boton>
        </form>
      )}
      {revision.isError && <Alerta>{mensajeDeError(revision.error)}</Alerta>}
    </div>
  );
}

function ElementoDeLaCola({ item, alTerminar }: { item: ComprobantePorRevisar; alTerminar: () => void }) {
  const archivo = useArchivoLocal();
  const [error, setError] = useState<string | null>(null);
  const [numeroCompleto, setNumeroCompleto] = useState<string | null>(null);
  const { pago, barberia } = item;
  const archivoRepetido = !pago.numeroRepetido && pago.numeroYaUsadoEn.length > 0;

  const verArchivo = async () => {
    setError(null);
    try {
      archivo.mostrar(await apiComprobantesPlataforma.archivo(barberia.id, pago.id));
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  };
  const verNumero = async () => {
    setError(null);
    try {
      setNumeroCompleto((await apiComprobantesPlataforma.detalle(barberia.id, pago.id)).numeroOperacion);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  };

  return (
    <li>
      <Tarjeta
        titulo={barberia.nombre}
        descripcion={`Plan ${pago.plan} · ${soles.format(pago.importeCentimos / 100)} · enviado el ${fechaHora.format(new Date(item.enviadoEn))}`}
        icono="dinero"
        acciones={
          pago.numeroRepetido ? (
            <EtiquetaEstado tono="error">Número ya usado</EtiquetaEstado>
          ) : archivoRepetido ? (
            <EtiquetaEstado tono="aviso">Archivo repetido</EtiquetaEstado>
          ) : undefined
        }
      >
        <dl className={estilos.lista}>
          <div className={estilos.elemento}>
            <dt className={estilos.elementoDetalle}>Referencia</dt>
            <dd className={estilos.elementoNombre}>{pago.referencia}</dd>
          </div>
          <div className={estilos.elemento}>
            <dt className={estilos.elementoDetalle}>Número de operación</dt>
            <dd className={estilos.elementoNombre}>
              {numeroCompleto ?? `•••• ${pago.numeroOperacionFinal}`}
            </dd>
          </div>
          <div className={estilos.elemento}>
            <dt className={estilos.elementoDetalle}>Fecha de la transferencia</dt>
            <dd className={estilos.elementoNombre}>{pago.fechaTransferencia}</dd>
          </div>
        </dl>
        {pago.numeroRepetido && (
          <p className={estilos.aviso} role="note">
            Este número de operación ya figura en otro pago. Si ese pago fue aprobado, este no se podrá
            aprobar.
          </p>
        )}
        {archivoRepetido && (
          <p className={estilos.aviso} role="note">
            El mismo archivo se subió en otro pago: revisa que no sea un comprobante reutilizado.
          </p>
        )}
        <div className={estilos.acciones}>
          <Boton type="button" variante="secundario" onClick={() => void verArchivo()}>
            Ver comprobante
          </Boton>
          {!numeroCompleto && (
            <Boton type="button" variante="fantasma" onClick={() => void verNumero()}>
              Ver número completo
            </Boton>
          )}
          {archivo.url && (
            <a href={archivo.url} target="_blank" rel="noopener noreferrer">
              Abrir el comprobante (el enlace dura 1 minuto)
            </a>
          )}
        </div>
        {error && <Alerta>{error}</Alerta>}
        <Revisar item={item} alTerminar={alTerminar} />
      </Tarjeta>
    </li>
  );
}

/** /plataforma/comprobantes · Cola de comprobantes por revisar, del más antiguo al más reciente. */
export default function ComprobantesPlataforma() {
  const consultas = useQueryClient();
  const cola = useQuery({ queryKey: CLAVE_COLA, queryFn: apiComprobantesPlataforma.cola });
  const recargar = () => void consultas.invalidateQueries({ queryKey: CLAVE_COLA });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Plataforma', a: '/plataforma' }, { etiqueta: 'Comprobantes' }]}
        antetitulo="Administración"
        titulo="Comprobantes por revisar"
        descripcion="Aprueba solo si el importe llegó a la cuenta. Cada comprobante se revisa una sola vez."
      />
      {cola.isError ? (
        <Alerta>{mensajeDeError(cola.error)}</Alerta>
      ) : !cola.data ? (
        <p aria-busy="true">Cargando la cola…</p>
      ) : cola.data.length === 0 ? (
        <EstadoVacio
          icono="check"
          titulo="No hay comprobantes por revisar"
          descripcion="La cola está al día."
        />
      ) : (
        <ul className={estilos.lista} aria-label="Comprobantes por revisar">
          {cola.data.map((item) => (
            <ElementoDeLaCola key={item.pago.id} item={item} alTerminar={recargar} />
          ))}
        </ul>
      )}
    </>
  );
}
