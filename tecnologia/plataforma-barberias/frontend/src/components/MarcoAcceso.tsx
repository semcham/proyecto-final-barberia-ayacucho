import { lazy, type ReactNode, Suspense } from 'react';
import { Icono, type NombreIcono } from './Icono';
import { Logo } from './Logo';
import { ImagenMarca } from './marca/ImagenMarca';
import estilos from './MarcoAcceso.module.css';

export interface PuntoValor {
  icono: NombreIcono;
  titulo: string;
  texto: string;
}

/**
 * Foto real del panel de marca (ver public/img/README.md). Mientras sea undefined se usa la ilustración propia.
 * Ejemplo: const FOTO_MARCA = '/img/barberia.webp';
 */
const FOTO_MARCA: string | undefined = undefined;

// El conmutador de tema (menú de Radix) se descarga después de pintar el formulario: no está en la ruta
// crítica de las pantallas de acceso. Mientras llega, un hueco del mismo tamaño evita saltos de diseño.
const ConmutadorTema = lazy(() =>
  import('./ui/ConmutadorTema').then((modulo) => ({ default: modulo.ConmutadorTema })),
);

interface PropiedadesMarco {
  antetitulo: string;
  titular: string;
  descripcion: string;
  puntos?: PuntoValor[];
  pie?: ReactNode;
  children: ReactNode;
}

/**
 * Diseño común de las pantallas públicas de acceso (registro, ingreso y activación). En escritorio muestra
 * dos columnas: el panel de marca y el formulario en una tarjeta. En el celular solo se ve el formulario.
 */
export function MarcoAcceso({
  antetitulo,
  titular,
  descripcion,
  puntos = [],
  pie,
  children,
}: PropiedadesMarco) {
  return (
    <div className={estilos.marco}>
      <aside className={estilos.panel}>
        <ImagenMarca src={FOTO_MARCA} />
        <Logo />
        <div className={estilos.mensaje}>
          <p className="antetitulo">{antetitulo}</p>
          <p className={estilos.titular}>{titular}</p>
          <p className={estilos.descripcion}>{descripcion}</p>
          {puntos.length > 0 && (
            <ul className={estilos.puntos}>
              {puntos.map((punto) => (
                <li key={punto.titulo}>
                  <span className={estilos.iconoPunto}>
                    <Icono nombre={punto.icono} />
                  </span>
                  <span>
                    <strong>{punto.titulo}</strong>
                    <span>{punto.texto}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className={estilos.firma}>Hecho para las barberías de Ayacucho.</p>
      </aside>

      <main className={estilos.principal}>
        <div className={estilos.superior}>
          <div className={estilos.logoMovil}>
            <Logo />
          </div>
          <Suspense fallback={<span className={estilos.reservaTema} aria-hidden="true" />}>
            <ConmutadorTema />
          </Suspense>
        </div>
        <div className={`tarjeta ${estilos.tarjeta}`}>{children}</div>
        {pie && <div className={estilos.pie}>{pie}</div>}
      </main>
    </div>
  );
}
