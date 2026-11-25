import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AdelantoDeCita } from '../../api/adelanto';
import { clavesConsulta } from '../../api/claves';
import { ApiError, esRestriccionDeSuscripcion, llamarApi } from '../../api/client';
import { esCorreoNoVerificado } from '../../api/cuenta';
import type { components } from '../../api/schema-002';
import { apiSuscripcion } from '../../api/suscripcion';
import { PantallaCarga } from '../../auth/PantallaCarga';
import { RutaProtegida } from '../../auth/RutaProtegida';
import { useSesion } from '../../auth/SesionProvider';
import { AvisoVerificacion } from '../../components/app/AvisoVerificacion';
import { ConfirmarCancelacion } from '../../components/app/ConfirmarCancelacion';
import { DisenoCliente } from '../../components/app/DisenoCliente';
import { Icono, type NombreIcono } from '../../components/Icono';
import { iniciales } from '../../components/iniciales';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { Esqueleto } from '../../components/ui/Esqueleto';
import { EstadoVacio } from '../../components/ui/EstadoVacio';
import {
  ETIQUETA_HORA_BARBERIA,
  fechaDeBarberia,
  fechaIsoDeBarberia,
  horaConEtiqueta,
  horaDeBarberia,
  sumarDiasIso,
} from '../../hora-barberia';
import { HORIZONTE_RESERVA_DIAS } from '../../legal';
import { EncabezadoCliente } from '../cliente/EncabezadoCliente';
import estilos from './Reservar.module.css';
import { FormularioUnion, mensajeDeError } from './Union';

type Catalogo = components['schemas']['CatalogoPublico'];
type Horarios = components['schemas']['HorariosLibres'];
/** 008 (CitaConAdelanto): la Cita de 002 y, con el adelanto activo, su adelanto. */
type Cita = components['schemas']['Cita'] & { adelanto?: AdelantoDeCita | null };
type SolicitudReserva = components['schemas']['ReservarCitaRequest'];

/** Conflictos que vuelven a elegir la hora con los horarios del día actualizados. */
const CONFLICTOS = new Set(['HORARIO_NO_DISPONIBLE', 'CITA_SOLAPADA_DEL_CLIENTE']);
/** Valor de `barbero` en la dirección para "el primero libre" (se resuelve al elegir la hora). */
const CUALQUIERA = 'cualquiera';
const PASOS = ['Servicio', 'Barbero', 'Día y hora', 'Confirmar'] as const;

/** "mar 24 nov · 10:30": la fecha y la hora cortas del resumen fijo (en la hora de la barbería). */
function fechaCorta(inicio: string, zona: string): string {
  const dia = new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: zona,
  })
    .format(new Date(inicio))
    .replace(/\./g, '')
    .replace(',', '');
  return `${dia} · ${horaDeBarberia(inicio, zona)}`;
}

/** Ruta de reserva: exige sesión de cliente; sin sesión, lleva al ingreso de esta barbería y vuelve aquí. */
export function ReservarProtegida() {
  const { slug = '' } = useParams();
  return (
    <RutaProtegida roles={['CLIENTE']} ingreso={`/b/${slug}/ingresar`}>
      <Reservar />
    </RutaProtegida>
  );
}

/**
 * Reservar una cita (HU10, HU11; RF11, RF12), dentro del panel del cliente (rediseño del 2026-11-24). Primero deja la
 * sesión en esta barbería (`asegurarBarberia`, ADR-020): si el cliente aún no es de ella, pide su consentimiento para
 * unirse (409 UNIRSE_REQUIERE_CONSENTIMIENTO, sin cambios). Luego el flujo guiado: servicio, barbero, día y hora, y
 * confirmar. El estado del flujo vive en la dirección (`servicio`, `barbero`, `fecha` e `inicio`): el botón Atrás y un
 * enlace con todo elegido (por ejemplo, desde el asistente) funcionan igual.
 */
export default function Reservar() {
  const { slug = '' } = useParams();
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

  if (enEstaBarberia) {
    return (
      <DisenoCliente>
        <FlujoReserva slug={slug} />
      </DisenoCliente>
    );
  }
  if (!union && !errorCambio) return <PantallaCarga />;
  return (
    <MarcoAcceso
      antetitulo="Reserva en línea"
      titular="Tu cita, sin llamadas ni esperas"
      descripcion="Revisa los datos y confirma. La hora es siempre la de la barbería."
    >
      {union ? (
        <SeccionCita titulo="Únete a esta barbería" icono="tienda">
          <FormularioUnion mensaje={union} alUnirse={(datos) => asegurarBarberia(slug, datos)} />
        </SeccionCita>
      ) : (
        <SeccionCita titulo="No pudimos preparar tu reserva" icono="alerta" tono="neutro">
          <Alerta>{errorCambio}</Alerta>
        </SeccionCita>
      )}
    </MarcoAcceso>
  );
}

function FlujoReserva({ slug }: { slug: string }) {
  const { usuario } = useSesion();
  const [parametros, setParametros] = useSearchParams();
  const catalogo = useQuery({
    queryKey: clavesConsulta.catalogo(slug),
    queryFn: () => llamarApi<Catalogo>(`/publico/${encodeURIComponent(slug)}`),
  });
  // Con la sesión ya en esta barbería: si su suscripción no permite reservar, se avisa antes de elegir (FR-006 de 003).
  const operativo = useQuery({
    queryKey: ['suscripcion', 'estado-operativo', slug],
    queryFn: apiSuscripcion.estadoOperativo,
  });

  if (catalogo.isPending || operativo.isPending) return <ReservaCargando />;
  if (catalogo.isError) {
    return (
      <>
        <EncabezadoCliente titulo="Reservar una cita" />
        <Alerta>{mensajeDeError(catalogo.error)}</Alerta>
      </>
    );
  }
  if (operativo.data && !operativo.data.aceptaReservas) {
    return (
      <>
        <EncabezadoCliente titulo="Reservar una cita" />
        <EstadoVacio
          icono="calendario"
          titulo={operativo.data.mensaje ?? 'Esta barbería no acepta reservas por ahora'}
          descripcion={`${catalogo.data.barberia.nombre} no está recibiendo reservas en línea en este momento. Vuelve a intentarlo más tarde o comunícate con la barbería.`}
          accion={
            <Link to={`/b/${slug}`} className={clasesBoton({ variante: 'secundario' })}>
              Volver a la barbería
            </Link>
          }
        />
      </>
    );
  }

  const { servicios, barberos } = catalogo.data;
  const servicio = servicios.find((s) => s.id === parametros.get('servicio'));
  const barberoParam = parametros.get('barbero');
  const barbero = barberos.find((b) => b.id === barberoParam);
  const barberoElegido = Boolean(barbero) || barberoParam === CUALQUIERA;
  const inicio = parametros.get('inicio');
  const inicioValido = inicio !== null && !Number.isNaN(Date.parse(inicio));
  const paso = !servicio ? 1 : !barberoElegido ? 2 : !(inicioValido && barbero) ? 3 : 4;

  /** Cambia la dirección del flujo (con `replace` solo los ajustes del mismo paso). */
  const ir = (cambios: Record<string, string | null>, reemplazar = false) => {
    const nuevos = new URLSearchParams(parametros);
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === null) nuevos.delete(clave);
      else nuevos.set(clave, valor);
    }
    setParametros(nuevos, { replace: reemplazar });
  };
  const volverAlPaso = (destino: number) => {
    if (destino === 1) ir({ servicio: null, barbero: null, inicio: null });
    else if (destino === 2) ir({ barbero: null, inicio: null });
    else if (destino === 3) ir({ inicio: null });
  };

  return (
    <div className={estilos.flujo}>
      <EncabezadoCliente
        antetitulo={catalogo.data.barberia.nombre}
        titulo="Reservar una cita"
        descripcion={`Las horas son siempre en ${ETIQUETA_HORA_BARBERIA}.`}
      />
      <Progreso paso={paso} alVolver={volverAlPaso} />

      {/* En los pasos 1 a 3 se avisa de entrada; en el 4 el aviso va junto al botón de confirmar (una sola vez). */}
      {usuario?.correoVerificado === false && paso < 4 && <AvisoVerificacion accion="reservar" />}

      {paso === 1 && (
        <PasoServicio
          servicios={servicios}
          elegido={servicio?.id ?? null}
          alElegir={(id) => ir({ servicio: id, barbero: null, inicio: null })}
        />
      )}
      {paso === 2 && servicio && (
        <PasoBarbero
          barberos={barberos.filter((b) => b.servicioIds.includes(servicio.id))}
          alElegir={(id) => ir({ barbero: id, inicio: null })}
        />
      )}
      {paso === 3 && servicio && (
        <PasoHora
          slug={slug}
          catalogo={catalogo.data}
          servicio={servicio}
          barberoId={barbero?.id ?? null}
          fecha={parametros.get('fecha')}
          alCambiarFecha={(fecha) => ir({ fecha }, true)}
          alContinuar={(hora, barberoId) => ir({ inicio: hora, barbero: barberoId })}
        />
      )}
      {paso === 4 && servicio && barbero && inicio && (
        <PasoConfirmar
          // Otra selección es otra reserva: una Idempotency-Key nueva (la clave vive en el estado del paso).
          key={`${servicio.id}|${barbero.id}|${inicio}`}
          slug={slug}
          catalogo={catalogo.data}
          seleccion={{ servicioId: servicio.id, barberoId: barbero.id, inicio }}
          alConflicto={(fecha) => ir({ inicio: null, fecha })}
          alCambiar={volverAlPaso}
        />
      )}
    </div>
  );
}

/** Indicador de progreso: los pasos ya hechos se pueden tocar para volver. */
function Progreso({ paso, alVolver }: { paso: number; alVolver: (paso: number) => void }) {
  return (
    <nav aria-label="Pasos de la reserva">
      <ol className={estilos.progreso}>
        {PASOS.map((nombre, i) => {
          const numero = i + 1;
          const estado = numero < paso ? 'hecho' : numero === paso ? 'actual' : 'pendiente';
          const contenido = (
            <>
              <span className={estilos.progresoNumero} aria-hidden="true">
                {estado === 'hecho' ? <Icono nombre="check" tamano={14} /> : numero}
              </span>
              <span className={estilos.progresoNombre}>{nombre}</span>
            </>
          );
          return (
            <li key={nombre} className={estilos.progresoPaso} data-estado={estado}>
              {estado === 'hecho' ? (
                <button
                  type="button"
                  className={estilos.progresoBoton}
                  onClick={() => alVolver(numero)}
                  aria-label={`Paso ${numero}, ${nombre}: hecho. Cambiar`}
                >
                  {contenido}
                </button>
              ) : (
                <span
                  className={estilos.progresoBoton}
                  aria-current={estado === 'actual' ? 'step' : undefined}
                >
                  <span className="sr-only">Paso {numero}: </span>
                  {contenido}
                  {estado === 'actual' && <span className="sr-only"> (paso actual)</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function TituloPaso({ children }: { children: ReactNode }) {
  return <h2 className={estilos.tituloPaso}>{children}</h2>;
}

function PasoServicio({
  servicios,
  elegido,
  alElegir,
}: {
  servicios: Catalogo['servicios'];
  elegido: string | null;
  alElegir: (id: string) => void;
}) {
  if (servicios.length === 0) {
    return <EstadoVacio icono="tijeras" titulo="Esta barbería está preparando su catálogo. Vuelve pronto." />;
  }
  return (
    <section className={estilos.paso} aria-labelledby="paso-servicio">
      <TituloPaso>
        <span id="paso-servicio">¿Qué servicio quieres?</span>
      </TituloPaso>
      <ul className={estilos.opciones}>
        {servicios.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={estilos.opcion}
              aria-pressed={s.id === elegido}
              onClick={() => alElegir(s.id)}
            >
              <span className={estilos.opcionTextos}>
                <span className={estilos.opcionTitulo}>{s.nombre}</span>
                {s.descripcion && <span className={estilos.opcionDetalle}>{s.descripcion}</span>}
                <span className={estilos.opcionMeta}>
                  <Icono nombre="reloj" tamano={16} />
                  {s.duracionMinutos} min
                </span>
              </span>
              <span className={estilos.opcionPrecio}>S/ {s.precio}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PasoBarbero({
  barberos,
  alElegir,
}: {
  barberos: Catalogo['barberos'];
  alElegir: (id: string) => void;
}) {
  return (
    <section className={estilos.paso} aria-labelledby="paso-barbero">
      <TituloPaso>
        <span id="paso-barbero">¿Con quién?</span>
      </TituloPaso>
      {barberos.length === 0 ? (
        <EstadoVacio
          icono="usuarios"
          titulo="Ningún barbero ofrece este servicio por ahora"
          descripcion="Elige otro servicio."
        />
      ) : (
        <ul className={estilos.opciones}>
          <li>
            <button type="button" className={estilos.opcion} onClick={() => alElegir(CUALQUIERA)}>
              <span className={estilos.avatar} data-tono="acento" aria-hidden="true">
                <Icono nombre="usuarios" tamano={20} />
              </span>
              <span className={estilos.opcionTextos}>
                <span className={estilos.opcionTitulo}>Cualquier barbero</span>
                <span className={estilos.opcionDetalle}>
                  Te asignamos el primero libre a la hora que elijas.
                </span>
              </span>
              <Icono nombre="chevronDerecha" tamano={18} />
            </button>
          </li>
          {barberos.map((b) => (
            <li key={b.id}>
              <button type="button" className={estilos.opcion} onClick={() => alElegir(b.id)}>
                <span className={estilos.avatar} aria-hidden="true">
                  {iniciales(b.nombre)}
                </span>
                <span className={estilos.opcionTextos}>
                  <span className={estilos.opcionTitulo}>{b.nombre}</span>
                </span>
                <Icono nombre="chevronDerecha" tamano={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Los próximos días que se pueden reservar; los que la barbería no atiende (según su horario) quedan apagados. */
function diasReservables(catalogo: Catalogo) {
  const zona = catalogo.barberia.zonaHoraria;
  const hoy = fechaIsoDeBarberia(new Date(), zona);
  const atiende = new Set(catalogo.horario.tramos.map((t) => t.diaSemana));
  return Array.from({ length: HORIZONTE_RESERVA_DIAS + 1 }, (_, i) => {
    const fecha = sumarDiasIso(hoy, i);
    const mediodia = new Date(`${fecha}T12:00:00Z`);
    const diaSemana = mediodia.getUTCDay();
    return {
      fecha,
      abierto: atiende.size === 0 || atiende.has(diaSemana),
      diaCorto: new Intl.DateTimeFormat('es-PE', { weekday: 'short', timeZone: 'UTC' })
        .format(mediodia)
        .replace('.', ''),
      numero: mediodia.getUTCDate(),
      mes: new Intl.DateTimeFormat('es-PE', { month: 'short', timeZone: 'UTC' })
        .format(mediodia)
        .replace('.', ''),
      etiqueta: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : null,
    };
  });
}

const FRANJAS: { nombre: string; desde: number; hasta: number }[] = [
  { nombre: 'Mañana', desde: 0, hasta: 12 },
  { nombre: 'Tarde', desde: 12, hasta: 18 },
  { nombre: 'Noche', desde: 18, hasta: 24 },
];

function PasoHora({
  slug,
  catalogo,
  servicio,
  barberoId,
  fecha: fechaParam,
  alCambiarFecha,
  alContinuar,
}: {
  slug: string;
  catalogo: Catalogo;
  servicio: Catalogo['servicios'][number];
  barberoId: string | null;
  fecha: string | null;
  alCambiarFecha: (fecha: string) => void;
  alContinuar: (inicio: string, barberoId: string) => void;
}) {
  const zona = catalogo.barberia.zonaHoraria;
  const dias = diasReservables(catalogo);
  const primeraAbierta = dias.find((d) => d.abierto)?.fecha ?? dias[0].fecha;
  const fecha = fechaParam && dias.some((d) => d.fecha === fechaParam) ? fechaParam : primeraAbierta;
  const [elegida, setElegida] = useState<string | null>(null);
  const idDias = useId();

  const horarios = useQuery({
    queryKey: clavesConsulta.horarios(slug, servicio.id, fecha),
    queryFn: () =>
      llamarApi<Horarios>(
        `/publico/${encodeURIComponent(slug)}/horarios?${new URLSearchParams({ servicio: servicio.id, fecha })}`,
      ),
  });
  const horas = (horarios.data?.horas ?? []).filter((h) => !barberoId || h.barberoIds.includes(barberoId));
  const hora = horas.find((h) => h.inicio === elegida);
  // Con "cualquier barbero", el primero libre a esa hora (R08 de 002); la reserva lo vuelve a comprobar.
  const barberoDeLaHora = hora ? (barberoId ?? hora.barberoIds[0]) : null;
  const nombreBarbero = catalogo.barberos.find((b) => b.id === barberoDeLaHora)?.nombre;

  const horaLocal = (inicio: string) => Number(horaDeBarberia(inicio, zona).slice(0, 2));

  return (
    <section className={estilos.paso} aria-labelledby="paso-hora">
      <TituloPaso>
        <span id="paso-hora">¿Qué día y a qué hora?</span>
      </TituloPaso>

      <div>
        <p id={idDias} className={estilos.subtitulo}>
          Día
        </p>
        <div role="group" aria-labelledby={idDias} className={estilos.dias}>
          {dias.map((d) => (
            <button
              key={d.fecha}
              type="button"
              className={estilos.dia}
              aria-pressed={d.fecha === fecha}
              disabled={!d.abierto}
              aria-label={`${fechaDeBarberia(`${d.fecha}T12:00:00Z`, zona)}${d.abierto ? '' : ', cerrado'}`}
              onClick={() => {
                setElegida(null);
                alCambiarFecha(d.fecha);
              }}
            >
              <span className={estilos.diaNombre}>{d.etiqueta ?? d.diaCorto}</span>
              <span className={estilos.diaNumero}>{d.numero}</span>
              <span className={estilos.diaMes}>{d.abierto ? d.mes : 'Cerrado'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={estilos.horas}>
        {horarios.isPending ? (
          <div aria-busy="true" className={estilos.cuadricula}>
            <span className="sr-only">Buscando horas libres…</span>
            {Array.from({ length: 8 }, (_, i) => (
              <Esqueleto key={i} alto="var(--alto-control)" />
            ))}
          </div>
        ) : horarios.isError ? (
          <Alerta>{mensajeDeError(horarios.error)}</Alerta>
        ) : horas.length === 0 ? (
          <EstadoVacio
            icono="calendario"
            titulo="No hay horas libres ese día"
            descripcion="Prueba con otro día u otro barbero."
          />
        ) : (
          FRANJAS.map((franja) => {
            const deLaFranja = horas.filter((h) => {
              const h24 = horaLocal(h.inicio);
              return h24 >= franja.desde && h24 < franja.hasta;
            });
            if (deLaFranja.length === 0) return null;
            return (
              <div key={franja.nombre} className={estilos.franja}>
                <p className={estilos.subtitulo}>{franja.nombre}</p>
                <div
                  role="group"
                  aria-label={`Horas libres de la ${franja.nombre.toLowerCase()}`}
                  className={estilos.cuadricula}
                >
                  {deLaFranja.map((h) => (
                    <button
                      key={h.inicio}
                      type="button"
                      className={estilos.hora}
                      aria-pressed={h.inicio === elegida}
                      onClick={() => setElegida(h.inicio)}
                    >
                      {horaDeBarberia(h.inicio, zona)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {hora && barberoDeLaHora && (
        <BarraResumen
          lineas={[
            `${servicio.nombre} · S/ ${servicio.precio}`,
            `${fechaCorta(hora.inicio, zona)}${nombreBarbero ? ` · ${nombreBarbero}` : ''}`,
          ]}
        >
          <Boton type="button" iconoFinal="flecha" onClick={() => alContinuar(hora.inicio, barberoDeLaHora)}>
            Continuar
          </Boton>
        </BarraResumen>
      )}
    </section>
  );
}

/** Resumen fijo abajo (sobre la barra de navegación en el celular) con la acción del paso. */
function BarraResumen({ lineas, children }: { lineas: string[]; children: ReactNode }) {
  return (
    <div className={estilos.barraResumen} role="region" aria-label="Tu selección">
      <div className={estilos.barraResumenAncho}>
        <div className={estilos.barraResumenInterior}>
          <div className={estilos.barraResumenTextos}>
            {lineas.map((l, i) => (
              <p key={l} className={i === 0 ? estilos.barraResumenTitulo : estilos.barraResumenDetalle}>
                {l}
              </p>
            ))}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function PasoConfirmar({
  slug,
  catalogo,
  seleccion,
  alConflicto,
  alCambiar,
}: {
  slug: string;
  catalogo: Catalogo;
  seleccion: SolicitudReserva;
  alConflicto: (fecha: string) => void;
  alCambiar: (paso: number) => void;
}) {
  const navegar = useNavigate();
  const consultas = useQueryClient();
  const { usuario } = useSesion();
  // Se genera al abrir la confirmación y se reutiliza en cada reintento: el servidor no duplica la cita (R09 de 002).
  const [clave] = useState(() => crypto.randomUUID());
  const [conflicto, setConflicto] = useState<string | null>(null);
  const zona = catalogo.barberia.zonaHoraria;
  const servicio = catalogo.servicios.find((s) => s.id === seleccion.servicioId);
  const barbero = catalogo.barberos.find((b) => b.id === seleccion.barberoId);

  const reserva = useMutation({
    mutationFn: () =>
      llamarApi<Cita>('/citas', {
        metodo: 'POST',
        cuerpo: seleccion,
        encabezados: { 'Idempotency-Key': clave },
      }),
    // 008 (T033): con el adelanto activo la cita queda pendiente; se sigue en la pantalla de pago del adelanto.
    onSuccess: (cita) => {
      if (cita.adelanto) navegar(`/mis-citas/${encodeURIComponent(cita.id)}/adelanto`);
    },
    onError: (error) => {
      // El estado cambió con la confirmación abierta: se vuelve a consultar y la pantalla muestra el aviso.
      if (esRestriccionDeSuscripcion(error)) {
        void consultas.invalidateQueries({ queryKey: ['suscripcion', 'estado-operativo', slug] });
        return;
      }
      if (!(error instanceof ApiError) || !CONFLICTOS.has(error.codigo)) return;
      // Otro cliente ganó la hora: vuelve a elegir la hora del mismo día, con los horarios actualizados.
      setConflicto(error.message);
      void consultas.invalidateQueries({ queryKey: clavesConsulta.horarios(slug) });
    },
  });

  // 010 (research R06): el aviso se muestra antes de intentar y también ante el 403 (verificación de otra sesión).
  const sinVerificar = usuario?.correoVerificado === false || esCorreoNoVerificado(reserva.error);

  if (!servicio || !barbero) {
    return (
      <EstadoVacio
        icono="calendario"
        titulo="Esta selección ya no está disponible"
        descripcion="Elige de nuevo el servicio, el barbero y la hora."
        accion={
          <Boton type="button" variante="secundario" onClick={() => alCambiar(1)}>
            Elegir de nuevo
          </Boton>
        }
      />
    );
  }
  if (reserva.data) {
    // Con adelanto, la navegación a la pantalla de pago ya está en curso (onSuccess).
    if (reserva.data.adelanto) return <PantallaCarga />;
    return <CitaReservada cita={reserva.data} zona={zona} />;
  }

  const filas: [string, string, number][] = [
    ['Servicio', `${servicio.nombre} · ${servicio.duracionMinutos} min`, 1],
    ['Barbero', barbero.nombre, 2],
    ['Fecha', fechaDeBarberia(seleccion.inicio, zona), 3],
    ['Hora', horaConEtiqueta(seleccion.inicio, zona), 3],
  ];

  return (
    <section className={estilos.paso} aria-labelledby="paso-confirmar">
      <TituloPaso>
        <span id="paso-confirmar">Revisa y confirma tu cita</span>
      </TituloPaso>
      <div className={estilos.resumen}>
        <dl className={estilos.datos}>
          {filas.map(([termino, valor, paso]) => (
            <div key={termino}>
              <dt>{termino}</dt>
              <dd>
                <span>{valor}</span>
                {termino !== 'Hora' && (
                  <button type="button" className={estilos.cambiar} onClick={() => alCambiar(paso)}>
                    Cambiar<span className="sr-only"> {termino.toLowerCase()}</span>
                  </button>
                )}
              </dd>
            </div>
          ))}
          <div className={estilos.total}>
            <dt>Precio</dt>
            <dd>S/ {servicio.precio}</dd>
          </div>
        </dl>
      </div>

      {conflicto && (
        <div className={estilos.conflicto}>
          <Alerta>{conflicto}</Alerta>
          <Boton
            type="button"
            variante="secundario"
            onClick={() => alConflicto(fechaIsoDeBarberia(seleccion.inicio, zona))}
          >
            Elegir otra hora
          </Boton>
        </div>
      )}
      {sinVerificar ? (
        <AvisoVerificacion accion="reservar" alVerificar={() => reserva.reset()} />
      ) : (
        reserva.isError && !conflicto && <Alerta>{mensajeDeError(reserva.error)}</Alerta>
      )}

      <BarraResumen
        lineas={[
          `${servicio.nombre} · S/ ${servicio.precio}`,
          `${fechaCorta(seleccion.inicio, zona)} · ${barbero.nombre}`,
        ]}
      >
        <Boton
          type="button"
          icono="calendarioCheck"
          disabled={sinVerificar || Boolean(conflicto)}
          cargando={reserva.isPending}
          textoCargando="Reservando…"
          onClick={() => reserva.mutate()}
        >
          Confirmar cita
        </Boton>
      </BarraResumen>
    </section>
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
    <SeccionCita
      titulo={cancelada ? 'Tu cita fue cancelada' : 'Tu cita está confirmada'}
      icono={cancelada ? 'cerrar' : 'check'}
      tono={cancelada ? 'neutro' : 'exito'}
      nivel={2}
    >
      <div className={estilos.resumen}>
        <dl className={estilos.datos}>
          {(
            [
              ['Servicio', cita.servicio],
              ['Barbero', cita.barbero],
              ['Fecha', fechaDeBarberia(cita.inicio, zona)],
              ['Hora', horaConEtiqueta(cita.inicio, zona)],
              ['Termina', horaDeBarberia(cita.fin, zona)],
              ['Precio', `S/ ${cita.precio}`],
              ...(cancelada
                ? [['Estado', cita.cancelacionTardia ? 'Cancelada (cancelación tardía)' : 'Cancelada']]
                : []),
            ] as [string, string][]
          ).map(([termino, valor]) => (
            <div key={termino}>
              <dt>{termino}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>
      </div>
      {cancelar.isError && <Alerta>{mensajeDeError(cancelar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Link to="/mis-citas" className={clasesBoton()}>
          <Icono nombre="calendario" tamano={18} />
          Ver mis citas
        </Link>
        {!cancelada && (
          <Boton type="button" variante="secundario" icono="cerrar" onClick={() => setConfirmando(true)}>
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
    </SeccionCita>
  );
}

/** Sección con icono y título: h1 en la tarjeta de MarcoAcceso (unión) y h2 dentro del panel. */
function SeccionCita({
  titulo,
  icono,
  tono = 'acento',
  nivel = 1,
  children,
}: {
  titulo: string;
  icono: NombreIcono;
  tono?: 'acento' | 'exito' | 'neutro';
  nivel?: 1 | 2;
  children: ReactNode;
}) {
  const idTitulo = useId();
  const Titulo = nivel === 1 ? 'h1' : 'h2';
  return (
    <section aria-labelledby={idTitulo} className={estilos.seccion}>
      <div className={estilos.encabezado}>
        <span className={estilos.icono} data-tono={tono}>
          <Icono nombre={icono} />
        </span>
        <Titulo id={idTitulo}>{titulo}</Titulo>
      </div>
      {children}
    </section>
  );
}

function ReservaCargando() {
  return (
    <div aria-busy="true" className={estilos.flujo}>
      <span className="sr-only">Cargando la reserva…</span>
      <Esqueleto ancho="55%" alto="2.25rem" />
      <Esqueleto alto="3rem" />
      {Array.from({ length: 3 }, (_, i) => (
        <Esqueleto key={i} alto="5rem" />
      ))}
    </div>
  );
}
