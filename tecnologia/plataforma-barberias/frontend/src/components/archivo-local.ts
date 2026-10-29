import { useCallback, useEffect, useRef, useState } from 'react';

/** Vida de la URL local de un comprobante (R09): pasado este tiempo, el enlace deja de funcionar. */
export const VIDA_URL_LOCAL_MS = 60_000;

/**
 * T084 · Un archivo descargado con la sesión (el comprobante de una transferencia) se muestra con una URL
 * `blob:` del propio navegador, que se revoca a los 60 s o al cerrar la pantalla. No existe ninguna URL del
 * servidor que sirva el archivo sin sesión (FR-041), así que copiar el enlace no sirve de nada.
 */
export function useArchivoLocal(): { url: string | null; mostrar(archivo: Blob): void; cerrar(): void } {
  const [url, setUrl] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actual = useRef<string | null>(null);

  const cerrar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    if (actual.current) URL.revokeObjectURL(actual.current);
    actual.current = null;
    setUrl(null);
  }, []);

  const mostrar = useCallback(
    (archivo: Blob) => {
      cerrar();
      const nueva = URL.createObjectURL(archivo);
      actual.current = nueva;
      setUrl(nueva);
      temporizador.current = setTimeout(cerrar, VIDA_URL_LOCAL_MS);
    },
    [cerrar],
  );

  useEffect(() => cerrar, [cerrar]);
  return { url, mostrar, cerrar };
}
