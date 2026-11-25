import { MisSolicitudes } from '../../components/datos-personales/MisSolicitudes';
import { EncabezadoCliente } from './EncabezadoCliente';
import estilos from './MiCuenta.module.css';

/**
 * T015 de 007 · "Mis datos" del cliente (/mis-datos; US1, FR-001, FR-006). Solo con sesión de cliente, en la barbería
 * de su sesión. Desde el rediseño del 2026-11-24 vive en el panel del cliente, bajo "Mi cuenta".
 */
export default function MisDatos() {
  return (
    <div className={estilos.pagina}>
      <EncabezadoCliente
        antetitulo="Mi cuenta"
        titulo="Mis datos"
        descripcion="Pide acceso, corrección o eliminación de tus datos personales en esta barbería. La barbería la atiende y te responde aquí."
      />
      <MisSolicitudes />
    </div>
  );
}
