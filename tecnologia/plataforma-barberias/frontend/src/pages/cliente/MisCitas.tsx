import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdelantoDeCita } from '../../api/adelanto';
import { clavesConsulta } from '../../api/claves';
import { llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { AvisoVerificacion } from '../../components/app/AvisoVerificacion';
import { ConfirmarCancelacion } from '../../components/app/ConfirmarCancelacion';
import { ReprogramarCita } from '../../components/app/ReprogramarCita';
import { Icono } from '../../components/Icono';
import {
  Alerta,
  Boton,
  clasesBoton,
  EstadoVacio,
  EtiquetaEstado,
  type TonoEtiqueta,
  useAvisos,
} from '../../components/ui';
import { Esqueleto } from '../../components/ui/Esqueleto';
import { ETIQUETA_HORA_BARBERIA, fechaDeBarberia, horaDeBarberia } from '../../hora-barberia';
import { mensajeDeError } from '../panel/datos-barberia';
import { EncabezadoCliente } from './EncabezadoCliente';
import estilos from './MisCitas.module.css';
import { ESTADO_ADELANTO, soles } from './textos-adelanto';

/** 008: la Cita de 002 y, si la tiene, su adelanto (el historial lo incluye solo en las citas con adelanto). */
type Cita = components['schemas']['Cita'] & { adelanto?: AdelantoDeCita | null };
type PaginaCitas = Omit<components['schemas']['PaginaCitas'], 'elementos'> & { elementos: Cita[] };
type Catalogo = components['schemas']['CatalogoPublico'];

const TAMANO_PAGINA = 10;

/** Estado de la cita: siempre con texto (la insignia no depende solo del color). */
const ESTADO: Record<Cita['estado'], { texto: string; tono: TonoEtiqueta }> = {
  PENDIENTE: { texto: 'Pendiente', tono: 'aviso' },
  CONFIRMADA: { texto: 'Confirmada', tono: 'exito' },
  COMPLETADA: { texto: 'Completada', tono: 'neutro' },
  NO_ASISTIO: { texto: 'No asistió', tono: 'error' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutro' },
};

/** Qué se puede hacer con una cita según su estado (las mismas reglas de antes; el servidor decide igual). */
function accionesDeCita(cita: Cita, ahora: number) {
  const activa = cita.estado === 'CONFIRMADA' || cita.estado === 'PENDIENTE';
  const futura = Date.parse(cita.inicio) > ahora;
  const adelanto = cita.adelanto ?? null;
  return {
    // 008 (research R11): una cita pendiente de su adelanto no se reprograma; se puede cancelar.
    reprogramar: activa && futura && !(cita.estado === 'PENDIENTE' && adelanto),
    cancelar: activa && futura,
    pagar: adelanto?.estado === 'POR_PAGAR',
    verAdelanto: adelanto !== null && adelanto.estado !== 'POR_PAGAR',
  };
}

/**
 * Mis citas (HU16, RF17), dentro del panel del cliente (rediseño del 2026-11-24): saludo, la PRÓXIMA cita destacada con
 * sus acciones, y el historial como tarjetas (paginado, de la más reciente a la más antigua, sin filtros). Cada cita
 * activa futura se puede cancelar, con el aviso de si sería tardía (FR-038), y reprogramar (004, RF13); con el
 * adelanto por pagar, se paga (008).
 */
export default function MisCitas() {
  const { usuario } = useSesion();
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const barberia = usuario?.barberia;
  const [pagina, setPagina] = useState(1);
  const [porCancelar, setPorCancelar] = useState<Cita | null>(null);
  const [porReprogramar, setPorReprogramar] = useState<Cita | null>(null);
  // "Ahora" fijo durante la visita: decide qué citas son próximas y cuáles se pueden cambiar.
  const [ahora] = useState(() => Date.now());

  // La zona horaria sale del catálogo público de la barbería (mismo dato que ve al reservar).
  const catalogo = useQuery({
    queryKey: clavesConsulta.catalogo(barberia?.slug ?? ''),
    queryFn: () =>
      llamarApi<Catalogo>(`/publico/${encodeURIComponent(barberia?.slug ?? '')}`, { sinRenovar: true }),
    enabled: Boolean(barberia?.slug),
  });
  const zona = catalogo.data?.barberia.zonaHoraria ?? 'America/Lima';

  const historial = useQuery({
    queryKey: ['mis-citas', pagina],
    queryFn: () => llamarApi<PaginaCitas>(`/clientes/yo/citas?pagina=${pagina}&tamano=${TAMANO_PAGINA}`),
  });

  const cancelar = useMutation({
    mutationFn: (cita: Cita) => llamarApi<Cita>(`/citas/${cita.id}/cancelar`, { metodo: 'POST' }),
    onSuccess: (cita) => {
      setPorCancelar(null);
      avisar({
        tono: 'exito',
        titulo: 'Cita cancelada',
        descripcion: cita.cancelacionTardia ? 'Quedó como cancelación tardía.' : 'El horario quedó libre.',
      });
      void consultas.invalidateQueries({ queryKey: ['mis-citas'] });
    },
    onError: (error) => {
      setPorCancelar(null);
      avisar({ tono: 'error', titulo: 'No se pudo cancelar la cita', descripcion: mensajeDeError(error) });
      void consultas.invalidateQueries({ queryKey: ['mis-citas'] });
    },
  });

  const elementos = historial.data?.elementos ?? [];
  // La próxima: la activa futura más cercana de la primera página (el historial va de la más reciente a la más antigua).
  const proxima =
    pagina === 1
      ? elementos
          .filter(
            (c) => (c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE') && Date.parse(c.inicio) > ahora,
          )
          .sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio))[0]
      : undefined;
  const resto = elementos.filter((c) => c.id !== proxima?.id);
  const total = historial.data?.total ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const primerNombre = usuario?.nombre.trim().split(/\s+/)[0] ?? '';
  const reservar = barberia ? `/b/${barberia.slug}/reservar` : '/mis-citas';

  const botonReservar = (
    <Link to={reservar} className={clasesBoton()}>
      <Icono nombre="calendarioCheck" tamano={18} />
      Reservar una cita
    </Link>
  );

  const tarjeta = (cita: Cita, destacada: boolean) => (
    <TarjetaCita
      cita={cita}
      zona={zona}
      destacada={destacada}
      acciones={accionesDeCita(cita, ahora)}
      alReprogramar={() => setPorReprogramar(cita)}
      alCancelar={() => setPorCancelar(cita)}
    />
  );

  return (
    <div className={estilos.contenido}>
      <EncabezadoCliente
        antetitulo="Mis citas"
        titulo={primerNombre ? `Hola, ${primerNombre}` : 'Mis citas'}
        descripcion={`Tus citas en ${barberia?.nombre ?? 'tu barbería'}. Horas en ${ETIQUETA_HORA_BARBERIA}.`}
        acciones={total > 0 ? botonReservar : undefined}
      />

      {usuario?.correoVerificado === false && <AvisoVerificacion accion="reservar" />}

      {historial.isPending ? (
        <div aria-busy="true" className={estilos.lista}>
          <span className="sr-only">Cargando tus citas…</span>
          <Esqueleto alto="11rem" />
          <Esqueleto alto="6rem" />
          <Esqueleto alto="6rem" />
        </div>
      ) : historial.isError ? (
        <Alerta>{mensajeDeError(historial.error)}</Alerta>
      ) : total === 0 ? (
        <div className={estilos.vacio}>
          <EstadoVacio
            icono="calendario"
            titulo="Aún no tienes citas. Reserva tu primera cita"
            descripcion={`Elige servicio, barbero y hora en ${barberia?.nombre ?? 'tu barbería'}.`}
            accion={botonReservar}
          />
        </div>
      ) : (
        <>
          {pagina === 1 && (
            <section aria-labelledby="titulo-proxima" className={estilos.bloque}>
              <h2 id="titulo-proxima" className={estilos.tituloBloque}>
                Tu próxima cita
              </h2>
              {proxima ? (
                tarjeta(proxima, true)
              ) : (
                <div className={estilos.sinProxima}>
                  <p>No tienes citas próximas.</p>
                  {botonReservar}
                </div>
              )}
            </section>
          )}

          {resto.length > 0 && (
            <section aria-labelledby="titulo-historial" className={estilos.bloque}>
              <h2 id="titulo-historial" className={estilos.tituloBloque}>
                Historial
              </h2>
              <ul className={estilos.lista}>
                {resto.map((cita) => (
                  <li key={cita.id}>{tarjeta(cita, false)}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {total > TAMANO_PAGINA && (
        <nav aria-label="Páginas del historial" className={estilos.paginas}>
          <Boton
            type="button"
            variante="secundario"
            icono="chevronIzquierda"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            Más recientes
          </Boton>
          <span className={estilos.paginaActual}>
            Página {pagina} de {ultimaPagina}
          </span>
          <Boton
            type="button"
            variante="secundario"
            iconoFinal="chevronDerecha"
            disabled={pagina >= ultimaPagina}
            onClick={() => setPagina((p) => p + 1)}
          >
            Anteriores
          </Boton>
        </nav>
      )}

      {porReprogramar && catalogo.data && (
        <ReprogramarCitaDelCliente
          cita={porReprogramar}
          catalogo={catalogo.data}
          onCerrar={() => setPorReprogramar(null)}
          onReprogramada={() => {
            setPorReprogramar(null);
            void consultas.invalidateQueries({ queryKey: ['mis-citas'] });
          }}
          onCancelar={() => {
            setPorReprogramar(null);
            setPorCancelar(porReprogramar);
          }}
        />
      )}

      {porCancelar && (
        <ConfirmarCancelacion
          cita={porCancelar}
          zona={zona}
          comoCliente
          cargando={cancelar.isPending}
          onConfirmar={() => cancelar.mutate(porCancelar)}
          onCerrar={() => setPorCancelar(null)}
        />
      )}
    </div>
  );
}

/** Una cita como tarjeta: fecha y hora grandes, servicio, barbero, insignias de estado y sus acciones. */
function TarjetaCita({
  cita,
  zona,
  destacada,
  acciones,
  alReprogramar,
  alCancelar,
}: {
  cita: Cita;
  zona: string;
  destacada: boolean;
  acciones: ReturnType<typeof accionesDeCita>;
  alReprogramar: () => void;
  alCancelar: () => void;
}) {
  const adelanto = cita.adelanto ?? null;
  const fecha = new Date(cita.inicio);
  const parte = (opciones: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('es-PE', { ...opciones, timeZone: zona }).format(fecha).replace('.', '');
  const hayAcciones = acciones.reprogramar || acciones.cancelar || acciones.pagar || acciones.verAdelanto;
  const tamano = destacada ? 'md' : 'sm';

  return (
    <article
      className={estilos.cita}
      data-destacada={destacada || undefined}
      aria-label={`${cita.servicio}, ${fechaDeBarberia(cita.inicio, zona)}, ${horaDeBarberia(cita.inicio, zona)}`}
    >
      <div className={estilos.fecha} aria-hidden="true">
        <span className={estilos.fechaDia}>{parte({ weekday: 'short' })}</span>
        <span className={estilos.fechaNumero}>{parte({ day: 'numeric' })}</span>
        <span className={estilos.fechaMes}>{parte({ month: 'short' })}</span>
      </div>
      <div className={estilos.citaCuerpo}>
        <div className={estilos.citaCabeza}>
          <p className={estilos.hora}>{horaDeBarberia(cita.inicio, zona)}</p>
          <div className={estilos.insignias}>
            <EtiquetaEstado tono={ESTADO[cita.estado].tono}>{ESTADO[cita.estado].texto}</EtiquetaEstado>
            {adelanto && (
              <EtiquetaEstado tono={ESTADO_ADELANTO[adelanto.estado].tono}>
                {ESTADO_ADELANTO[adelanto.estado].enLista}
              </EtiquetaEstado>
            )}
            {cita.cancelacionTardia && <EtiquetaEstado tono="aviso">Cancelación tardía</EtiquetaEstado>}
          </div>
        </div>
        <p className={estilos.servicio}>{cita.servicio}</p>
        <p className={estilos.detalle}>
          {fechaDeBarberia(cita.inicio, zona)} · con {cita.barbero} · S/ {cita.precio}
        </p>
        {adelanto && (
          <p className={estilos.detalle}>
            Adelanto {soles(adelanto.montoCentimos)}
            {adelanto.estado === 'CONFIRMADO' && ` · saldo ${soles(adelanto.saldoCentimos)}`}
          </p>
        )}
        {hayAcciones && (
          <div className={estilos.acciones}>
            {acciones.pagar && (
              <Link
                to={`/mis-citas/${encodeURIComponent(cita.id)}/adelanto`}
                className={clasesBoton({ tamano })}
              >
                <Icono nombre="dinero" tamano={16} />
                Pagar adelanto
              </Link>
            )}
            {acciones.verAdelanto && (
              <Link
                to={`/mis-citas/${encodeURIComponent(cita.id)}/adelanto`}
                className={clasesBoton({ variante: 'secundario', tamano })}
              >
                Ver adelanto
              </Link>
            )}
            {acciones.reprogramar && (
              <Boton
                type="button"
                variante="secundario"
                tamano={tamano}
                icono="calendario"
                onClick={alReprogramar}
              >
                Reprogramar
              </Boton>
            )}
            {acciones.cancelar && (
              <Boton type="button" variante="peligro" tamano={tamano} icono="cerrar" onClick={alCancelar}>
                Cancelar
              </Boton>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Reprogramación del cliente (004, RF13): el servicio y los barberos salen del catálogo de su barbería. La
 * cita guarda los nombres copiados al reservar; si el servicio ya no se ofrece con ese nombre, el diálogo lo
 * explica y ofrece cancelar.
 */
function ReprogramarCitaDelCliente({
  cita,
  catalogo,
  onCerrar,
  onReprogramada,
  onCancelar,
}: {
  cita: Cita;
  catalogo: Catalogo;
  onCerrar: () => void;
  onReprogramada: () => void;
  onCancelar: () => void;
}) {
  const avisar = useAvisos();
  const zona = catalogo.barberia.zonaHoraria;
  const servicioId = catalogo.servicios.find((s) => s.nombre === cita.servicio)?.id ?? null;
  const barberos = catalogo.barberos.filter((b) => servicioId !== null && b.servicioIds.includes(servicioId));
  return (
    <ReprogramarCita
      cita={cita}
      servicioId={servicioId}
      barberos={barberos}
      barberoActualId={barberos.find((b) => b.nombre === cita.barbero)?.id ?? null}
      zona={zona}
      comoCliente
      onCerrar={onCerrar}
      onCancelar={onCancelar}
      onReprogramada={({ cita: nueva }) => {
        avisar({
          tono: 'exito',
          titulo: 'Cita reprogramada',
          descripcion: `${fechaDeBarberia(nueva.inicio, zona)}, ${horaDeBarberia(nueva.inicio, zona)} con ${nueva.barbero}.`,
        });
        onReprogramada();
      }}
    />
  );
}
