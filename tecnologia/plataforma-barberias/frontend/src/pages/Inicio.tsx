import { Link, useLocation } from 'react-router-dom';
import { useSesion } from '../auth/SesionProvider';
import { Icono } from '../components/Icono';
import type { EstadoBienvenida } from './Registro';
import estilos from './Inicio.module.css';

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PRUEBA = 14;

function diasRestantes(venceEn: string, ahora = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(venceEn).getTime() - ahora) / DIA_MS));
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

  return (
    <main className="contenedor">
      <section className={estilos.bienvenida}>
        <p className="antetitulo">Panel de tu barbería</p>
        <h1>{nombre}</h1>
        {dias !== null ? (
          <p className={estilos.saludo}>
            Tu prueba gratuita está activa: te {dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}.
          </p>
        ) : (
          <p className={estilos.saludo}>Hola, {usuario?.nombre}.</p>
        )}
      </section>

      {dias !== null && venceEn && (
        <section className={`tarjeta ${estilos.prueba}`} aria-labelledby="titulo-prueba">
          <div className={estilos.pruebaCabecera}>
            <span className={estilos.iconoTarjeta}>
              <Icono nombre="reloj" />
            </span>
            <div>
              <h2 id="titulo-prueba">Prueba gratuita</h2>
              <p className="texto-suave">
                Vence el {new Date(venceEn).toLocaleDateString('es-PE', { dateStyle: 'long' })}. Sin tarjeta y
                sin cargos automáticos.
              </p>
            </div>
          </div>
          <div className={estilos.progreso} aria-hidden="true">
            <span style={{ width: `${Math.min(100, (dias / DIAS_PRUEBA) * 100)}%` }} />
          </div>
        </section>
      )}

      <section className={estilos.accesos} aria-label="Accesos rápidos">
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
            <Icono nombre="calendario" />
          </span>
          <span className={estilos.accesoTexto}>
            <strong>Agenda y citas</strong>
            <span>Muy pronto podrás organizar las citas de tu barbería desde aquí.</span>
          </span>
          <span className={estilos.proximamente}>Próximamente</span>
        </div>

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
      </section>
    </main>
  );
}
