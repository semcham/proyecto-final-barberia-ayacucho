import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { llamarApi, renovarSesion, suscribirSesionPerdida, tokenEnMemoria } from '../api/client';
import type { components } from '../api/schema';
import { indicadorSesion } from './indicadorSesion';

type SesionResponse = components['schemas']['SesionResponse'];
/** Rol de la sesión: el contrato de 001 define el personal; la funcionalidad 002 agrega CLIENTE (ADR-020). */
export type RolSesion = components['schemas']['UsuarioActual']['rol'] | 'CLIENTE';
export type UsuarioActual = Omit<components['schemas']['UsuarioActual'], 'rol'> & { rol: RolSesion };
export type EstadoSesion = 'cargando' | 'anonimo' | 'autenticado';

interface ValorSesion {
  estado: EstadoSesion;
  usuario: UsuarioActual | null;
  /** Lanza ApiError si el servidor rechaza el ingreso (401, 403 o 429). */
  iniciarSesion(correo: string, contrasena: string): Promise<void>;
  cerrarSesion(): Promise<void>;
  /** Guarda una sesión recibida del servidor (inicio de sesión o registro de la barbería). */
  establecer(sesion: SesionResponse): void;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

/**
 * Sesión del usuario en la interfaz (R19). El token de acceso vive solo en memoria; al cargar la página se
 * recupera con la cookie HttpOnly de renovación, solo si hubo una sesión reciente (indicadorSesion). Si una
 * renovación falla, la sesión pasa a anónima.
 */
export function SesionProvider({ children }: { children: ReactNode }) {
  // Sin sesión reciente se empieza como anónimo y no se intenta renovar (la respuesta sería un 401 seguro).
  const [estado, setEstado] = useState<EstadoSesion>(() =>
    indicadorSesion.presente() ? 'cargando' : 'anonimo',
  );
  const [usuario, setUsuario] = useState<UsuarioActual | null>(null);

  const establecer = useCallback((sesion: SesionResponse) => {
    tokenEnMemoria.fijar(sesion.tokenAcceso);
    indicadorSesion.marcar();
    setUsuario(sesion.usuario);
    setEstado('autenticado');
  }, []);

  const quedarAnonimo = useCallback(() => {
    tokenEnMemoria.limpiar();
    indicadorSesion.quitar();
    setUsuario(null);
    setEstado('anonimo');
  }, []);

  useEffect(() => {
    let vigente = true;
    const cancelar = suscribirSesionPerdida(quedarAnonimo);
    if (!indicadorSesion.presente()) return cancelar;
    void renovarSesion().then((sesion) => {
      if (!vigente) return;
      if (sesion) establecer(sesion);
      else quedarAnonimo();
    });
    return () => {
      vigente = false;
      cancelar();
    };
  }, [establecer, quedarAnonimo]);

  const iniciarSesion = useCallback(
    async (correo: string, contrasena: string) => {
      const sesion = await llamarApi<SesionResponse>('/auth/login', {
        metodo: 'POST',
        cuerpo: { correo, contrasena },
        sinRenovar: true,
      });
      establecer(sesion);
    },
    [establecer],
  );

  const cerrarSesion = useCallback(async () => {
    try {
      await llamarApi('/auth/logout', { metodo: 'POST', sinRenovar: true });
    } catch {
      // Aunque el servidor no responda, la interfaz deja de tener sesión.
    } finally {
      quedarAnonimo();
    }
  }, [quedarAnonimo]);

  const valor = useMemo(
    () => ({ estado, usuario, iniciarSesion, cerrarSesion, establecer }),
    [estado, usuario, iniciarSesion, cerrarSesion, establecer],
  );
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): ValorSesion {
  const valor = useContext(ContextoSesion);
  if (!valor) throw new Error('useSesion debe usarse dentro de SesionProvider');
  return valor;
}
