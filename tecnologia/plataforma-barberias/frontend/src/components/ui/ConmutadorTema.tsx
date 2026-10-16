import { type PreferenciaTema, useTema } from '../../tema';
import { Icono, type NombreIcono } from '../Icono';
import { clasesBoton } from './Boton';
import estilos from './ConmutadorTema.module.css';
import { Menu, MenuContenido, MenuDisparador, MenuEtiqueta, MenuGrupoRadio, MenuItemRadio } from './Menu';

const ICONO: Record<PreferenciaTema, NombreIcono> = { sistema: 'monitor', claro: 'sol', oscuro: 'luna' };
const NOMBRE: Record<PreferenciaTema, string> = { sistema: 'Sistema', claro: 'Claro', oscuro: 'Oscuro' };

/**
 * Conmutador de tema: sistema, claro u oscuro. Muestra el tema actual como texto (en pantallas angostas solo
 * el icono; el texto sigue disponible para lectores de pantalla).
 */
export function ConmutadorTema({ tamano = 'sm' }: { tamano?: 'md' | 'sm' }) {
  const { tema, cambiarTema } = useTema();
  return (
    <Menu>
      <MenuDisparador
        className={clasesBoton({ variante: 'secundario', tamano, className: estilos.disparador })}
      >
        <Icono nombre={ICONO[tema]} tamano={16} />
        <span className={estilos.texto}>
          <span className="sr-only">Tema: </span>
          {NOMBRE[tema]}
        </span>
        <span className={estilos.flecha}>
          <Icono nombre="chevronAbajo" tamano={14} />
        </span>
      </MenuDisparador>
      <MenuContenido>
        <MenuEtiqueta>Tema</MenuEtiqueta>
        <MenuGrupoRadio value={tema} onValueChange={(valor) => cambiarTema(valor as PreferenciaTema)}>
          <MenuItemRadio valor="sistema" icono="monitor">
            Según el sistema
          </MenuItemRadio>
          <MenuItemRadio valor="claro" icono="sol">
            Claro
          </MenuItemRadio>
          <MenuItemRadio valor="oscuro" icono="luna">
            Oscuro
          </MenuItemRadio>
        </MenuGrupoRadio>
      </MenuContenido>
    </Menu>
  );
}
