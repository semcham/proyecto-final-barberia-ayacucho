import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icono } from '../../components/Icono';
import { Logo } from '../../components/Logo';
import { clasesBoton, EtiquetaEstado } from '../../components/ui';
import type { Bloque, DocumentoLegal as Documento } from '../../legal/documento';
import { PRIVACIDAD } from '../../legal/privacidad';
import { TERMINOS } from '../../legal/terminos';
import estilos from './DocumentoLegal.module.css';

// Páginas públicas de los textos legales (010, US3; FR-024, FR-027): /terminos y /privacidad. Se abren sin sesión.

// Marcas del texto: `código` y [texto](/ruta).
const MARCAS = /`([^`]+)`|\[([^\]]+)\]\((\/[^)\s]*)\)/g;

function enLinea(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  let desde = 0;
  for (const marca of texto.matchAll(MARCAS)) {
    const inicio = marca.index ?? 0;
    if (inicio > desde) partes.push(texto.slice(desde, inicio));
    if (marca[1] !== undefined) {
      partes.push(<code key={inicio}>{marca[1]}</code>);
    } else {
      partes.push(
        <Link key={inicio} to={marca[3] as string}>
          {marca[2]}
        </Link>,
      );
    }
    desde = inicio + marca[0].length;
  }
  if (desde < texto.length) partes.push(texto.slice(desde));
  return partes;
}

function BloqueTexto({ bloque }: { bloque: Bloque }) {
  if (bloque.tipo === 'parrafo') return <p>{enLinea(bloque.texto)}</p>;
  return (
    <ul>
      {bloque.items.map((item) => (
        <li key={item}>{enLinea(item)}</li>
      ))}
    </ul>
  );
}

/** "2026-11-23" → "23 de noviembre de 2026" (sin depender de la zona horaria del equipo). */
function fechaLarga(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-PE', { dateStyle: 'long', timeZone: 'UTC' });
}

function PaginaDocumento({
  documento,
  otro,
}: {
  documento: Documento;
  otro: { a: '/terminos' | '/privacidad'; titulo: string };
}) {
  return (
    <div className={estilos.pagina}>
      <header className={estilos.barra}>
        <Logo />
      </header>

      <main className={estilos.contenido}>
        <div className={estilos.cabecera}>
          <p className="antetitulo">Textos legales</p>
          <h1 className={estilos.titulo}>{documento.titulo}</h1>
          <p className={estilos.version}>
            Versión {documento.version} · Vigente desde{' '}
            <time dateTime={documento.vigenteDesde}>{fechaLarga(documento.vigenteDesde)}</time>
          </p>
          {documento.borrador && (
            <p className={estilos.borrador}>
              <EtiquetaEstado tono="aviso">Borrador pendiente de revisión</EtiquetaEstado>
              <span>Los datos entre corchetes aún deben completarse.</span>
            </p>
          )}
          <p className={estilos.resumen}>{documento.resumen}</p>
        </div>

        <div className={estilos.cuerpo}>
          <nav aria-label="Contenido" className={estilos.indice}>
            <p className={estilos.indiceTitulo} aria-hidden="true">
              Contenido
            </p>
            <ol>
              {documento.secciones.map((seccion) => (
                <li key={seccion.id}>
                  <a href={`#${seccion.id}`}>{seccion.titulo}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={estilos.texto}>
            {documento.secciones.map((seccion) => (
              <section key={seccion.id} aria-labelledby={seccion.id}>
                <h2 id={seccion.id}>{seccion.titulo}</h2>
                {seccion.bloques.map((bloque, i) => (
                  <BloqueTexto key={i} bloque={bloque} />
                ))}
              </section>
            ))}
          </div>
        </div>

        <footer className={estilos.pie}>
          <p>
            Lee también la <Link to={otro.a}>{otro.titulo}</Link>.
          </p>
          <Link to="/" className={clasesBoton({ variante: 'secundario' })}>
            <Icono nombre="inicio" tamano={18} />
            Volver al inicio
          </Link>
        </footer>
      </main>
    </div>
  );
}

export function Terminos() {
  return (
    <PaginaDocumento
      documento={TERMINOS}
      otro={{ a: '/privacidad', titulo: PRIVACIDAD.titulo.toLowerCase() }}
    />
  );
}

export function Privacidad() {
  return (
    <PaginaDocumento
      documento={PRIVACIDAD}
      otro={{ a: '/terminos', titulo: TERMINOS.titulo.toLowerCase() }}
    />
  );
}
