import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { Icono } from '../../components/Icono';
import { iniciales } from '../../components/iniciales';
import { Logo } from '../../components/Logo';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { Esqueleto, EsqueletoTexto } from '../../components/ui/Esqueleto';
import { EstadoVacio } from '../../components/ui/EstadoVacio';
import { ConmutadorTema } from '../../components/ui/ConmutadorTema';
import { ultimaBarberia } from '../../ultima-barberia';
import estilos from './CatalogoPublico.module.css';
import { diasDeAtencion } from './horario-atencion';
import { mensajeDeError } from './Union';

type Catalogo = components['schemas']['CatalogoPublico'];

/**
 * Presentación pública de la barbería por su enlace (`/b/<slug>`; RF10; ADR-021). Sin sesión de cliente solo muestra
 * la barbería: datos, horario de atención, servicios y equipo, para mirar. Los horarios libres y la reserva se hacen
 * dentro del panel del cliente, con su sesión (decisión de producto del 2026-11-24): aquí solo se invita a ingresar o
 * crear la cuenta.
 */
export default function CatalogoPublico() {
  const { slug = '' } = useParams();
  const catalogo = useQuery({
    queryKey: clavesConsulta.catalogo(slug),
    queryFn: () => llamarApi<Catalogo>(`/publico/${encodeURIComponent(slug)}`, { sinRenovar: true }),
  });

  if (catalogo.isPending) return <PresentacionCargando />;
  if (catalogo.isError) {
    const noDisponible = catalogo.error instanceof ApiError && catalogo.error.estado === 404;
    return (
      <main className={estilos.pagina}>
        <div className={estilos.portada}>
          <header className={estilos.cabecera}>
            <Logo compacto />
            <ConmutadorTema />
          </header>
          <section className={estilos.noDisponible} aria-labelledby="titulo-no-disponible">
            <span className={estilos.iconoNoDisponible}>
              <Icono nombre="tienda" tamano={28} />
            </span>
            <h1 id="titulo-no-disponible">
              {noDisponible ? 'Barbería no disponible' : 'No pudimos cargar la barbería'}
            </h1>
            <p>
              {noDisponible
                ? 'El enlace no existe, cambió o la barbería no está atendiendo por ahora. Pide el enlace actualizado a la barbería.'
                : mensajeDeError(catalogo.error)}
            </p>
            {!noDisponible && (
              <Boton
                type="button"
                icono="recargar"
                cargando={catalogo.isFetching}
                textoCargando="Intentando…"
                onClick={() => void catalogo.refetch()}
              >
                Intentar de nuevo
              </Boton>
            )}
          </section>
        </div>
      </main>
    );
  }
  return <Presentacion catalogo={catalogo.data} slug={slug} />;
}

function Presentacion({ catalogo, slug }: { catalogo: Catalogo; slug: string }) {
  const { barberia, servicios, barberos, horario } = catalogo;
  const aviso = (useLocation().state as { mensaje?: string } | null)?.mensaje;
  const dias = diasDeAtencion(horario.tramos, barberia.zonaHoraria);

  // Recuerda esta barbería (solo su enlace y su nombre públicos) para ofrecer "Ingresar" aquí desde /mis-citas.
  useEffect(() => {
    ultimaBarberia.guardar({ slug, nombre: barberia.nombre });
  }, [slug, barberia.nombre]);

  const nombreServicio = new Map(servicios.map((s) => [s.id, s.nombre]));

  return (
    <main className={estilos.pagina}>
      <div className={estilos.portada}>
        <header className={estilos.cabecera}>
          {/* Compacto: la protagonista es la barbería, no la plataforma. */}
          <Logo compacto />
          <div className={estilos.cabeceraAcciones}>
            <ConmutadorTema />
            <AccesoCliente slug={slug} />
          </div>
        </header>

        <section className={estilos.heroe} aria-labelledby="nombre-barberia">
          <p className={estilos.antetitulo}>Barbería</p>
          <h1 id="nombre-barberia" className={estilos.nombre}>
            {barberia.nombre}
          </h1>
          {barberia.descripcion && <p className={estilos.descripcion}>{barberia.descripcion}</p>}
          {(barberia.direccion || barberia.telefono) && (
            <ul className={estilos.datos} aria-label="Datos de contacto">
              {barberia.direccion && (
                <li>
                  <Icono nombre="tienda" tamano={18} />
                  <span>{barberia.direccion}</span>
                </li>
              )}
              {barberia.telefono && (
                <li>
                  <Icono nombre="celular" tamano={18} />
                  <a href={`tel:${barberia.telefono.replace(/[^\d+]/g, '')}`}>{barberia.telefono}</a>
                </li>
              )}
            </ul>
          )}
          <LlamadoAReservar slug={slug} enPortada />
        </section>
      </div>

      <div className={estilos.contenido}>
        {aviso && <Alerta>{aviso}</Alerta>}

        <section className={estilos.seccion} aria-labelledby="titulo-servicios">
          <div className={estilos.seccionEncabezado}>
            <h2 id="titulo-servicios">Servicios</h2>
            {servicios.length > 0 && <p>Precios en soles. La duración es aproximada.</p>}
          </div>
          {servicios.length === 0 ? (
            <EstadoVacio icono="tijeras" titulo="Esta barbería está preparando su catálogo. Vuelve pronto." />
          ) : (
            <ul className={estilos.servicios}>
              {servicios.map((s) => (
                <li key={s.id} className={estilos.servicio}>
                  <div className={estilos.servicioCabeza}>
                    <h3>{s.nombre}</h3>
                    <span className={estilos.precio}>S/ {s.precio}</span>
                  </div>
                  {s.descripcion && <p className={estilos.servicioDescripcion}>{s.descripcion}</p>}
                  <p className={estilos.duracion}>
                    <Icono nombre="reloj" tamano={16} />
                    {s.duracionMinutos} min
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {barberos.length > 0 && (
          <section className={estilos.seccion} aria-labelledby="titulo-equipo">
            <div className={estilos.seccionEncabezado}>
              <h2 id="titulo-equipo">Nuestro equipo</h2>
            </div>
            <ul className={estilos.equipo}>
              {barberos.map((b) => {
                const ofrece = b.servicioIds.map((id) => nombreServicio.get(id)).filter(Boolean);
                return (
                  <li key={b.id} className={estilos.barbero}>
                    <span className={estilos.avatar} aria-hidden="true">
                      {iniciales(b.nombre)}
                    </span>
                    <div>
                      <p className={estilos.barberoNombre}>{b.nombre}</p>
                      {ofrece.length > 0 && <p className={estilos.barberoServicios}>{ofrece.join(' · ')}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {dias.length > 0 && (
          <section className={estilos.seccion} aria-labelledby="titulo-horario">
            <div className={estilos.seccionEncabezado}>
              <h2 id="titulo-horario">Horario de atención</h2>
            </div>
            <dl className={estilos.horario}>
              {dias.map((d) => (
                <div key={d.dia} className={estilos.dia} data-hoy={d.esHoy || undefined}>
                  <dt>
                    {d.nombre}
                    {d.esHoy && <span className={estilos.hoy}>Hoy</span>}
                  </dt>
                  <dd>
                    {d.tramos.length > 0
                      ? d.tramos.map((tramo) => <span key={tramo}>{tramo}</span>)
                      : 'Cerrado'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {servicios.length > 0 && (
          <section className={estilos.invitacion} aria-labelledby="titulo-invitacion">
            <span className={estilos.invitacionIcono}>
              <Icono nombre="calendarioCheck" tamano={24} />
            </span>
            <TextoInvitacion />
            <LlamadoAReservar slug={slug} />
          </section>
        )}
      </div>

      <footer className={estilos.pie}>
        <nav aria-label="Textos legales">
          <Link to="/terminos">Términos y condiciones</Link>
          <Link to="/privacidad">Política de privacidad</Link>
        </nav>
      </footer>
    </main>
  );
}

/**
 * Los botones para reservar según la sesión (solo navegación: la unión y los permisos los decide el servidor):
 * - visitante (o personal de otra barbería): "Ingresar para reservar" y "Crear cuenta" de ESTA barbería;
 * - cliente con sesión en esta barbería: "Reservar una cita" y "Ir a mis citas";
 * - cliente con sesión en otra barbería: "Reservar aquí", que pasa por la unión con su consentimiento.
 */
/** Texto de la invitación final: al visitante le pide ingresar; al cliente con sesión le invita a reservar. */
function TextoInvitacion() {
  const { estado, usuario } = useSesion();
  const conSesion = estado === 'autenticado' && usuario?.rol === 'CLIENTE';
  return (
    <div>
      <h2 id="titulo-invitacion">
        {conSesion ? 'Reserva tu próxima cita' : 'Para reservar tu cita, ingresa o crea tu cuenta'}
      </h2>
      <p>
        {conSesion
          ? 'Elige servicio, barbero y hora en pocos pasos, y gestiona tus citas desde el celular.'
          : 'Con tu cuenta eliges servicio, barbero y hora, y ves y gestionas tus citas desde el celular.'}
      </p>
    </div>
  );
}

function LlamadoAReservar({ slug, enPortada = false }: { slug: string; enPortada?: boolean }) {
  const { estado, usuario } = useSesion();
  const esCliente = estado === 'autenticado' && usuario?.rol === 'CLIENTE';
  const esDeEstaBarberia = esCliente && usuario?.barberia.slug === slug;
  const secundario = clasesBoton({
    variante: 'secundario',
    className: enPortada ? estilos.botonSobreOscuro : undefined,
  });

  if (estado === 'cargando') return <div className={estilos.acciones} aria-hidden="true" />;
  return (
    <div className={estilos.acciones}>
      {esCliente ? (
        <>
          <Link to={`/b/${slug}/reservar`} className={clasesBoton()}>
            <Icono nombre="calendarioCheck" tamano={18} />
            {esDeEstaBarberia ? 'Reservar una cita' : 'Reservar aquí'}
          </Link>
          {esDeEstaBarberia && (
            <Link to="/mis-citas" className={secundario}>
              <Icono nombre="calendario" tamano={18} />
              Ir a mis citas
            </Link>
          )}
          {/* 005 (FR-016): el cliente de esta barbería también llega al asistente desde su página (una sola vez). */}
          {esDeEstaBarberia && enPortada && (
            <Link to="/asistente" className={secundario}>
              <Icono nombre="conversacion" tamano={18} />
              Preguntar al asistente
            </Link>
          )}
        </>
      ) : (
        <>
          <Link to={`/b/${slug}/ingresar`} className={clasesBoton()}>
            <Icono nombre="usuario" tamano={18} />
            Ingresar para reservar
          </Link>
          <Link to={`/b/${slug}/registro`} className={secundario}>
            Crear cuenta
          </Link>
        </>
      )}
    </div>
  );
}

/** La cuenta en el encabezado: "Ingresar" sin sesión de cliente; con ella, "Cerrar sesión". */
function AccesoCliente({ slug }: { slug: string }) {
  const { estado, usuario, cerrarSesion } = useSesion();
  const [saliendo, setSaliendo] = useState(false);
  const [recienSalio, setRecienSalio] = useState(false);
  const ingresar = useRef<HTMLAnchorElement>(null);
  const esCliente = estado === 'autenticado' && usuario?.rol === 'CLIENTE';

  // Al cerrar la sesión, el botón pulsado desaparece: el foco pasa a "Ingresar" para no perderse con teclado.
  useEffect(() => {
    if (recienSalio && !esCliente) ingresar.current?.focus();
  }, [recienSalio, esCliente]);

  // Mientras se comprueba la sesión no se muestra nada, para no enseñar "Ingresar" a quien ya tiene sesión.
  if (estado === 'cargando') return null;

  if (esCliente) {
    return (
      <Boton
        type="button"
        variante="fantasma"
        tamano="sm"
        icono="salir"
        className={estilos.botonCabecera}
        cargando={saliendo}
        textoCargando="Saliendo…"
        onClick={() => {
          setSaliendo(true);
          void cerrarSesion().finally(() => {
            setSaliendo(false);
            setRecienSalio(true);
          });
        }}
      >
        Cerrar sesión
      </Boton>
    );
  }
  return (
    <Link
      ref={ingresar}
      to={`/b/${slug}/ingresar`}
      className={clasesBoton({ variante: 'fantasma', tamano: 'sm', className: estilos.botonCabecera })}
    >
      <Icono nombre="usuario" tamano={16} />
      Ingresar
    </Link>
  );
}

/** Mientras llega el catálogo: la forma de la portada y de las tarjetas, sin saltos al cargar. */
function PresentacionCargando() {
  return (
    <main className={estilos.pagina} aria-busy="true">
      <span className="sr-only">Cargando la barbería…</span>
      <div className={estilos.portada}>
        <header className={estilos.cabecera}>
          <Logo compacto />
        </header>
        <div className={estilos.heroe}>
          <Esqueleto ancho="40%" alto="0.875rem" />
          <Esqueleto ancho="75%" alto="2.75rem" />
          <Esqueleto ancho="60%" alto="1rem" />
          <Esqueleto ancho="14rem" alto="var(--alto-control)" />
        </div>
      </div>
      <div className={estilos.contenido}>
        <ul className={estilos.servicios}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={estilos.servicio}>
              <Esqueleto ancho="60%" alto="1.25rem" />
              <EsqueletoTexto lineas={2} />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
