import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  conBloqueoEntrePestanas,
  llamarApi,
  renovarSesion,
  suscribirSesionPerdida,
  tokenEnMemoria,
} from '../api/client';
import type { components } from '../api/schema-002';
import { indicadorSesion } from './indicadorSesion';

// El contrato de 002 amplía la sesión de 001 con el rol CLIENTE (ADR-020); las respuestas de 001 encajan en él.
type SesionResponse = components['schemas']['SesionResponse'];
export type UsuarioActual = components['schemas']['UsuarioActual'];
export type RolSesion = UsuarioActual['rol'];
export type EstadoSesion = 'cargando' | 'anonimo' | 'autenticado';

/** Aceptación de la política de datos y teléfono para unirse como cliente a otra barbería (ADR-020). */
export interface DatosUnion {
  aceptaPoliticaDatos: true;
  versionPoliticaDatos: string;
  telefono: string;
}

export interface OpcionesIngreso {
  /** `slug` del enlace desde el que se ingresa (clientes). */
  barberia?: string;
  union?: DatosUnion;
}

interface ValorSesion {
  estado: EstadoSesion;
  usuario: UsuarioActual | null;
  /** Lanza ApiError si el servidor rechaza el ingreso (401, 403, 409 o 429). */
  iniciarSesion(correo: string, contrasena: string, opciones?: OpcionesIngreso): Promise<void>;
  /**
   * Deja la sesión del cliente en la barbería del `slug`. Si la sesión es de otra barbería, la cambia con
   * POST /auth/barberia; lanza el ApiError 409 `UNIRSE_REQUIERE_CONSENTIMIENTO` si aún no es cliente de ella.
   */
  asegurarBarberia(slug: string, union?: DatosUnion): Promise<void>;
  cerrarSesion(): Promise<void>;
  /** Guarda una sesión recibida del servidor (inicio de sesión o registro). */
  establecer(sesion: SesionResponse): void;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

/**
 * Sesión del usuario en la interfaz (R19). El token de acceso vive solo en memoria; al cargar la página se
 * recupera con la cookie HttpOnly de renovación, solo si hubo una sesión reciente (indicadorSesion). Si una
 * renovación falla, la sesión pasa a anónima. La barbería de la sesión (`usuario.barberia.slug`) es la del
 * token: el cliente opera en una barbería a la vez.
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
    async (correo: string, contrasena: string, { barberia, union }: OpcionesIngreso = {}) => {
      const sesion = await llamarApi<SesionResponse>('/auth/login', {
        metodo: 'POST',
        cuerpo: { correo, contrasena, ...(barberia && { barberia }), ...union },
        sinRenovar: true,
      });
      establecer(sesion);
    },
    [establecer],
  );

  const asegurarBarberia = useCallback(
    async (slug: string, union?: DatosUnion) => {
      if (usuario?.barberia.slug === slug) return;
      // El cambio rota la cookie de renovación: va con el mismo bloqueo entre pestañas que la renovación
      // (FR-008a de 001), para que otra pestaña no presente la cookie que este cambio deja cerrada. Dentro
      // del bloqueo no se renueva (el bloqueo no es reentrante); un 401 se renueva fuera y se reintenta una vez.
      const cambiar = () =>
        conBloqueoEntrePestanas(() =>
          llamarApi<SesionResponse>('/auth/barberia', {
            metodo: 'POST',
            cuerpo: { barberia: slug, ...union },
            sinRenovar: true,
          }),
        );
      let sesion: SesionResponse;
      try {
        sesion = await cambiar();
      } catch (causa) {
        if (!(causa instanceof ApiError) || causa.estado !== 401) throw causa;
        if (!(await renovarSesion())) {
          quedarAnonimo();
          throw causa;
        }
        sesion = await cambiar();
      }
      establecer(sesion);
    },
    [usuario, establecer, quedarAnonimo],
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
    () => ({ estado, usuario, iniciarSesion, asegurarBarberia, cerrarSesion, establecer }),
    [estado, usuario, iniciarSesion, asegurarBarberia, cerrarSesion, establecer],
  );
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): ValorSesion {
  const valor = useContext(ContextoSesion);
  if (!valor) throw new Error('useSesion debe usarse dentro de SesionProvider');
  return valor;
}
