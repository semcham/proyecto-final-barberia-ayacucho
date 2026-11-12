import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clavesConsulta } from '../../api/claves';
import { llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { ConfirmarCancelacion } from '../../components/app/ConfirmarCancelacion';
import { ReprogramarCita } from '../../components/app/ReprogramarCita';
import { Logo } from '../../components/Logo';
import {
  Alerta,
  Boton,
  clasesBoton,
  EstadoVacio,
  EtiquetaEstado,
  type TonoEtiqueta,
  useAvisos,
} from '../../components/ui';
import { ETIQUETA_HORA_BARBERIA, fechaDeBarberia, horaDeBarberia } from '../../hora-barberia';
import { Cargando } from '../panel/Cargando';
import { mensajeDeError } from '../panel/datos-barberia';
import panel from '../panel/Panel.module.css';
import estilos from './MisCitas.module.css';

type Cita = components['schemas']['Cita'];
type PaginaCitas = components['schemas']['PaginaCitas'];
type Catalogo = components['schemas']['CatalogoPublico'];

const TAMANO_PAGINA = 10;

const ESTADO: Record<Cita['estado'], { texto: string; tono: TonoEtiqueta }> = {
  PENDIENTE: { texto: 'Pendiente', tono: 'aviso' },
  CONFIRMADA: { texto: 'Confirmada', tono: 'acento' },
  COMPLETADA: { texto: 'Completada', tono: 'exito' },
  NO_ASISTIO: { texto: 'No asistió', tono: 'aviso' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutro' },
};

/**
 * Historial del cliente en la barbería de su sesión (HU16, RF17): sus citas por fecha, de la más reciente a
 * la más antigua, paginado y sin filtros (tercera línea de corte). Las citas activas futuras se pueden
 * cancelar, con el aviso de si la cancelación sería tardía (FR-038), y reprogramar (004, RF13).
 */
export default function MisCitas() {
  const { usuario, cerrarSesion } = useSesion();
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const barberia = usuario?.barberia;
  const [pagina, setPagina] = useState(1);
  const [porCancelar, setPorCancelar] = useState<Cita | null>(null);
  const [porReprogramar, setPorReprogramar] = useState<Cita | null>(null);
  // "Ahora" fijo durante la visita: decide qué citas futuras se pueden cancelar.
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

  const total = historial.data?.total ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / TAMANO_PAGINA));

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo />
        <Boton
          type="button"
          variante="fantasma"
          tamano="sm"
          icono="salir"
          onClick={() => void cerrarSesion()}
        >
          Salir
        </Boton>
      </header>
      <div className={estilos.titulo}>
        <p className="antetitulo">{barberia?.nombre}</p>
        <h1>Mis citas</h1>
        <p className={panel.aviso}>Horas en {ETIQUETA_HORA_BARBERIA}.</p>
      </div>
      {barberia && (
        <div className={panel.acciones}>
          <Link to={`/b/${barberia.slug}`} className={clasesBoton()}>
            Reservar una cita
          </Link>
          <Link to="/mis-avisos" className={clasesBoton({ variante: 'secundario' })}>
            Cómo recibo mis avisos
          </Link>
        </div>
      )}

      <section aria-label="Historial de citas">
        {historial.isPending ? (
          <Cargando />
        ) : historial.isError ? (
          <Alerta>{mensajeDeError(historial.error)}</Alerta>
        ) : historial.data.elementos.length === 0 ? (
          <EstadoVacio
            icono="calendario"
            titulo={`Aún no tienes citas en ${barberia?.nombre ?? 'esta barbería'}`}
            descripcion="Cuando reserves, tus citas aparecerán aquí."
          />
        ) : (
          <ul className={panel.lista}>
            {historial.data.elementos.map((cita) => {
              const activa = cita.estado === 'CONFIRMADA' || cita.estado === 'PENDIENTE';
              const futura = Date.parse(cita.inicio) > ahora;
              return (
                <li key={cita.id} className={panel.elemento}>
                  <div className={panel.elementoTextos}>
                    <span className={panel.elementoNombre}>{cita.servicio}</span>
                    <span className={panel.elementoDetalle}>
                      {fechaDeBarberia(cita.inicio, zona)}, {horaDeBarberia(cita.inicio, zona)} ·{' '}
                      {cita.barbero} · S/ {cita.precio}
                    </span>
                  </div>
                  <div className={panel.acciones}>
                    <EtiquetaEstado tono={ESTADO[cita.estado].tono}>
                      {ESTADO[cita.estado].texto}
                    </EtiquetaEstado>
                    {cita.cancelacionTardia && (
                      <EtiquetaEstado tono="aviso">Cancelación tardía</EtiquetaEstado>
                    )}
                    {activa && futura && (
                      <>
                        <Boton
                          type="button"
                          variante="secundario"
                          tamano="sm"
                          onClick={() => setPorReprogramar(cita)}
                        >
                          Reprogramar
                        </Boton>
                        <Boton
                          type="button"
                          variante="peligro"
                          tamano="sm"
                          onClick={() => setPorCancelar(cita)}
                        >
                          Cancelar
                        </Boton>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {total > TAMANO_PAGINA && (
        <nav aria-label="Páginas del historial" className={panel.acciones}>
          <Boton
            type="button"
            variante="secundario"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            Más recientes
          </Boton>
          <span className={panel.aviso}>
            Página {pagina} de {ultimaPagina}
          </span>
          <Boton
            type="button"
            variante="secundario"
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
    </main>
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
