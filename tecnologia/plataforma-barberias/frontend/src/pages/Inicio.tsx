import { useQueries, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clavesConsulta } from '../api/claves';
import { llamarApi } from '../api/client';
import type { components } from '../api/schema';
import type { components as components002 } from '../api/schema-002';
import { useSesion } from '../auth/SesionProvider';
import { EncabezadoPagina } from '../components/app/EncabezadoPagina';
import { Icono, type NombreIcono } from '../components/Icono';
import { Boton, clasesBoton, Esqueleto, EtiquetaEstado, useAvisos } from '../components/ui';
import { fechaIsoDeBarberia } from '../hora-barberia';
import { useBarberia } from './panel/datos-barberia';
import type { EstadoBienvenida } from './Registro';
import estilos from './Inicio.module.css';

type PaginaUsuarios = components['schemas']['PaginaUsuarios'];
type Agenda = components002['schemas']['Agenda'];
type Servicio = components002['schemas']['Servicio'];
type Barbero = components002['schemas']['Barbero'];
type HorarioSemanal = components002['schemas']['HorarioSemanal'];

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PRUEBA = 14;

function diasRestantes(venceEn: string, ahora = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(venceEn).getTime() - ahora) / DIA_MS));
}

/** Tarjeta de un dato real. Mientras carga, un esqueleto; si falla, "—" con el motivo: nunca se inventan cifras. */
function Indicador({
  icono,
  etiqueta,
  valor,
  detalle,
  cargando = false,
}: {
  icono: NombreIcono;
  etiqueta: string;
  valor?: ReactNode;
  detalle: ReactNode;
  cargando?: boolean;
}) {
  return (
    <div className={`tarjeta ${estilos.indicador}`} aria-busy={cargando || undefined}>
      <div className={estilos.indicadorCabecera}>
        <span className={estilos.iconoTarjeta}>
          <Icono nombre={icono} />
        </span>
        <h3 className={estilos.indicadorEtiqueta}>{etiqueta}</h3>
      </div>
      {cargando ? (
        <div className={estilos.indicadorValor}>
          <Esqueleto ancho="3rem" alto="2rem" />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : (
        <p className={`${estilos.indicadorValor} ${estilos.numero}`}>{valor}</p>
      )}
      <p className={estilos.indicadorDetalle}>{detalle}</p>
    </div>
  );
}

/** Un paso de "Primeros pasos". `hecho` es undefined cuando no hay un dato que lo confirme: se muestra sin estado. */
function Paso({
  numero,
  icono,
  titulo,
  texto,
  hecho,
  accion,
}: {
  numero: number;
  icono: NombreIcono;
  titulo: string;
  texto: string;
  hecho?: boolean;
  accion: ReactNode;
}) {
  return (
    <li className={estilos.paso} data-hecho={hecho || undefined}>
      <span className={estilos.pasoIcono} aria-hidden="true">
        {hecho ? <Icono nombre="check" /> : <Icono nombre={icono} />}
      </span>
      <div className={estilos.pasoTextos}>
        <h3 className={estilos.pasoTitulo}>
          <span className={estilos.pasoNumero}>Paso {numero}.</span> {titulo}
        </h3>
        <p className={estilos.pasoTexto}>{texto}</p>
      </div>
      <div className={estilos.pasoAcciones}>
        {hecho !== undefined && (
          <EtiquetaEstado tono={hecho ? 'exito' : 'contorno'}>{hecho ? 'Hecho' : 'Pendiente'}</EtiquetaEstado>
        )}
        {accion}
      </div>
    </li>
  );
}

/**
 * Pasos para dejar lista la barbería (solo el propietario). Cada paso se marca hecho o pendiente solo con datos
 * reales de la API (servicios, barberos y su disponibilidad); si una consulta falla o no hay dato que lo diga
 * (compartir el enlace), el paso se muestra sin estado.
 */
function PrimerosPasos({ slug }: { slug: string }) {
  const avisar = useAvisos();
  const servicios = useQuery({
    queryKey: clavesConsulta.servicios,
    queryFn: () => llamarApi<Servicio[]>('/servicios'),
  });
  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
  });
  const activos = (barberos.data ?? []).filter((b) => b.activo);
  const disponibilidades = useQueries({
    queries: activos.map((b) => ({
      queryKey: clavesConsulta.disponibilidad(b.id),
      queryFn: () => llamarApi<HorarioSemanal>(`/barberos/${encodeURIComponent(b.id)}/disponibilidad`),
    })),
  });

  const hechoServicio = servicios.isSuccess ? servicios.data.some((s) => s.activo) : undefined;
  const hechoBarbero = barberos.isSuccess ? activos.length > 0 : undefined;
  const horariosListos = disponibilidades.length > 0 && disponibilidades.every((d) => d.isSuccess);
  const hechoHorario = !barberos.isSuccess
    ? undefined
    : activos.length === 0
      ? false
      : horariosListos
        ? disponibilidades.some((d) => (d.data?.tramos.length ?? 0) > 0)
        : undefined;

  const enlace = `${window.location.origin}/b/${slug}`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(enlace);
      avisar({ tono: 'exito', titulo: 'Enlace copiado' });
    } catch {
      avisar({ tono: 'error', titulo: 'No se pudo copiar', descripcion: enlace });
    }
  };

  return (
    <section aria-labelledby="titulo-pasos" className={`tarjeta ${estilos.pasos}`}>
      <div className={estilos.pasosCabecera}>
        <span className={estilos.iconoTarjeta}>
          <Icono nombre="check" />
        </span>
        <div>
          <h2 id="titulo-pasos" className={estilos.pasosTitulo}>
            Primeros pasos
          </h2>
          <p className={estilos.pasosDescripcion}>Deja lista tu barbería para recibir reservas en línea.</p>
        </div>
      </div>
      <ol className={estilos.listaPasos}>
        <Paso
          numero={1}
          icono="tijeras"
          titulo="Crea un servicio"
          texto="Con su precio y su duración, por ejemplo un corte clásico."
          hecho={hechoServicio}
          accion={
            <Link to="/app/servicios" className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
              Ir a servicios
            </Link>
          }
        />
        <Paso
          numero={2}
          icono="usuario"
          titulo="Agrega un barbero"
          texto="Quién atiende cada servicio; puede ser tú mismo."
          hecho={hechoBarbero}
          accion={
            <Link to="/app/barberos" className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
              Ir a barberos
            </Link>
          }
        />
        <Paso
          numero={3}
          icono="reloj"
          titulo="Define su horario"
          texto="Los días y horas en que cada barbero atiende."
          hecho={hechoHorario}
          accion={
            <Link to="/app/disponibilidad" className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
              Ir a disponibilidad
            </Link>
          }
        />
        <Paso
          numero={4}
          icono="enlace"
          titulo="Comparte tu enlace para reservar"
          texto={`Tus clientes reservan desde ${enlace}.`}
          accion={
            <Boton type="button" variante="secundario" tamano="sm" icono="copiar" onClick={copiar}>
              Copiar enlace
            </Boton>
          }
        />
      </ol>
    </section>
  );
}

/**
 * Pantalla principal de la barbería: la prueba gratuita justo después del registro, los datos reales de hoy (citas
 * y equipo), los primeros pasos del propietario y los accesos rápidos.
 */
export default function Inicio() {
  const { usuario } = useSesion();
  const bienvenida = useLocation().state as EstadoBienvenida | null;
  const nombre = usuario?.barberia.nombre ?? bienvenida?.barberia.nombre ?? 'Tu barbería';
  const venceEn = bienvenida?.suscripcion.venceEn;
  const dias = venceEn ? diasRestantes(venceEn) : null;
  const esPropietario = usuario?.rol === 'PROPIETARIO';

  // Equipo: dato real de GET /usuarios (solo el propietario puede consultarlo). El plan admite pocos
  // usuarios, así que una página de 100 los trae a todos.
  const equipo = useQuery({
    queryKey: ['usuarios', 'resumen'],
    queryFn: () => llamarApi<PaginaUsuarios>('/usuarios?pagina=1&tamano=100'),
    enabled: esPropietario,
  });
  const barberos = equipo.data?.datos.filter((u) => u.rol === 'BARBERO') ?? [];
  const activos = barberos.filter((u) => u.estado === 'ACTIVA').length;
  const pendientes = barberos.filter((u) => u.estado === 'PENDIENTE').length;

  // Citas de hoy: dato real de GET /agenda en la fecha de la barbería (el barbero ve solo las suyas).
  const barberia = useBarberia();
  const zona = barberia.data?.zonaHoraria;
  const fecha = zona ? fechaIsoDeBarberia(new Date(), zona) : null;
  const agenda = useQuery({
    queryKey: ['inicio', 'agenda', fecha],
    queryFn: () => llamarApi<Agenda>(`/agenda?fecha=${fecha}`),
    enabled: fecha !== null,
  });
  const citasHoy = agenda.data?.citas.filter((c) => c.estado !== 'CANCELADA').length;
  const errorCitas = barberia.isError || agenda.isError;

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio' }]}
        antetitulo="Panel de tu barbería"
        titulo={nombre}
        descripcion={
          dias !== null ? (
            <>Tu prueba gratuita está activa: te {dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}.</>
          ) : (
            <>Hola, {usuario?.nombre}.</>
          )
        }
      />

      {dias !== null && venceEn && (
        <section className={`tarjeta ${estilos.prueba}`} aria-labelledby="titulo-prueba">
          <div className={estilos.pruebaCabecera}>
            <span className={estilos.iconoTarjeta}>
              <Icono nombre="reloj" />
            </span>
            <div className={estilos.pruebaTextos}>
              <h2 id="titulo-prueba">Prueba gratuita</h2>
              <p className="texto-suave">
                Vence el {new Date(venceEn).toLocaleDateString('es-PE', { dateStyle: 'long' })}. Sin tarjeta y
                sin cargos automáticos.
              </p>
            </div>
            <p className={estilos.pruebaDias}>
              <strong>{dias}</strong> {dias === 1 ? 'día restante' : 'días restantes'}
            </p>
          </div>
          <div
            className={estilos.progreso}
            role="progressbar"
            aria-label="Días de prueba restantes"
            aria-valuemin={0}
            aria-valuemax={DIAS_PRUEBA}
            aria-valuenow={dias}
            aria-valuetext={`${dias} de ${DIAS_PRUEBA} días`}
          >
            <span style={{ width: `${Math.min(100, (dias / DIAS_PRUEBA) * 100)}%` }} />
          </div>
        </section>
      )}

      <section aria-labelledby="titulo-indicadores" className={estilos.seccion}>
        <h2 id="titulo-indicadores" className={estilos.tituloSeccion}>
          Hoy
        </h2>
        <div className={estilos.indicadores}>
          <Indicador
            icono="calendario"
            etiqueta={esPropietario ? 'Citas de hoy' : 'Tus citas de hoy'}
            cargando={!errorCitas && (barberia.isPending || agenda.isPending)}
            valor={errorCitas ? '—' : citasHoy}
            detalle={
              errorCitas ? (
                'No pudimos cargar la agenda. Intenta de nuevo más tarde.'
              ) : (
                <Link to="/app/agenda">Ver la agenda de hoy</Link>
              )
            }
          />
          {esPropietario ? (
            <Indicador
              icono="usuarios"
              etiqueta="Barberos activos"
              cargando={equipo.isPending}
              valor={equipo.isError ? '—' : activos}
              detalle={
                equipo.isError
                  ? 'No pudimos cargar tu equipo. Intenta de nuevo más tarde.'
                  : pendientes > 0
                    ? `${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'} de activar su cuenta.`
                    : 'Personas de tu equipo que ya pueden ingresar.'
              }
            />
          ) : (
            <Indicador
              icono="usuario"
              etiqueta="Tu rol"
              valor="Barbero"
              detalle="Atiendes a los clientes de la barbería."
            />
          )}
        </div>
      </section>

      {esPropietario && usuario && (
        <div className={estilos.seccion}>
          <PrimerosPasos slug={usuario.barberia.slug} />
        </div>
      )}

      <section aria-labelledby="titulo-accesos" className={estilos.seccion}>
        <h2 id="titulo-accesos" className={estilos.tituloSeccion}>
          Accesos rápidos
        </h2>
        <div className={estilos.accesos}>
          {esPropietario && (
            <Link to="/app/usuarios" className={`tarjeta ${estilos.acceso} ${estilos.accesoEnlace}`}>
              <span className={estilos.iconoTarjeta}>
                <Icono nombre="usuarios" />
              </span>
              <span className={estilos.accesoTexto}>
                <strong>Gestionar barberos</strong>
                <span>Crea cuentas para tu equipo y comparte su enlace de activación.</span>
              </span>
              <span className={estilos.flecha}>
                <Icono nombre="flecha" tamano={18} />
              </span>
            </Link>
          )}
          <div className={`tarjeta ${estilos.acceso}`}>
            <span className={estilos.iconoTarjeta}>
              <Icono nombre="usuario" />
            </span>
            <span className={estilos.accesoTexto}>
              <strong>Tu cuenta</strong>
              <span>
                {usuario?.correo} · {esPropietario ? 'Propietario' : 'Barbero'}
              </span>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
