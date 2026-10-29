import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { apiSuscripcion, type Pago, type PagoIniciado, type Suscripcion } from '../../api/suscripcion';
import { useArchivoLocal } from '../../components/archivo-local';
import { Alerta, Boton, Campo, CampoArchivo, Tarjeta } from '../../components/ui';
import { mensajeDeError } from './datos-barberia';
import estilos from './Panel.module.css';

// T084 · Transferencia bancaria con comprobante (US3; FR-019 a FR-021; R05, R09): los datos de la cuenta y la
// referencia, la subida del comprobante y su estado, y el motivo si el administrador lo rechazó.

const MAXIMO_BYTES = 5 * 1024 * 1024;
const TIPOS = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';
/** Último pago por transferencia de esta barbería, para mostrar su rechazo después de recargar. */
const CLAVE_ULTIMA = 'ultima-transferencia';

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

const recordar = {
  leer(): string | null {
    try {
      return localStorage.getItem(CLAVE_ULTIMA);
    } catch {
      return null;
    }
  },
  guardar(pagoId: string): void {
    try {
      localStorage.setItem(CLAVE_ULTIMA, pagoId);
    } catch {
      // Sin almacenamiento (ventana privada): solo se pierde el aviso de rechazo tras recargar.
    }
  },
  olvidar(): void {
    try {
      localStorage.removeItem(CLAVE_ULTIMA);
    } catch {
      // Igual que arriba.
    }
  },
};

const esquema = z.object({
  archivo: z
    .custom<FileList>()
    .refine((lista) => lista?.length === 1, 'Elige el archivo del comprobante.')
    .refine((lista) => !lista?.[0] || lista[0].size <= MAXIMO_BYTES, 'El archivo pesa más de 5 MB.'),
  numeroOperacion: z
    .string()
    .trim()
    .refine(
      (valor) => /^[A-Za-z0-9]{6,40}$/.test(valor.replace(/[\s.\-_/]/g, '')),
      'Escribe el número de operación del voucher (de 6 a 40 letras o dígitos).',
    ),
  fechaTransferencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de la transferencia.')
    .refine((fecha) => fecha <= hoy(), 'La fecha no puede ser posterior a hoy.'),
});
type Formulario = z.infer<typeof esquema>;

/** Mensaje de un error del servidor al subir: los problemas de VALIDACION, en palabras del propietario. */
function mensajeDeSubida(error: unknown): string {
  if (error instanceof ApiError && error.codigo === 'VALIDACION') {
    const problema = error.detalles[0]?.problema;
    if (problema === 'tipo_no_permitido') return 'El archivo debe ser una imagen JPG o PNG, o un PDF.';
    if (problema === 'demasiado_grande') return 'El archivo pesa más de 5 MB.';
    if (error.detalles[0]?.campo === 'numeroOperacion') return 'Revisa el número de operación del voucher.';
    if (error.detalles[0]?.campo === 'fechaTransferencia') {
      return 'Revisa la fecha: debe ser de los últimos 30 días y no posterior a hoy.';
    }
  }
  return mensajeDeError(error);
}

export function DatosTransferencia({ datos }: { datos: NonNullable<PagoIniciado['transferencia']> }) {
  const filas: [string, string][] = [
    ['Banco', datos.banco ?? ''],
    ['Titular', datos.titular ?? ''],
    ['Número de cuenta', datos.numeroCuenta ?? ''],
    ['CCI', datos.cci ?? ''],
    ['Importe exacto', soles.format((datos.importeCentimos ?? 0) / 100)],
    ['Referencia', datos.referencia ?? ''],
  ];
  return (
    <div className={estilos.formulario}>
      <dl className={estilos.lista} aria-label="Datos de la transferencia">
        {filas.map(([termino, valor]) => (
          <div key={termino} className={estilos.elemento}>
            <dt className={estilos.elementoDetalle}>{termino}</dt>
            <dd className={estilos.elementoNombre}>{valor}</dd>
          </div>
        ))}
      </dl>
      <p className={estilos.aviso}>
        Transfiere el importe exacto y escribe la referencia en el concepto. Luego sube el voucher aquí: lo
        revisamos y, al aprobarlo, tu período empieza sin que hagas nada más.
      </p>
    </div>
  );
}

function FormularioComprobante({ pagoId, alSubir }: { pagoId: string; alSubir: (pago: Pago) => void }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Formulario>({
    resolver: zodResolver(esquema),
    defaultValues: { numeroOperacion: '', fechaTransferencia: hoy() },
  });
  const subir = useMutation({
    mutationFn: (datos: Formulario) =>
      apiSuscripcion.subirComprobante(pagoId, {
        archivo: datos.archivo[0],
        numeroOperacion: datos.numeroOperacion,
        fechaTransferencia: datos.fechaTransferencia,
      }),
    onSuccess: (pago) => {
      reset();
      alSubir(pago);
    },
  });

  return (
    <form
      className={estilos.formulario}
      aria-label="Comprobante de la transferencia"
      noValidate
      onSubmit={handleSubmit((datos) => subir.mutate(datos))}
    >
      <CampoArchivo
        id="archivo"
        etiqueta="Voucher o captura de la transferencia"
        accept={TIPOS}
        ayuda="Imagen JPG o PNG, o un PDF, de hasta 5 MB."
        registro={register('archivo')}
        error={errors.archivo?.message as string | undefined}
      />
      <div className={estilos.fila}>
        <Campo
          id="numeroOperacion"
          etiqueta="Número de operación"
          autoComplete="off"
          registro={register('numeroOperacion')}
          error={errors.numeroOperacion?.message}
        />
        <Campo
          id="fechaTransferencia"
          etiqueta="Fecha de la transferencia"
          type="date"
          registro={register('fechaTransferencia')}
          error={errors.fechaTransferencia?.message}
        />
      </div>
      {subir.isError && <Alerta>{mensajeDeSubida(subir.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={subir.isPending} textoCargando="Enviando…">
          Enviar comprobante
        </Boton>
      </div>
    </form>
  );
}

/** El comprobante ya enviado, que el propietario puede volver a ver (URL local que se revoca a los 60 s). */
function VerMiComprobante({ pagoId }: { pagoId: string }) {
  const archivo = useArchivoLocal();
  const [error, setError] = useState<string | null>(null);
  const abrir = async () => {
    setError(null);
    try {
      archivo.mostrar(await apiSuscripcion.comprobante(pagoId));
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  };
  return (
    <div className={estilos.acciones}>
      <Boton type="button" variante="secundario" onClick={() => void abrir()}>
        Ver el comprobante enviado
      </Boton>
      {archivo.url && (
        <a href={archivo.url} target="_blank" rel="noopener noreferrer">
          Abrir el comprobante (el enlace dura 1 minuto)
        </a>
      )}
      {error && <Alerta>{error}</Alerta>}
    </div>
  );
}

/** El pago por transferencia que espera el comprobante: sus datos (el servidor devuelve el mismo pago). */
function EsperandoComprobante({ pago }: { pago: Pago }) {
  const consultas = useQueryClient();
  // POST con el mismo plan y medio: el servidor devuelve el pago abierto igual (200), sin crear otro (FR-012).
  const datos = useQuery({
    queryKey: ['suscripcion', 'transferencia', pago.id],
    queryFn: () => apiSuscripcion.iniciarPago(pago.plan.id as string, 'TRANSFERENCIA'),
    staleTime: Infinity,
  });
  if (datos.isError) return <Alerta>{mensajeDeError(datos.error)}</Alerta>;
  if (!datos.data?.transferencia) return <p aria-busy="true">Cargando los datos de la transferencia…</p>;
  return (
    <>
      <DatosTransferencia datos={datos.data.transferencia} />
      <FormularioComprobante
        pagoId={pago.id}
        alSubir={(subido) => {
          recordar.guardar(subido.id);
          void consultas.invalidateQueries({ queryKey: ['suscripcion'], exact: true });
        }}
      />
    </>
  );
}

/** El último comprobante fue rechazado: el motivo y el acceso a enviar otro. */
function Rechazado({ pago }: { pago: Pago }) {
  const consultas = useQueryClient();
  const otra = useMutation({
    mutationFn: () => apiSuscripcion.iniciarPago(pago.plan.id as string, 'TRANSFERENCIA'),
    onSuccess: (iniciado) => {
      recordar.olvidar();
      // Los datos ya llegaron: se guardan y solo se vuelve a pedir la suscripción (sin repetir este POST).
      consultas.setQueryData(['suscripcion', 'transferencia', iniciado.pago.id], iniciado);
      void consultas.invalidateQueries({ queryKey: ['suscripcion'], exact: true });
    },
  });
  return (
    <div className={estilos.formulario}>
      <Alerta>
        Rechazamos tu comprobante{pago.motivoRechazo ? `: ${pago.motivoRechazo}` : '.'} Si ya transferiste,
        envía otro comprobante con los datos correctos.
      </Alerta>
      {otra.isError && <Alerta>{mensajeDeError(otra.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton
          type="button"
          cargando={otra.isPending}
          textoCargando="Preparando…"
          onClick={() => otra.mutate()}
        >
          Enviar otro comprobante
        </Boton>
      </div>
    </div>
  );
}

/**
 * Sección de la transferencia en /app/suscripcion. Se muestra si hay una transferencia abierta, o si el último
 * comprobante fue rechazado (para avisar el motivo). El historial completo llega con US4.
 */
export function SeccionTransferencia({ suscripcion }: { suscripcion: Suscripcion }) {
  const abierto = suscripcion.pagoAbierto;
  const conTransferencia = abierto?.medio === 'TRANSFERENCIA' ? abierto : null;
  const [ultima] = useState(() => (conTransferencia ? null : recordar.leer()));
  const anterior = useQuery({
    queryKey: ['suscripcion', 'pago', ultima],
    queryFn: () => apiSuscripcion.pago(ultima as string),
    enabled: ultima !== null,
    retry: false,
  });

  let contenido = null;
  if (conTransferencia?.estado === 'ESPERANDO_COMPROBANTE') {
    contenido = <EsperandoComprobante pago={conTransferencia} />;
  } else if (conTransferencia?.estado === 'EN_REVISION') {
    contenido = (
      <div className={estilos.formulario}>
        <p role="status" className={estilos.aviso}>
          Tu comprobante está en revisión
          {conTransferencia.numeroOperacionFinal
            ? ` (operación terminada en ${conTransferencia.numeroOperacionFinal})`
            : ''}
          . Te avisaremos aquí cuando lo aprobemos o, si hay un problema, el motivo.
        </p>
        <VerMiComprobante pagoId={conTransferencia.id} />
      </div>
    );
  } else if (anterior.data?.estado === 'RECHAZADO' && anterior.data.medio === 'TRANSFERENCIA') {
    contenido = <Rechazado pago={anterior.data} />;
  }
  if (!contenido) return null;

  return (
    <Tarjeta titulo="Transferencia bancaria" icono="dinero">
      {contenido}
    </Tarjeta>
  );
}
