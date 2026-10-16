import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { llamarApi } from '../api/client';
import type { components } from '../api/schema';
import { useSesion } from '../auth/SesionProvider';
import { EncabezadoPagina } from '../components/app/EncabezadoPagina';
import { Icono, type NombreIcono } from '../components/Icono';
import { Esqueleto, EtiquetaEstado } from '../components/ui';
import type { EstadoBienvenida } from './Registro';
import estilos from './Inicio.module.css';

type PaginaUsuarios = components['schemas']['PaginaUsuarios'];

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PRUEBA = 14;

function diasRestantes(venceEn: string, ahora = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(venceEn).getTime() - ahora) / DIA_MS));
}

/**
 * Tarjeta de indicador. Sin dato real todavía, muestra "Próximamente" en lugar de un número: nunca se
 * inventan cifras.
 */
function Indicador({
  icono,
  etiqueta,
  valor,
  detalle,
  proximamente = false,
  cargando = false,
}: {
  icono: NombreIcono;
  etiqueta: string;
  valor?: ReactNode;
  detalle: ReactNode;
  proximamente?: boolean;
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
      {proximamente ? (
        <div className={estilos.indicadorValor}>
          <EtiquetaEstado tono="contorno">Próximamente</EtiquetaEstado>
        </div>
      ) : cargando ? (
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

/**
 * Pantalla principal de la barbería. Justo después del registro también muestra los días de prueba; la
 * consulta permanente del estado de la suscripción llegará con RF19 (fuera de esta funcionalidad).
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
          Resumen
        </h2>
        <div className={estilos.indicadores}>
          <Indicador
            icono="calendario"
            etiqueta="Citas de hoy"
            proximamente
            detalle="Se mostrarán cuando actives la agenda."
          />
          <Indicador
            icono="dinero"
            etiqueta="Ingresos del mes"
            proximamente
            detalle="Se calcularán a partir de los servicios cobrados."
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
