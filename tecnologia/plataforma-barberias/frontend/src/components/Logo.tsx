import { Link } from 'react-router-dom';
import { Icono } from './Icono';
import estilos from './Logo.module.css';

/** Marca de la plataforma: lleva a la portada (o al panel, dentro de la aplicación). */
export function Logo({ compacto = false, destino = '/' }: { compacto?: boolean; destino?: string }) {
  return (
    <Link to={destino} className={estilos.logo}>
      <span className={estilos.sello}>
        <Icono nombre="tijeras" tamano={compacto ? 18 : 20} />
      </span>
      <span className={compacto ? 'sr-only' : estilos.nombre}>Barberías Ayacucho</span>
    </Link>
  );
}
