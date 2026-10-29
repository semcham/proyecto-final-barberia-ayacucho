import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clavesConsulta } from '../../api/claves';
import { llamarApi } from '../../api/client';
import type { components as Componentes001 } from '../../api/schema';
import type { components as Componentes002 } from '../../api/schema-002';
import {
  apiSuscripcion,
  type EstadoPago,
  type EstadoSuscripcion,
  type Plan,
  type Suscripcion,
} from '../../api/suscripcion';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Alerta, Boton, EtiquetaEstado, Tarjeta } from '../../components/ui';
import type { TonoEtiqueta } from '../../components/ui/EtiquetaEstado';
import { salirA } from '../../navegacion';
import { Cargando } from './Cargando';
import { mensajeDeError } from './datos-barberia';
import estilos from './Panel.module.css';
import { SeccionTransferencia } from './Transferencia';

type PaginaUsuarios = Componentes001['schemas']['PaginaUsuarios'];
type Barbero = Componentes002['schemas']['Barbero'];

/** Al volver del proveedor, la pantalla consulta el pago hasta 60 s (R15). */
const ESPERA_MAXIMA_MS = 60_000;
const INTERVALO_MS = 1000;

const ESTADOS: Record<EstadoSuscripcion, { texto: string; tono: TonoEtiqueta }> = {
  TRIAL: { texto: 'En prueba', tono: 'acento' },
  ACTIVE: { texto: 'Activa', tono: 'exito' },
  PAST_DUE: { texto: 'En período de gracia', tono: 'aviso' },
  EXPIRED: { texto: 'Vencida', tono: 'error' },
  CANCELLED: { texto: 'Cancelada', tono: 'neutro' },
  SUSPENDED: { texto: 'Suspendida', tono: 'error' },
};

const ESTADOS_PAGO: Record<EstadoPago, string> = {
  PENDIENTE: 'pendiente de confirmación',
  ESPERANDO_COMPROBANTE: 'esperando comprobante',
  EN_REVISION: 'comprobante en revisión',
  APROBADO: 'aprobado',
  RECHAZADO: 'rechazado',
  ANULADO: 'anulado',
  EXPIRADO: 'expirado',
};

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fecha = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' });

const formatoSoles = (centimos: number) => soles.format(centimos / 100);
const formatoFecha = (iso: string | null | undefined) => (iso ? fecha.format(new Date(iso)) : '—');
const plural = (n: number, singular: string, varios: string) => `${n} ${n === 1 ? singular : varios}`;

function EstadoActual({ suscripcion }: { suscripcion: Suscripcion }) {
  const { texto, tono } = ESTADOS[suscripcion.estado];
  const hasta = suscripcion.estado === 'TRIAL' ? suscripcion.finPrueba : suscripcion.finCobertura;
  return (
    <Tarjeta
      titulo="Tu suscripción"
      icono="dinero"
      acciones={<EtiquetaEstado tono={tono}>{texto}</EtiquetaEstado>}
    >
      <dl className={estilos.lista}>
        <div className={estilos.elemento}>
          <dt className={estilos.elementoDetalle}>Plan</dt>
          <dd className={estilos.elementoNombre}>{suscripcion.plan.nombre}</dd>
        </div>
        <div className={estilos.elemento}>
          <dt className={estilos.elementoDetalle}>
            {suscripcion.estado === 'TRIAL' ? 'La prueba termina el' : 'Cubierta hasta el'}
          </dt>
          <dd className={estilos.elementoNombre}>
            {formatoFecha(hasta)} · {plural(suscripcion.diasRestantes, 'día', 'días')}
          </dd>
        </div>
        <div className={estilos.elemento}>
          <dt className={estilos.elementoDetalle}>Tu plan permite</dt>
          <dd className={estilos.elementoNombre}>
            {plural(suscripcion.limites.maxUsuarios ?? 0, 'usuario', 'usuarios')} y{' '}
            {plural(suscripcion.limites.maxBarberos ?? 0, 'barbero', 'barberos')}
          </dd>
        </div>
        {suscripcion.proximoPeriodo && (
          <div className={estilos.elemento}>
            <dt className={estilos.elementoDetalle}>Próximo período pagado</dt>
            <dd className={estilos.elementoNombre}>
              {suscripcion.proximoPeriodo.plan?.nombre} desde el{' '}
              {formatoFecha(suscripcion.proximoPeriodo.iniciaEn)}
            </dd>
          </div>
        )}
        {suscripcion.pagoAbierto && (
          <div className={estilos.elemento}>
            <dt className={estilos.elementoDetalle}>Pago en curso</dt>
            <dd className={estilos.elementoNombre}>
              {suscripcion.pagoAbierto.plan.nombre} · {formatoSoles(suscripcion.pagoAbierto.importeCentimos)}{' '}
              · {ESTADOS_PAGO[suscripcion.pagoAbierto.estado]}
            </dd>
          </div>
        )}
      </dl>
      <Avisos suscripcion={suscripcion} />
    </Tarjeta>
  );
}

function Avisos({ suscripcion }: { suscripcion: Suscripcion }) {
  const avisos = suscripcion.avisos;
  if (avisos.length === 0) return null;
  return (
    <div className={estilos.aviso}>
      {avisos.includes('EN_GRACIA') && (
        <p>
          Tu período terminó. Tienes hasta el {formatoFecha(suscripcion.finGracia)} para pagar sin que tu
          barbería deje de recibir reservas.
        </p>
      )}
      {avisos.includes('PRUEBA_POR_TERMINAR') && (
        <p>Tu prueba gratuita está por terminar. Elige un plan para seguir recibiendo reservas.</p>
      )}
      {avisos.includes('VENCIDA') && (
        <p>
          Tu suscripción venció: tu barbería no recibe reservas nuevas. Al pagar, vuelve a recibirlas de
          inmediato.
        </p>
      )}
      {avisos.includes('SUSPENDIDA') && (
        <p>
          Tu suscripción está suspendida
          {suscripcion.motivoSuspension ? `: ${suscripcion.motivoSuspension}` : '.'}
        </p>
      )}
    </div>
  );
}

/** Aviso de FR-005a: lo que la barbería usa hoy frente a los límites del plan elegido. */
function AvisoLimites({ plan }: { plan: Plan }) {
  const usuarios = useQuery({
    queryKey: ['usuarios', 'todos'],
    queryFn: () => llamarApi<PaginaUsuarios>('/usuarios?tamano=100'),
  });
  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
  });
  if (!usuarios.data || !barberos.data) return null;
  const enUso = {
    usuarios: usuarios.data.datos.filter((u) => u.estado !== 'DESACTIVADA').length,
    barberos: barberos.data.filter((b) => b.activo).length,
  };
  if (enUso.usuarios <= plan.maxUsuarios && enUso.barberos <= plan.maxBarberos) return null;
  return (
    <p className={estilos.aviso} role="note">
      El plan {plan.nombre} permite {plural(plan.maxUsuarios, 'usuario', 'usuarios')} y{' '}
      {plural(plan.maxBarberos, 'barbero', 'barberos')}, y hoy tienes{' '}
      {plural(enUso.usuarios, 'usuario', 'usuarios')} y {plural(enUso.barberos, 'barbero', 'barberos')}{' '}
      activos. Nada se desactiva solo, pero cuando empiece ese plan no podrás crear ni reactivar usuarios o
      barberos hasta quedar dentro del límite.
    </p>
  );
}

function ElegirPlan({ planes }: { planes: Plan[] }) {
  const consultas = useQueryClient();
  const [elegido, setElegido] = useState<string | null>(null);
  const plan = planes.find((p) => p.id === elegido) ?? null;
  const pagar = useMutation({
    mutationFn: (planId: string) => apiSuscripcion.iniciarPago(planId, 'YAPE'),
    onSuccess: ({ urlPago }) => {
      if (urlPago) salirA(urlPago);
    },
  });
  // US3: la transferencia queda esperando el comprobante; sus datos se muestran en la sección de abajo.
  const transferir = useMutation({
    mutationFn: (planId: string) => apiSuscripcion.iniciarPago(planId, 'TRANSFERENCIA'),
    onSuccess: (iniciado) => {
      consultas.setQueryData(['suscripcion', 'transferencia', iniciado.pago.id], iniciado);
      void consultas.invalidateQueries({ queryKey: ['suscripcion'], exact: true });
    },
  });
  const conYape = plan?.mediosDisponibles.includes('YAPE') ?? false;
  const conTransferencia = plan?.mediosDisponibles.includes('TRANSFERENCIA') ?? false;

  return (
    <Tarjeta
      titulo="Elige tu plan"
      descripcion="Pagas cada mes por adelantado. Los precios son referenciales."
      icono="tarjetaTachada"
    >
      <fieldset className={estilos.casillas}>
        <legend>Planes</legend>
        {planes.map((p) => (
          <label key={p.id}>
            <input
              type="radio"
              name="plan"
              value={p.id}
              checked={elegido === p.id}
              onChange={() => setElegido(p.id)}
            />{' '}
            <strong>{p.nombre}</strong> · {formatoSoles(p.precioCentimos)} al mes ·{' '}
            {plural(p.maxUsuarios, 'usuario', 'usuarios')} y {plural(p.maxBarberos, 'barbero', 'barberos')}
          </label>
        ))}
      </fieldset>
      {plan && <AvisoLimites plan={plan} />}
      {plan && !conYape && <p className={estilos.aviso}>Este plan no se puede pagar con Yape.</p>}
      {pagar.isError && <Alerta>{mensajeDeError(pagar.error)}</Alerta>}
      {transferir.isError && <Alerta>{mensajeDeError(transferir.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton
          disabled={!plan || !conYape}
          cargando={pagar.isPending || pagar.isSuccess}
          textoCargando="Abriendo Yape…"
          onClick={() => plan && pagar.mutate(plan.id)}
        >
          Pagar con Yape
        </Boton>
        <Boton
          variante="secundario"
          disabled={!plan || !conTransferencia}
          cargando={transferir.isPending}
          textoCargando="Preparando…"
          onClick={() => plan && transferir.mutate(plan.id)}
        >
          Pagar por transferencia
        </Boton>
      </div>
    </Tarjeta>
  );
}

/** Al volver del proveedor (?pago=…): consulta el pago hasta que el servidor lo confirme o pase un minuto. */
function ResultadoDelPago({ pagoId }: { pagoId: string }) {
  const consultas = useQueryClient();
  const [desde] = useState(() => Date.now());
  const pago = useQuery({
    queryKey: ['suscripcion', 'pago', pagoId],
    queryFn: () => apiSuscripcion.pago(pagoId),
    refetchInterval: (consulta) =>
      consulta.state.data?.estado === 'PENDIENTE' && Date.now() - desde < ESPERA_MAXIMA_MS
        ? INTERVALO_MS
        : false,
  });
  const estado = pago.data?.estado;
  // Pasado el minuto, la pantalla deja de esperar y lo dice (sin leer el reloj durante el render).
  const [agotado, setAgotado] = useState(false);
  useEffect(() => {
    const temporizador = setTimeout(() => setAgotado(true), ESPERA_MAXIMA_MS);
    return () => clearTimeout(temporizador);
  }, []);
  useEffect(() => {
    if (estado && estado !== 'PENDIENTE') void consultas.invalidateQueries({ queryKey: ['suscripcion'] });
  }, [estado, consultas]);

  if (pago.isError) return <Alerta>{mensajeDeError(pago.error)}</Alerta>;
  if (!pago.data || estado === 'PENDIENTE') {
    return agotado ? (
      <p className={estilos.aviso}>
        Tu pago sigue pendiente de confirmación. Te avisaremos aquí apenas el proveedor lo confirme.
      </p>
    ) : (
      <p role="status" aria-busy="true">
        Confirmando tu pago con el proveedor…
      </p>
    );
  }
  if (estado === 'APROBADO') {
    return (
      <Alerta tono="exito">
        Pago aprobado
        {pago.data.marca === 'DUPLICADO'
          ? ' (pago duplicado: lo revisaremos y te devolveremos el dinero)'
          : ''}
        .
        {pago.data.periodo
          ? ` Tu período va del ${formatoFecha(pago.data.periodo.iniciaEn)} al ${formatoFecha(pago.data.periodo.terminaEn)}.`
          : ''}
      </Alerta>
    );
  }
  return <Alerta>El pago quedó {ESTADOS_PAGO[pago.data.estado]}. Puedes intentarlo de nuevo.</Alerta>;
}

/**
 * Suscripción de la barbería (HU17, HU18; RF19 a RF23): estado, planes, pago con Yape y por transferencia con
 * comprobante. Solo el propietario.
 */
export default function SuscripcionPagina() {
  const [parametros] = useSearchParams();
  const pagoId = parametros.get('pago');
  const suscripcion = useQuery({ queryKey: ['suscripcion'], queryFn: apiSuscripcion.suscripcion });
  const planes = useQuery({ queryKey: ['planes'], queryFn: apiSuscripcion.planes });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Suscripción' }]}
        titulo="Suscripción"
        descripcion="El estado de tu plan y el pago de cada mes. La confirmación del pago la da el proveedor, no esta pantalla."
      />
      {pagoId && <ResultadoDelPago pagoId={pagoId} />}
      <div className={estilos.distribucion}>
        {suscripcion.isError ? (
          <Alerta>{mensajeDeError(suscripcion.error)}</Alerta>
        ) : suscripcion.data ? (
          <div className={estilos.secciones}>
            <EstadoActual suscripcion={suscripcion.data} />
            <SeccionTransferencia suscripcion={suscripcion.data} />
          </div>
        ) : (
          <Cargando />
        )}
        {planes.isError ? (
          <Alerta>{mensajeDeError(planes.error)}</Alerta>
        ) : planes.data ? (
          <ElegirPlan planes={planes.data} />
        ) : (
          <Cargando />
        )}
      </div>
    </>
  );
}
