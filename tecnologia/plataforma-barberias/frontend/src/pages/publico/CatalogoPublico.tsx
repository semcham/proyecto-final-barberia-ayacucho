import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { PantallaCarga } from '../../auth/PantallaCarga';
import { useSesion } from '../../auth/SesionProvider';
import { SelectorDeHora } from '../../components/app/SelectorDeHora';
import { Icono } from '../../components/Icono';
import { Logo } from '../../components/Logo';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { EstadoVacio } from '../../components/ui/EstadoVacio';
import { Tarjeta } from '../../components/ui/Tarjeta';
import { fechaDeBarberia, fechaIsoDeBarberia, horaConEtiqueta, sumarDiasIso } from '../../hora-barberia';
import { HORIZONTE_RESERVA_DIAS } from '../../legal';
import estilos from './CatalogoPublico.module.css';
import { mensajeDeError } from './Union';

type Catalogo = components['schemas']['CatalogoPublico'];
type Horarios = components['schemas']['HorariosLibres'];

/**
 * Catálogo público por el enlace de la barbería (HU08, HU09; RF10, RF11; ADR-021). Sin sesión. Hace una
 * solicitud para el catálogo y una por fecha (la de "cualquier barbero"); elegir un barbero filtra esas
 * horas en la interfaz. Las horas se muestran siempre en la hora de la barbería.
 */
export default function CatalogoPublico() {
  const { slug = '' } = useParams();
  const catalogo = useQuery({
    queryKey: clavesConsulta.catalogo(slug),
    queryFn: () => llamarApi<Catalogo>(`/publico/${encodeURIComponent(slug)}`, { sinRenovar: true }),
  });

  if (catalogo.isPending) return <PantallaCarga />;
  if (catalogo.isError) {
    const noDisponible = catalogo.error instanceof ApiError && catalogo.error.estado === 404;
    return (
      <main className={estilos.pagina}>
        <header className={estilos.cabecera}>
          <Logo />
        </header>
        <section className={estilos.noDisponible} aria-labelledby="titulo-no-disponible">
          <h1 id="titulo-no-disponible">
            {noDisponible ? 'Barbería no disponible' : 'No pudimos cargar la barbería'}
          </h1>
          <p>
            {noDisponible
              ? 'El enlace no existe, cambió o la barbería no está atendiendo reservas. Pide el enlace actualizado a la barbería.'
              : mensajeDeError(catalogo.error)}
          </p>
          {!noDisponible && (
            <Boton
              type="button"
              variante="secundario"
              icono="recargar"
              cargando={catalogo.isFetching}
              textoCargando="Intentando…"
              onClick={() => void catalogo.refetch()}
            >
              Intentar de nuevo
            </Boton>
          )}
        </section>
      </main>
    );
  }
  return <ContenidoCatalogo catalogo={catalogo.data} slug={slug} />;
}

function ContenidoCatalogo({ catalogo, slug }: { catalogo: Catalogo; slug: string }) {
  const { barberia, servicios, barberos } = catalogo;
  const zona = barberia.zonaHoraria;
  const [parametros] = useSearchParams();
  const aviso = (useLocation().state as { mensaje?: string } | null)?.mensaje;
  const navegar = useNavigate();
  const { estado, usuario } = useSesion();

  const hoy = fechaIsoDeBarberia(new Date(), zona);
  const ultimoDia = sumarDiasIso(hoy, HORIZONTE_RESERVA_DIAS);
  const servicioInicial = parametros.get('servicio');
  const fechaInicial = parametros.get('fecha');
  const [servicioId, setServicioId] = useState(
    servicios.some((s) => s.id === servicioInicial) ? (servicioInicial as string) : '',
  );
  const [barberoId, setBarberoId] = useState('');
  const [fecha, setFecha] = useState(fechaInicial && fechaInicial >= hoy ? fechaInicial : hoy);
  const [inicio, setInicio] = useState<string | null>(null);

  const horarios = useQuery({
    queryKey: clavesConsulta.horarios(slug, servicioId, fecha),
    queryFn: () =>
      llamarApi<Horarios>(
        `/publico/${encodeURIComponent(slug)}/horarios?${new URLSearchParams({ servicio: servicioId, fecha })}`,
        { sinRenovar: true },
      ),
    enabled: servicioId !== '' && /^\d{4}-\d{2}-\d{2}$/.test(fecha),
  });

  const servicio = servicios.find((s) => s.id === servicioId);
  const barberosDelServicio = servicio
    ? barberos.filter((b) => b.servicioIds.includes(servicio.id))
    : barberos;
  const horas = (horarios.data?.horas ?? []).filter((h) => !barberoId || h.barberoIds.includes(barberoId));
  const hora = horas.find((h) => h.inicio === inicio);
  // Con "cualquier barbero", la reserva va con el primero libre a esa hora (R08); la reserva lo revalida.
  const barberoElegido = hora ? barberos.find((b) => b.id === (barberoId || hora.barberoIds[0])) : undefined;
  const destino =
    servicio && hora && barberoElegido
      ? `/b/${slug}/reservar?${new URLSearchParams({ servicio: servicio.id, barbero: barberoElegido.id, inicio: hora.inicio })}`
      : null;
  const esCliente = estado === 'autenticado' && usuario?.rol === 'CLIENTE';

  const elegirServicio = (id: string) => {
    setServicioId(id);
    setInicio(null);
    if (barberoId && !barberos.find((b) => b.id === barberoId)?.servicioIds.includes(id)) setBarberoId('');
  };

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        {/* Compacto: el protagonista de esta página es la barbería, no la plataforma. */}
        <Logo compacto />
        <p className="antetitulo">Reserva en línea</p>
      </header>

      <section className={estilos.barberia} aria-labelledby="nombre-barberia">
        <h1 id="nombre-barberia">{barberia.nombre}</h1>
        {barberia.descripcion && <p className={estilos.descripcion}>{barberia.descripcion}</p>}
        <ul className={estilos.datos}>
          {barberia.direccion && (
            <li>
              <Icono nombre="tienda" tamano={16} />
              {barberia.direccion}
            </li>
          )}
          {barberia.telefono && (
            <li>
              <Icono nombre="celular" tamano={16} />
              {barberia.telefono}
            </li>
          )}
        </ul>
      </section>

      {aviso && <Alerta>{aviso}</Alerta>}

      <div className={estilos.columnas}>
        <section aria-labelledby="titulo-servicios" className={estilos.bloque}>
          <h2 id="titulo-servicios">1. Elige un servicio</h2>
          {servicios.length === 0 ? (
            <EstadoVacio icono="tijeras" titulo="Esta barbería aún no publica servicios" />
          ) : (
            <div role="radiogroup" aria-labelledby="titulo-servicios" className={estilos.servicios}>
              {servicios.map((s) => (
                <label
                  key={s.id}
                  className={estilos.servicio}
                  data-elegido={s.id === servicioId || undefined}
                >
                  <input
                    type="radio"
                    name="servicio"
                    value={s.id}
                    checked={s.id === servicioId}
                    onChange={() => elegirServicio(s.id)}
                  />
                  <span className={estilos.servicioNombre}>{s.nombre}</span>
                  <span className={estilos.servicioDetalle}>
                    S/ {s.precio} · {s.duracionMinutos} min
                  </span>
                  {s.descripcion && <span className={estilos.servicioDescripcion}>{s.descripcion}</span>}
                </label>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="titulo-horario" className={estilos.bloque}>
          <h2 id="titulo-horario">2. Elige barbero, día y hora</h2>
          <div className={estilos.filtros}>
            <div className="campo">
              <label htmlFor="barbero" className="campo__etiqueta">
                Barbero
              </label>
              <select
                id="barbero"
                className="entrada"
                value={barberoId}
                onChange={(evento) => {
                  setBarberoId(evento.target.value);
                  setInicio(null);
                }}
              >
                <option value="">Cualquier barbero</option>
                {barberosDelServicio.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="fecha" className="campo__etiqueta">
                Fecha
              </label>
              <input
                id="fecha"
                type="date"
                className="entrada"
                min={hoy}
                max={ultimoDia}
                value={fecha}
                onChange={(evento) => {
                  setFecha(evento.target.value);
                  setInicio(null);
                }}
              />
            </div>
          </div>

          {!servicio ? (
            <p className={estilos.ayuda}>Elige un servicio para ver las horas libres.</p>
          ) : (
            <SelectorDeHora
              cargando={horarios.isPending}
              error={horarios.isError ? mensajeDeError(horarios.error) : null}
              horas={horas}
              zona={zona}
              elegida={inicio}
              onElegir={setInicio}
            />
          )}
        </section>
      </div>

      {servicio && hora && barberoElegido && destino && (
        // En el celular queda fija abajo: el botón para reservar se ve apenas se elige la hora.
        <Tarjeta titulo="Tu selección" icono="calendario" destacada className={estilos.seleccion}>
          <p className={estilos.resumen}>
            {servicio.nombre} con {barberoElegido.nombre}, {fechaDeBarberia(hora.inicio, zona)} a las{' '}
            {horaConEtiqueta(hora.inicio, zona)}.
          </p>
          <div className={estilos.acciones}>
            {esCliente ? (
              <Boton type="button" icono="calendarioCheck" onClick={() => navegar(destino)}>
                Reservar esta hora
              </Boton>
            ) : (
              <>
                <Link to={`/b/${slug}/registro`} state={{ desde: destino }} className={clasesBoton()}>
                  <Icono nombre="calendarioCheck" tamano={18} />
                  Crear cuenta y reservar
                </Link>
                <Link
                  to={`/b/${slug}/ingresar`}
                  state={{ desde: destino }}
                  className={clasesBoton({ variante: 'secundario' })}
                >
                  <Icono nombre="usuario" tamano={18} />
                  Ya tengo cuenta
                </Link>
              </>
            )}
          </div>
        </Tarjeta>
      )}
    </main>
  );
}
