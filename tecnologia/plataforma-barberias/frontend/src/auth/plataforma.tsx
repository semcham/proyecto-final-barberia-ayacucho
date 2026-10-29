import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  apiPlataforma,
  type CodigoSegundoFactor,
  renovarPlataforma,
  tokenPlataforma,
} from '../api/plataforma';
import { PantallaCarga } from './PantallaCarga';

// T071 · Sesión del administrador de la plataforma (R07, ADR-031), separada de la de las barberías: otro
// contexto, otro token en memoria y otra cookie. Iniciar o cerrar una no toca la otra.

export type EstadoPlataforma = 'cargando' | 'anonimo' | 'autenticado';

interface ContextoPlataforma {
  estado: EstadoPlataforma;
  /** Primer paso: devuelve el desafío para el segundo factor. */
  ingresar(correo: string, contrasena: string): Promise<string>;
  /** Segundo paso: con el código correcto, la sesión queda abierta. */
  verificar(desafio: string, codigo: CodigoSegundoFactor): Promise<void>;
  salir(): Promise<void>;
}

const Contexto = createContext<ContextoPlataforma | null>(null);

export function ProveedorPlataforma({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoPlataforma>(() =>
    tokenPlataforma.obtener() ? 'autenticado' : 'cargando',
  );

  // Al entrar a /plataforma (recarga o pestaña nueva), se intenta renovar con la cookie de plataforma.
  useEffect(() => {
    if (estado !== 'cargando') return;
    let vigente = true;
    void renovarPlataforma().then((ok) => {
      if (vigente) setEstado(ok ? 'autenticado' : 'anonimo');
    });
    return () => {
      vigente = false;
    };
  }, [estado]);

  const ingresar = useCallback(
    async (correo: string, contrasena: string) => (await apiPlataforma.ingresar(correo, contrasena)).desafio,
    [],
  );
  const verificar = useCallback(async (desafio: string, codigo: CodigoSegundoFactor) => {
    await apiPlataforma.verificar(desafio, codigo);
    setEstado('autenticado');
  }, []);
  const salir = useCallback(async () => {
    try {
      await apiPlataforma.salir();
    } finally {
      setEstado('anonimo');
    }
  }, []);

  const valor = useMemo(() => ({ estado, ingresar, verificar, salir }), [estado, ingresar, verificar, salir]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePlataforma(): ContextoPlataforma {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('usePlataforma requiere ProveedorPlataforma');
  return contexto;
}

/** Raíz de las rutas /plataforma/*: su propia sesión para todas ellas. */
export function RaizPlataforma() {
  return (
    <ProveedorPlataforma>
      <Outlet />
    </ProveedorPlataforma>
  );
}

/** Solo con la sesión de plataforma abierta; si no, al ingreso del administrador. */
export function RutaPlataforma({ children }: { children: ReactNode }) {
  const { estado } = usePlataforma();
  const { pathname } = useLocation();
  if (estado === 'cargando') return <PantallaCarga />;
  if (estado === 'anonimo') return <Navigate to="/plataforma/ingresar" replace state={{ desde: pathname }} />;
  return <>{children}</>;
}
