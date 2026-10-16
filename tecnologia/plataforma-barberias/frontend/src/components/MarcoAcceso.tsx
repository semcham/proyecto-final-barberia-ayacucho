import type { ReactNode } from 'react';
import { Icono, type NombreIcono } from './Icono';
import { Logo } from './Logo';
import { ConmutadorTema } from './ui';
import estilos from './MarcoAcceso.module.css';

export interface PuntoValor {
  icono: NombreIcono;
  titulo: string;
  texto: string;
}

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
          <ConmutadorTema />
        </div>
        <div className={`tarjeta ${estilos.tarjeta}`}>{children}</div>
        {pie && <div className={estilos.pie}>{pie}</div>}
      </main>
    </div>
  );
}
