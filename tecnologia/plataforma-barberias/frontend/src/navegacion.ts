/**
 * Sale de la aplicación hacia otra página (p. ej. la página alojada del proveedor de pagos). Aparte para que
 * las pruebas puedan reemplazarla: jsdom no implementa la navegación.
 */
export function salirA(url: string): void {
  window.location.assign(url);
}
