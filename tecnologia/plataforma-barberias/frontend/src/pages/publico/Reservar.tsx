import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { PantallaCarga } from '../../auth/PantallaCarga';
import { RutaProtegida } from '../../auth/RutaProtegida';
import { useSesion } from '../../auth/SesionProvider';
import { ConfirmarCancelacion } from '../../components/app/ConfirmarCancelacion';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { EstadoVacio } from '../../components/ui/EstadoVacio';
import { Tarjeta } from '../../components/ui/Tarjeta';
import { fechaDeBarberia, fechaIsoDeBarberia, horaConEtiqueta, horaDeBarberia } from '../../hora-barberia';
import estilos from './Reservar.module.css';
import { FormularioUnion, mensajeDeError } from './Union';

type Catalogo = components['schemas']['CatalogoPublico'];
type Cita = components['schemas']['Cita'];
type SolicitudReserva = components['schemas']['ReservarCitaRequest'];

/** Conflictos que vuelven al catálogo con los horarios del día actualizados. */
const CONFLICTOS = new Set(['HORARIO_NO_DISPONIBLE', 'CITA_SOLAPADA_DEL_CLIENTE']);

/** Ruta de reserva: exige sesión de cliente; sin sesión, lleva al ingreso de esta barbería. */
export function ReservarProtegida() {
  const { slug = '' } = useParams();
  return (
    <RutaProtegida roles={['CLIENTE']} ingreso={`/b/${slug}/ingresar`}>
      <Reservar />
    </RutaProtegida>
  );
}

/**
 * Reserva de una cita (HU10, RF12). La selección (servicio, barbero e inicio) llega en la dirección desde el
 * catálogo. Primero deja la sesión en esta barbería (`asegurarBarberia`, ADR-020) y luego muestra la
 * confirmación.
 */
export default function Reservar() {
  const { slug = '' } = useParams();
  const [parametros] = useSearchParams();
  const { usuario, asegurarBarberia } = useSesion();
  const enEstaBarberia = usuario?.barberia.slug === slug;
  const [union, setUnion] = useState<string | null>(null);
  const [errorCambio, setErrorCambio] = useState<string | null>(null);
  const intentado = useRef<string | null>(null);

  useEffect(() => {
    if (enEstaBarberia || intentado.current === slug) return;
    intentado.current = slug;
    asegurarBarberia(slug).catch((causa: unknown) => {
      if (causa instanceof ApiError && causa.codigo === 'UNIRSE_REQUIERE_CONSENTIMIENTO')
        setUnion(causa.message);
      else setErrorCambio(mensajeDeError(causa));
    });
  }, [enEstaBarberia, slug, asegurarBarberia]);

  const seleccion = {
    servicioId: parametros.get('servicio') ?? '',
    barberoId: parametros.get('barbero') ?? '',
    inicio: parametros.get('inicio') ?? '',
  };

  let contenido;
  if (enEstaBarberia) {
    // Con `key`, otra selección monta una confirmación nueva: otra Idempotency-Key y sin errores previos.
    contenido = (
      <ConfirmarReserva
        key={`${seleccion.servicioId}|${seleccion.barberoId}|${seleccion.inicio}`}
        slug={slug}
        seleccion={seleccion}
      />
    );
  } else if (union) {
    contenido = <FormularioUnion mensaje={union} alUnirse={(datos) => asegurarBarberia(slug, datos)} />;
  } else if (errorCambio) {
    contenido = <Alerta>{errorCambio}</Alerta>;
  } else {
    return <PantallaCarga />;
  }

  return (
    <MarcoAcceso
      antetitulo="Reserva en línea"
      titular="Tu cita, sin llamadas ni esperas"
      descripcion="Revisa los datos y confirma. La hora es siempre la de la barbería."
    >
      {contenido}
    </MarcoAcceso>
  );
}

function ConfirmarReserva({ slug, seleccion }: { slug: string; seleccion: SolicitudReserva }) {
  const navegar = useNavigate();
  const consultas = useQueryClient();
  // Se genera al abrir la confirmación y se reutiliza en cada reintento: el servidor no duplica la cita (R09).
  const [clave] = useState(() => crypto.randomUUID());
  const catalogo = useQuery({
    queryKey: clavesConsulta.catalogo(slug),
    queryFn: () => llamarApi<Catalogo>(`/publico/${encodeURIComponent(slug)}`),
  });

  const reserva = useMutation({
    mutationFn: () =>
      llamarApi<Cita>('/citas', {
        metodo: 'POST',
        cuerpo: {
          servicioId: seleccion.servicioId,
          barberoId: seleccion.barberoId,
          inicio: seleccion.inicio,
        } satisfies SolicitudReserva,
        encabezados: { 'Idempotency-Key': clave },
      }),
    onError: (error) => {
      if (!(error instanceof ApiError) || !CONFLICTOS.has(error.codigo) || !catalogo.data) return;
      // Otro cliente ganó el horario: los horarios guardados de la barbería quedan vencidos y el catálogo
      // vuelve a pedir los del mismo día.
      void consultas.invalidateQueries({ queryKey: clavesConsulta.horarios(slug) });
      const fecha = fechaIsoDeBarberia(seleccion.inicio, catalogo.data.barberia.zonaHoraria);
      const destino = new URLSearchParams({ servicio: seleccion.servicioId, fecha });
      navegar(`/b/${slug}?${destino}`, { state: { mensaje: error.message } });
    },
  });

  if (catalogo.isPending) {
    return <p aria-busy="true">Cargando los datos de tu cita…</p>;
  }
  if (catalogo.isError) {
    return <Alerta>{mensajeDeError(catalogo.error)}</Alerta>;
  }

  const { barberia, servicios, barberos } = catalogo.data;
  const zona = barberia.zonaHoraria;
  const servicio = servicios.find((s) => s.id === seleccion.servicioId);
  const barbero = barberos.find((b) => b.id === seleccion.barberoId);
  const inicioValido = !Number.isNaN(Date.parse(seleccion.inicio));
  const volver = (
    <Link to={`/b/${slug}`} className={clasesBoton({ variante: 'secundario' })}>
      Volver a la barbería
    </Link>
  );

  if (!servicio || !barbero || !inicioValido) {
    return (
      <EstadoVacio
        icono="calendario"
        titulo="Esta selección ya no está disponible"
        descripcion="Elige de nuevo el servicio, el barbero y la hora."
        accion={volver}
      />
    );
  }

  if (reserva.data) {
    return <CitaReservada cita={reserva.data} zona={zona} />;
  }

  return (
    <Tarjeta titulo="Confirma tu cita" icono="calendario">
      <DatosCita
        filas={[
          ['Barbería', barberia.nombre],
          ['Servicio', servicio.nombre],
          ['Barbero', barbero.nombre],
          ['Fecha', fechaDeBarberia(seleccion.inicio, zona)],
          ['Hora', horaConEtiqueta(seleccion.inicio, zona)],
          ['Duración', `${servicio.duracionMinutos} min`],
          ['Precio', `S/ ${servicio.precio}`],
        ]}
      />
      {reserva.isError && <Alerta>{mensajeDeError(reserva.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton
          type="button"
          bloque
          cargando={reserva.isPending}
          textoCargando="Reservando…"
          onClick={() => reserva.mutate()}
        >
          Confirmar reserva
        </Boton>
        {volver}
      </div>
    </Tarjeta>
  );
}

/** Cita recién reservada, con la opción de cancelarla (RF14) avisando si sería tardía (FR-038). */
function CitaReservada({ cita: reservada, zona }: { cita: Cita; zona: string }) {
  const [cita, setCita] = useState(reservada);
  const [confirmando, setConfirmando] = useState(false);
  const cancelar = useMutation({
    mutationFn: () => llamarApi<Cita>(`/citas/${cita.id}/cancelar`, { metodo: 'POST' }),
    onSuccess: (cancelada) => {
      setConfirmando(false);
      setCita(cancelada);
    },
    onError: () => setConfirmando(false),
  });
  const cancelada = cita.estado === 'CANCELADA';

  return (
    <Tarjeta
      titulo={cancelada ? 'Tu cita fue cancelada' : 'Tu cita está confirmada'}
      icono={cancelada ? 'cerrar' : 'check'}
      destacada={!cancelada}
    >
      <DatosCita
        filas={[
          ['Barbería', cita.barberia],
          ['Servicio', cita.servicio],
          ['Barbero', cita.barbero],
          ['Fecha', fechaDeBarberia(cita.inicio, zona)],
          ['Hora', horaConEtiqueta(cita.inicio, zona)],
          ['Termina', horaDeBarberia(cita.fin, zona)],
          ['Precio', `S/ ${cita.precio}`],
          ...(cancelada
            ? [
                ['Estado', cita.cancelacionTardia ? 'Cancelada (cancelación tardía)' : 'Cancelada'] as [
                  string,
                  string,
                ],
              ]
            : []),
        ]}
      />
      {cancelar.isError && <Alerta>{mensajeDeError(cancelar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Link to="/mis-citas" className={clasesBoton({ bloque: true })}>
          Ver mis citas
        </Link>
        {!cancelada && (
          <Boton type="button" variante="secundario" bloque onClick={() => setConfirmando(true)}>
            Cancelar cita
          </Boton>
        )}
      </div>
      {confirmando && (
        <ConfirmarCancelacion
          cita={cita}
          zona={zona}
          comoCliente
          cargando={cancelar.isPending}
          onConfirmar={() => cancelar.mutate()}
          onCerrar={() => setConfirmando(false)}
        />
      )}
    </Tarjeta>
  );
}

function DatosCita({ filas }: { filas: [string, string][] }) {
  return (
    <dl className={estilos.datos}>
      {filas.map(([termino, valor]) => (
        <div key={termino}>
          <dt>{termino}</dt>
          <dd>{valor}</dd>
        </div>
      ))}
    </dl>
  );
}
