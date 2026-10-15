// Fragmentos SQL compartidos por las migraciones.

/**
 * Tenant de la transacción actual. NULLIF evita un error de conversión: en una conexión del pool que
 * ya usó set_config(..., true), current_setting devuelve '' (no NULL) en transacciones posteriores.
 * Sin tenant fijado, la expresión es NULL y la política no deja ver ni escribir filas.
 */
export const TENANT_ACTUAL = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

/** RLS forzada (también para el dueño de la tabla) con la política tenant_isolation (R04). */
export function rlsPorTenant(tabla: string): string {
  return `
    ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${tabla}
      USING (tenant_id = ${TENANT_ACTUAL})
      WITH CHECK (tenant_id = ${TENANT_ACTUAL});
  `;
}
