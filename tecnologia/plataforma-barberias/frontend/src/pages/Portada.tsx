import { Link } from 'react-router-dom';
import { Icono, type NombreIcono } from '../components/Icono';
import { Logo } from '../components/Logo';
import { clasesBoton } from '../components/ui/Boton';
import estilos from './Portada.module.css';

// Portada (/) para dueños de barbería. Todo lo que se afirma aquí existe hoy en la plataforma; los planes son los
// del catálogo de suscripciones (migraciones 0004 y 0014: TRIAL, BASICO y PRO), porque GET /planes exige sesión.
// Sin testimonios ni cifras de uso: no hay datos reales para mostrarlas.

const DIAS_PRUEBA = 14;

const PASOS: { icono: NombreIcono; titulo: string; texto: string }[] = [
  {
    icono: 'tienda',
    titulo: 'Registra tu barbería',
    texto: `Con su nombre y tu correo. Empiezas con ${DIAS_PRUEBA} días de prueba gratuita.`,
  },
  {
    icono: 'tijeras',
    titulo: 'Configura tus servicios y tu equipo',
    texto: 'Precios, duraciones, barberos y los horarios en que atiende cada uno.',
  },
  {
    icono: 'enlace',
    titulo: 'Comparte tu enlace para reservar',
    texto: 'Tus clientes eligen servicio, barbero y hora libre desde el celular.',
  },
];

const BENEFICIOS: { icono: NombreIcono; titulo: string; texto: string }[] = [
  {
    icono: 'calendario',
    titulo: 'Agenda en línea',
    texto:
      'Tus clientes reservan a cualquier hora desde tu enlace y solo ven horas libres: un barbero nunca tiene dos citas a la vez.',
  },
  {
    icono: 'usuarios',
    titulo: 'Equipo con acceso propio',
    texto: 'Cada barbero entra con su cuenta, ve su agenda, marca sus citas y define su disponibilidad.',
  },
  {
    icono: 'correo',
    titulo: 'Avisos a tus clientes',
    texto:
      'Confirmación al reservar y recordatorio el día de la cita, con enlaces para confirmar, reprogramar o cancelar.',
  },
  {
    icono: 'grafico',
    titulo: 'Reportes y asistente',
    texto:
      'Citas del período y servicios más pedidos, y un asistente que responde consultas sobre tus servicios y horarios.',
  },
];

// Catálogo de planes (precio mensual en soles y límites). Los usuarios incluyen al propietario.
const PLANES: { nombre: string; precio: string; periodo: string; limites: string; destacado?: boolean }[] = [
  {
    nombre: 'Prueba gratuita',
    precio: 'S/ 0',
    periodo: `${DIAS_PRUEBA} días`,
    limites: 'Hasta 5 usuarios y 5 barberos',
  },
  { nombre: 'Básico', precio: 'S/ 49', periodo: 'al mes', limites: 'Hasta 3 usuarios y 3 barberos' },
  {
    nombre: 'Pro',
    precio: 'S/ 89',
    periodo: 'al mes',
    limites: 'Hasta 8 usuarios y 8 barberos',
    destacado: true,
  },
];

const PREGUNTAS: { pregunta: string; respuesta: string }[] = [
  {
    pregunta: '¿Necesito una tarjeta para probar?',
    respuesta: `No. La prueba gratuita dura ${DIAS_PRUEBA} días, no pide tarjeta y no hace cargos automáticos al terminar.`,
  },
  {
    pregunta: '¿Tengo que instalar algo?',
    respuesta:
      'No. Funciona en el navegador del celular o de la computadora, sin instalar ninguna aplicación.',
  },
  {
    pregunta: '¿Mis datos se mezclan con los de otras barberías?',
    respuesta:
      'No. Los datos de cada barbería están separados: ninguna barbería puede ver los clientes, las citas ni el catálogo de otra.',
  },
  {
    pregunta: '¿Mis barberos pueden entrar con su propia cuenta?',
    respuesta:
      'Sí. Creas la cuenta de cada barbero y le compartes un enlace para activarla; cada uno entra con su correo y su contraseña.',
  },
];

// Agenda de ejemplo para la tarjeta ilustrativa (nombres ficticios).
const CITAS_EJEMPLO: { hora: string; cliente: string; detalle: string; estado: string }[] = [
  { hora: '09:30', cliente: 'Luis H.', detalle: 'Corte clásico · Carlos', estado: 'Confirmada' },
  { hora: '11:00', cliente: 'Rocío P.', detalle: 'Corte y barba · Ana', estado: 'Confirmada' },
  { hora: '15:30', cliente: 'Pedro C.', detalle: 'Arreglo de barba · Carlos', estado: 'Pendiente' },
];

const ENLACES_SECCION = [
  { a: '#como-funciona', texto: 'Cómo funciona' },
  { a: '#beneficios', texto: 'Beneficios' },
  { a: '#planes', texto: 'Planes' },
  { a: '#preguntas', texto: 'Preguntas' },
];

function Encabezado() {
  return (
    <header className={estilos.barra}>
      <div className={estilos.barraInterior}>
        {/* Solo uno de los dos se muestra (y queda en el árbol de accesibilidad) según el ancho. */}
        <span className={estilos.logoAncho}>
          <Logo />
        </span>
        <span className={estilos.logoCompacto}>
          <Logo compacto />
        </span>
        <nav aria-label="Secciones de la portada" className={estilos.secciones}>
          <ul>
            {ENLACES_SECCION.map((enlace) => (
              <li key={enlace.a}>
                <a href={enlace.a}>{enlace.texto}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={estilos.barraAcciones}>
          <Link to="/ingresar" className={clasesBoton({ variante: 'fantasma', tamano: 'sm' })}>
            Ingresar
          </Link>
          <Link to="/registro" className={clasesBoton({ tamano: 'sm' })}>
            Registra tu barbería
          </Link>
        </div>
      </div>
    </header>
  );
}

function AgendaDeEjemplo() {
  return (
    <figure className={estilos.ejemplo} aria-labelledby="titulo-ejemplo">
      <div className={estilos.ejemploCabecera}>
        <div>
          <p id="titulo-ejemplo" className={estilos.ejemploTitulo}>
            Agenda de hoy
          </p>
          <p className={estilos.ejemploSubtitulo}>Barbería de ejemplo</p>
        </div>
        <span className={estilos.marcaEjemplo}>Vista de ejemplo</span>
      </div>
      <ul className={estilos.ejemploLista}>
        {CITAS_EJEMPLO.map((cita) => (
          <li key={cita.hora}>
            <span className={estilos.ejemploHora}>{cita.hora}</span>
            <span className={estilos.ejemploTextos}>
              <strong>{cita.cliente}</strong>
              <span>{cita.detalle}</span>
            </span>
            <span
              className={estilos.ejemploEstado}
              data-estado={cita.estado === 'Confirmada' ? 'ok' : undefined}
            >
              {cita.estado}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className={estilos.ejemploNota}>Datos ficticios, solo para mostrar cómo se ve.</figcaption>
    </figure>
  );
}

/** Portada de la plataforma para dueños de barbería (SaaS). */
export default function Portada() {
  return (
    <div className={estilos.pagina}>
      <a href="#contenido-portada" className={estilos.saltar}>
        Saltar al contenido
      </a>
      <Encabezado />

      <main id="contenido-portada">
        <section className={estilos.portada} aria-labelledby="titulo-portada">
          <div className={estilos.portadaTextos}>
            <p className="antetitulo">Software para barberías</p>
            <h1 id="titulo-portada" className={estilos.titulo}>
              Las citas, tu equipo y tus clientes en un solo lugar.
            </h1>
            <p className={estilos.bajada}>
              Tus clientes reservan desde tu enlace, tu equipo ve su agenda y tú sabes cómo va tu barbería,
              desde el celular.
            </p>
            <div className={estilos.accionesPortada}>
              <Link to="/registro" className={clasesBoton()}>
                Empieza gratis, {DIAS_PRUEBA} días
                <Icono nombre="flecha" tamano={18} />
              </Link>
              <a href="#como-funciona" className={clasesBoton({ variante: 'secundario' })}>
                Cómo funciona
              </a>
            </div>
            <p className={estilos.nota}>
              <Icono nombre="check" tamano={16} />
              Sin tarjeta y sin compromiso
            </p>
          </div>
          <AgendaDeEjemplo />
        </section>

        <section id="como-funciona" className={estilos.seccion} aria-labelledby="titulo-como">
          <div className={estilos.seccionCabecera}>
            <p className="antetitulo">Cómo funciona</p>
            <h2 id="titulo-como" className={estilos.seccionTitulo}>
              Lista para recibir reservas en tres pasos
            </h2>
          </div>
          <ol className={estilos.pasos}>
            {PASOS.map((paso, i) => (
              <li key={paso.titulo} className={estilos.tarjetaItem}>
                <span className={estilos.circulo} aria-hidden="true">
                  <Icono nombre={paso.icono} />
                </span>
                <h3 className={estilos.itemTitulo}>
                  <span className={estilos.numeroPaso}>{i + 1}.</span> {paso.titulo}
                </h3>
                <p className={estilos.itemTexto}>{paso.texto}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="beneficios" className={estilos.seccion} aria-labelledby="titulo-beneficios">
          <div className={estilos.seccionCabecera}>
            <p className="antetitulo">Beneficios</p>
            <h2 id="titulo-beneficios" className={estilos.seccionTitulo}>
              Pensado para el día a día de tu barbería
            </h2>
          </div>
          <ul className={estilos.beneficios}>
            {BENEFICIOS.map((beneficio) => (
              <li key={beneficio.titulo} className={estilos.tarjetaItem}>
                <span className={estilos.circulo} aria-hidden="true">
                  <Icono nombre={beneficio.icono} />
                </span>
                <h3 className={estilos.itemTitulo}>{beneficio.titulo}</h3>
                <p className={estilos.itemTexto}>{beneficio.texto}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="planes" className={estilos.seccion} aria-labelledby="titulo-planes">
          <div className={estilos.seccionCabecera}>
            <p className="antetitulo">Planes</p>
            <h2 id="titulo-planes" className={estilos.seccionTitulo}>
              Elige el plan según el tamaño de tu equipo
            </h2>
            <p className={estilos.seccionBajada}>
              Precios en soles. Los usuarios incluyen al propietario. Al terminar la prueba eliges un plan o
              tu barbería deja de recibir reservas nuevas.
            </p>
          </div>
          <ul className={estilos.planes}>
            {PLANES.map((plan) => (
              <li key={plan.nombre} className={estilos.plan} data-destacado={plan.destacado || undefined}>
                <h3 className={estilos.planNombre}>{plan.nombre}</h3>
                <p className={estilos.planPrecio}>
                  <strong>{plan.precio}</strong> <span>{plan.periodo}</span>
                </p>
                <p className={estilos.planLimites}>
                  <Icono nombre="usuarios" tamano={18} />
                  {plan.limites}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id="preguntas" className={estilos.seccion} aria-labelledby="titulo-preguntas">
          <div className={estilos.seccionCabecera}>
            <p className="antetitulo">Preguntas</p>
            <h2 id="titulo-preguntas" className={estilos.seccionTitulo}>
              Preguntas frecuentes
            </h2>
          </div>
          <div className={estilos.preguntas}>
            {PREGUNTAS.map((p) => (
              <details key={p.pregunta} className={estilos.pregunta}>
                <summary>
                  <span>{p.pregunta}</span>
                  <Icono nombre="chevronAbajo" tamano={18} />
                </summary>
                <p>{p.respuesta}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={estilos.cierre} aria-labelledby="titulo-cierre">
          <h2 id="titulo-cierre" className={estilos.cierreTitulo}>
            Empieza hoy tu prueba gratuita de {DIAS_PRUEBA} días
          </h2>
          <p className={estilos.cierreTexto}>
            Registra tu barbería en minutos. Sin tarjeta y sin compromiso.
          </p>
          <Link to="/registro" className={clasesBoton()}>
            Registra tu barbería
            <Icono nombre="flecha" tamano={18} />
          </Link>
        </section>
      </main>

      <footer className={estilos.pie}>
        <div className={estilos.pieInterior}>
          <Logo />
          <p className={estilos.pieTexto}>Hecho para las barberías de Ayacucho.</p>
          <ul className={estilos.pieEnlaces}>
            <li>
              <Link to="/ingresar">Ingresar</Link>
            </li>
            {/* Los textos legales aún no están publicados: se muestran sin enlace hasta que existan. */}
            <li>
              <span>Términos de uso (en preparación)</span>
            </li>
            <li>
              <span>Política de privacidad (en preparación)</span>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
