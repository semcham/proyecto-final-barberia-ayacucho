import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { MisSolicitudes } from '../../components/datos-personales/MisSolicitudes';

/**
 * T015 de 007 · "Mis datos" del barbero (/app/mis-datos; US1, FR-002, FR-006): sus solicitudes sobre sus propios datos
 * en su barbería, que atiende el propietario.
 */
export default function MisDatosBarbero() {
  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Mis datos' }]}
        titulo="Mis datos"
        descripcion="Pide acceso, corrección o eliminación de tus datos personales en esta barbería. La atiende el propietario y te responde aquí."
      />
      <MisSolicitudes />
    </>
  );
}
