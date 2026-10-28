import type { Sesion } from './estado';

// Página alojada mínima (contracts/pasarela-simulada.md §2): el importe y tres botones. El propietario nunca
// escribe datos de Yape en la plataforma.

const escapar = (texto: string) =>
  texto.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export function paginaDeCheckout(sesion: Sesion, estadoVisible: string): string {
  const importe = (sesion.importeCentimos / 100).toFixed(2).replace('.', ',');
  const ref = encodeURIComponent(sesion.referencia);
  const botones =
    estadoVisible === 'PENDIENTE'
      ? ['aprobar', 'rechazar', 'pendiente']
          .map(
            (accion) =>
              `<form method="post" action="/checkout/${ref}/${accion}"><button type="submit">${
                { aprobar: 'Aprobar', rechazar: 'Rechazar', pendiente: 'Dejar pendiente' }[accion]
              }</button></form>`,
          )
          .join('')
      : `<p>Esta sesión ya no está pendiente (${escapar(estadoVisible)}).</p>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pasarela simulada</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 2rem auto; padding: 0 1rem">
<h1>Pasarela simulada · Yape</h1>
<p>${escapar(sesion.descripcion)}</p>
<p><strong>S/ ${importe}</strong></p>
${botones}
<p><small>Simulador de desarrollo y pruebas. Nunca se usa en producción.</small></p>
</body></html>`;
}
