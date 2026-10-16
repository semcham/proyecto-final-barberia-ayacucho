/** Pantalla completa de "Cargando…" (sesión en verificación o pantalla descargándose). */
export function PantallaCarga() {
  return (
    <main className="contenedor cargando" aria-busy="true">
      <span className="girador" aria-hidden="true" />
      <p>Cargando…</p>
    </main>
  );
}
