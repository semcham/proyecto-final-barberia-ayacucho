import { Link } from 'react-router-dom';
import { Icono } from './Icono';
import estilos from './Logo.module.css';

/** Marca de la plataforma: lleva a la portada. */
export function Logo({ compacto = false }: { compacto?: boolean }) {
  return (
    <Link to="/" className={estilos.logo}>
      <span className={estilos.sello}>
        <Icono nombre="tijeras" tamano={compacto ? 18 : 20} />
      </span>
      <span className={compacto ? 'sr-only' : estilos.nombre}>Barberías Ayacucho</span>
    </Link>
  );
}
