import { useCallback, useState } from 'react';

// Preferencia de tema del visitante. Es una comodidad local: si el navegador no deja guardar (modo privado,
// almacenamiento bloqueado), la aplicación sigue funcionando con el tema del sistema.

export type PreferenciaTema = 'sistema' | 'claro' | 'oscuro';

const CLAVE = 'tema';
const ATRIBUTO: Record<PreferenciaTema, string | null> = { sistema: null, claro: 'light', oscuro: 'dark' };

export function leerPreferenciaTema(): PreferenciaTema {
  try {
    const valor = localStorage.getItem(CLAVE);
    return valor === 'claro' || valor === 'oscuro' ? valor : 'sistema';
  } catch {
    return 'sistema';
  }
}

export function aplicarTema(preferencia: PreferenciaTema): void {
  const atributo = ATRIBUTO[preferencia];
  if (atributo) document.documentElement.dataset.theme = atributo;
  else delete document.documentElement.dataset.theme;
}

export function useTema() {
  const [tema, setTema] = useState<PreferenciaTema>(leerPreferenciaTema);
  const cambiarTema = useCallback((preferencia: PreferenciaTema) => {
    setTema(preferencia);
    aplicarTema(preferencia);
    try {
      if (preferencia === 'sistema') localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, preferencia);
    } catch {
      // Sin almacenamiento: el cambio vale solo para esta visita.
    }
  }, []);
  return { tema, cambiarTema };
}
