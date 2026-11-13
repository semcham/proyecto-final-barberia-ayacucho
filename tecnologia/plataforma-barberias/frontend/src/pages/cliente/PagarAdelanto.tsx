import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { type AdelantoDeCita, apiAdelanto, clavesAdelanto } from '../../api/adelanto';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { Icono } from '../../components/Icono';
import { Logo } from '../../components/Logo';
import {
  Alerta,
  Boton,
  Campo,
  CampoArchivo,
  clasesBoton,
  EtiquetaEstado,
  Tarjeta,
  useAvisos,
} from '../../components/ui';
import { fechaDeBarberia, horaConEtiqueta } from '../../hora-barberia';
import { Cargando } from '../panel/Cargando';
import { mensajeDeError } from '../panel/datos-barberia';
import panel from '../panel/Panel.module.css';
import estilosPago from './PagarAdelanto.module.css';
import estilos from './MisCitas.module.css';
import { ESTADO_ADELANTO, soles } from './textos-adelanto';

// T033 de 008 · El cliente paga el adelanto de su cita (US2; FR-008 a FR-011): ve el QR de la barbería, el monto, el
// código de su reserva (para escribirlo en el mensaje del pago) y la hora límite, en texto y con los minutos que le
// quedan; registra el número de operación y, si quiere, una captura. Después ve el estado: por revisar, rechazado
// (con el motivo, y puede registrar otro número), confirmado (con el saldo), vencido o resuelto al cancelar.

type Catalogo = components['schemas']['CatalogoPublico'];

const MAXIMO_CAPTURA = 5 * 1024 * 1024;
const TIPOS_CAPTURA = ['image/jpeg', 'image/png', 'application/pdf'];
const ERROR_NUMERO = 'Escribe el número de operación de tu pago (de 4 a 20 letras o dígitos).';
const ERROR_TIPO_CAPTURA = 'La captura debe ser una imagen JPG o PNG, o un PDF.';
const ERROR_TAMANO_CAPTURA = 'La captura pesa más de 5 MB.';

const esquema = z.object({
  numeroOperacion: z
    .string()
    .refine((valor) => /^[A-Za-z0-9]{4,20}$/.test(valor.replace(/\s+/g, '')), ERROR_NUMERO),
  captura: z
    .custom<FileList | undefined>()
    .refine((lista) => !lista?.[0] || lista[0].size <= MAXIMO_CAPTURA, ERROR_TAMANO_CAPTURA)
    .refine((lista) => !lista?.[0] || TIPOS_CAPTURA.includes(lista[0].type), ERROR_TIPO_CAPTURA),
});
type Formulario = z.infer<typeof esquema>;

/** Un error del servidor al registrar el pago, en palabras del cliente. */
function mensajeDeRegistro(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.codigo) {
      case 'NUMERO_OPERACION_REPETIDO':
        return 'Ese número de operación ya se registró en esta barbería. Revisa el número de tu pago.';
      case 'ADELANTO_VENCIDO':
        return 'Pasó la hora límite para registrar el pago del adelanto.';
      case 'PAGO_YA_REGISTRADO':
        return 'Ya registraste tu pago. Espera la revisión de la barbería.';
      case 'VALIDACION': {
        const detalle = error.detalles[0];
        if (detalle?.campo === 'numeroOperacion') return ERROR_NUMERO;
        if (detalle?.problema === 'demasiado_grande' || error.estado === 413) return ERROR_TAMANO_CAPTURA;
        if (detalle?.campo === 'archivo') return ERROR_TIPO_CAPTURA;
        break;
      }
      default:
        break;
    }
    if (error.estado === 413) return ERROR_TAMANO_CAPTURA;
  }
  return mensajeDeError(error);
}

/** URL `blob:` local de un archivo, revocada al cambiar de archivo o al cerrar la pantalla. */
function useUrlLocal(archivo: Blob | null | undefined): string | null {
  const url = useMemo(() => (archivo ? URL.createObjectURL(archivo) : null), [archivo]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** Minutos que faltan para la hora límite, actualizados cada 30 s (texto, no solo visual). */
function useMinutosRestantes(horaLimite: string): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(intervalo);
  }, []);
  return Math.max(0, Math.ceil((Date.parse(horaLimite) - ahora) / 60_000));
}

export default function PagarAdelanto() {
  const { citaId = '' } = useParams();
  const { usuario } = useSesion();
  const barberia = usuario?.barberia;
  const catalogo = useQuery({
    queryKey: clavesConsulta.catalogo(barberia?.slug ?? ''),
    queryFn: () =>
      llamarApi<Catalogo>(`/publico/${encodeURIComponent(barberia?.slug ?? '')}`, { sinRenovar: true }),
    enabled: Boolean(barberia?.slug),
  });
  const zona = catalogo.data?.barberia.zonaHoraria ?? 'America/Lima';
  const adelanto = useQuery({
    queryKey: clavesAdelanto.deCita(citaId),
    queryFn: () => apiAdelanto.deCita(citaId),
  });

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo />
        <Link to="/mis-citas" className={clasesBoton({ variante: 'fantasma', tamano: 'sm' })}>
          <Icono nombre="chevronIzquierda" tamano={18} />
          Volver a mis citas
        </Link>
      </header>
      <div className={estilos.titulo}>
        <p className="antetitulo">{barberia?.nombre}</p>
        <h1>Pagar adelanto</h1>
        <p className={panel.aviso}>
          El adelanto lo pagas directo a la barbería con su QR de Yape o Plin. La plataforma no recibe tu
          dinero.
        </p>
      </div>
      {adelanto.data ? (
        <ContenidoDelAdelanto citaId={citaId} adelanto={adelanto.data} zona={zona} />
      ) : adelanto.isError ? (
        <Alerta>{mensajeDeError(adelanto.error)}</Alerta>
      ) : (
        <Cargando texto="Cargando el adelanto de tu cita…" />
      )}
    </main>
  );
}

function ContenidoDelAdelanto({
  citaId,
  adelanto,
  zona,
}: {
  citaId: string;
  adelanto: AdelantoDeCita;
  zona: string;
}) {
  const estado = ESTADO_ADELANTO[adelanto.estado];
  const rechazado = adelanto.estado === 'POR_PAGAR' && adelanto.pago?.resultado === 'RECHAZADO';
  const etiqueta = <EtiquetaEstado tono={estado.tono}>{estado.texto}</EtiquetaEstado>;

  switch (adelanto.estado) {
    case 'POR_PAGAR':
      return (
        <>
          <Instrucciones citaId={citaId} adelanto={adelanto} zona={zona} etiqueta={etiqueta} />
          <Tarjeta titulo="Registra tu pago" icono="documento">
            {rechazado && (
              <Alerta>
                La barbería rechazó tu pago: {adelanto.pago?.motivoRechazo}. Puedes registrar otro número
                antes de la hora límite.
              </Alerta>
            )}
            <FormularioDePago citaId={citaId} />
          </Tarjeta>
        </>
      );
    case 'POR_REVISAR':
      return (
        <Tarjeta titulo="Tu pago" icono="reloj">
          <div className={panel.formulario}>
            {etiqueta}
            <p role="status">La barbería está revisando tu pago. Te avisaremos cuando lo confirme.</p>
            <dl className={panel.lista} aria-label="Tu registro de pago">
              <div className={panel.elemento}>
                <dt className={panel.elementoDetalle}>Número de operación</dt>
                <dd className={panel.elementoNombre}>{adelanto.pago?.numeroOperacion}</dd>
              </div>
              <div className={panel.elemento}>
                <dt className={panel.elementoDetalle}>Revisión hasta</dt>
                <dd className={panel.elementoNombre}>
                  {fechaDeBarberia(adelanto.limiteRevision, zona)},{' '}
                  {horaConEtiqueta(adelanto.limiteRevision, zona)}
                </dd>
              </div>
            </dl>
          </div>
        </Tarjeta>
      );
    case 'CONFIRMADO':
      return (
        <Tarjeta titulo="Tu adelanto" icono="check">
          <div className={panel.formulario}>
            {etiqueta}
            <p>Tu adelanto está confirmado y tu cita también.</p>
            <p>
              El día de tu cita pagas el saldo: {soles(adelanto.saldoCentimos)} (adelanto{' '}
              {soles(adelanto.montoCentimos)}).
            </p>
          </div>
        </Tarjeta>
      );
    default:
      return (
        <Tarjeta titulo="Tu adelanto" icono="info">
          <div className={panel.formulario}>
            {etiqueta}
            <p>{textoDeResuelto(adelanto)}</p>
          </div>
        </Tarjeta>
      );
  }
}

/** El texto de un adelanto que ya no se paga. */
function textoDeResuelto(adelanto: AdelantoDeCita): string {
  switch (adelanto.estado) {
    case 'VENCIDO':
      return 'El plazo para pagar venció y la cita se canceló. El horario quedó libre.';
    case 'ANULADO':
      return 'La cita se canceló antes de que registraras el pago.';
    case 'POR_DEVOLVER':
      return 'La cita se canceló: la barbería debe devolverte el adelanto si lo recibió.';
    case 'DEVUELTO':
      return 'La barbería marcó el adelanto como devuelto.';
    case 'RETENIDO':
      return 'La barbería retiene el adelanto de esta cita.';
    default:
      return '';
  }
}

function Instrucciones({
  citaId,
  adelanto,
  zona,
  etiqueta,
}: {
  citaId: string;
  adelanto: AdelantoDeCita;
  zona: string;
  etiqueta: ReactNode;
}) {
  const avisar = useAvisos();
  const qr = useQuery({
    queryKey: clavesAdelanto.qrDeCita(citaId),
    queryFn: () => apiAdelanto.qrDeCita(citaId),
  });
  const urlQr = useUrlLocal(qr.data);
  const minutos = useMinutosRestantes(adelanto.horaLimite);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(adelanto.codigo);
      avisar({ tono: 'exito', titulo: 'Código copiado' });
    } catch {
      avisar({ tono: 'error', titulo: 'No se pudo copiar', descripcion: adelanto.codigo });
    }
  };

  return (
    <Tarjeta titulo="Cómo pagar" icono="celular">
      <div className={panel.formulario}>
        {etiqueta}
        <div className={estilosPago.pago}>
          {urlQr ? (
            <img className={estilosPago.qr} src={urlQr} alt="QR de Yape o Plin de la barbería" />
          ) : qr.isError ? (
            <Alerta>{mensajeDeError(qr.error)}</Alerta>
          ) : (
            <Cargando texto="Cargando el QR…" />
          )}
          <dl className={panel.lista} aria-label="Datos del pago">
            <div className={panel.elemento}>
              <dt className={panel.elementoDetalle}>Monto del adelanto</dt>
              <dd className={`${panel.elementoNombre} ${estilosPago.monto}`}>
                {soles(adelanto.montoCentimos)}
              </dd>
            </div>
            <div className={panel.elemento}>
              <dt className={panel.elementoDetalle}>Código de tu reserva</dt>
              <dd className={`${panel.elementoNombre} ${estilosPago.codigo}`}>
                <span>{adelanto.codigo}</span>
                <Boton
                  type="button"
                  variante="secundario"
                  tamano="sm"
                  icono="copiar"
                  onClick={() => void copiar()}
                >
                  Copiar código
                </Boton>
              </dd>
            </div>
            <div className={panel.elemento}>
              <dt className={panel.elementoDetalle}>Paga antes del</dt>
              <dd className={panel.elementoNombre}>
                {fechaDeBarberia(adelanto.horaLimite, zona)}, {horaConEtiqueta(adelanto.horaLimite, zona)}
              </dd>
            </div>
          </dl>
        </div>
        <p className={panel.aviso}>
          {minutos > 0
            ? `Te ${minutos === 1 ? 'queda 1 minuto' : `quedan ${minutos} minutos`} para pagar y registrar tu pago.`
            : 'La hora límite ya pasó.'}{' '}
          Escribe el código de tu reserva en el mensaje del pago, para que la barbería lo reconozca.
        </p>
      </div>
    </Tarjeta>
  );
}

function FormularioDePago({ citaId }: { citaId: string }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), defaultValues: { numeroOperacion: '' } });

  const registrar = useMutation({
    mutationFn: (datos: Formulario) =>
      apiAdelanto.registrarPago(citaId, {
        numeroOperacion: datos.numeroOperacion,
        captura: datos.captura?.[0],
      }),
    onSuccess: (adelanto) => {
      consultas.setQueryData(clavesAdelanto.deCita(citaId), adelanto);
      void consultas.invalidateQueries({ queryKey: ['mis-citas'] });
      avisar({ tono: 'exito', titulo: 'Pago registrado' });
    },
    onError: (error) => {
      // Otro registro ganó o la hora límite pasó: el estado del adelanto se vuelve a pedir.
      if (error instanceof ApiError && ['PAGO_YA_REGISTRADO', 'ADELANTO_VENCIDO'].includes(error.codigo)) {
        void consultas.invalidateQueries({ queryKey: clavesAdelanto.deCita(citaId), refetchType: 'none' });
      }
    },
  });

  return (
    <form
      className={panel.formulario}
      aria-label="Registrar mi pago"
      noValidate
      onSubmit={handleSubmit((datos) => registrar.mutate(datos))}
    >
      <Campo
        id="numeroOperacion"
        etiqueta="Número de operación"
        autoComplete="off"
        registro={register('numeroOperacion')}
        error={errors.numeroOperacion?.message}
        ayuda="Lo ves en tu aplicación de Yape o Plin, en el detalle del pago."
      />
      <CampoArchivo
        id="captura"
        etiqueta="Captura del pago (opcional)"
        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        ayuda="Imagen JPG o PNG, o un PDF, de hasta 5 MB. Solo la ven tú y la barbería."
        registro={register('captura')}
        error={errors.captura?.message as string | undefined}
      />
      {registrar.isError && <Alerta>{mensajeDeRegistro(registrar.error)}</Alerta>}
      <div className={panel.acciones}>
        <Boton type="submit" icono="subir" cargando={registrar.isPending} textoCargando="Registrando…">
          Registrar pago
        </Boton>
      </div>
    </form>
  );
}
