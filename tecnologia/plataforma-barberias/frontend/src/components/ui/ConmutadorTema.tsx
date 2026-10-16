import { type PreferenciaTema, useTema } from '../../tema';
import type { NombreIcono } from '../Icono';
import { BotonIcono } from './Boton';
import { Menu, MenuContenido, MenuDisparador, MenuEtiqueta, MenuGrupoRadio, MenuItemRadio } from './Menu';

const ICONO: Record<PreferenciaTema, NombreIcono> = { sistema: 'monitor', claro: 'sol', oscuro: 'luna' };

/** Conmutador de tema: sistema, claro u oscuro. */
export function ConmutadorTema({ tamano }: { tamano?: 'md' | 'sm' }) {
  const { tema, cambiarTema } = useTema();
  return (
    <Menu>
      <MenuDisparador asChild>
        <BotonIcono icono={ICONO[tema]} etiqueta="Cambiar tema" tamano={tamano} />
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
