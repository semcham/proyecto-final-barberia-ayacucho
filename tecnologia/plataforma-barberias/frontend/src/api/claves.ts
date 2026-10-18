// Claves de TanStack Query compartidas entre pantallas: quien guarda un dato y quien lo invalida usan la misma.
export const clavesConsulta = {
  /** Catálogo público de una barbería (GET /publico/{slug}). */
  catalogo: (slug: string) => ['catalogo', slug] as const,
  /**
   * Horarios libres (GET /publico/{slug}/horarios). Con solo el `slug` sirve de prefijo para invalidar todos
   * los de esa barbería, por ejemplo tras un 409 al reservar.
   */
  horarios: (slug: string, servicioId?: string, fecha?: string, barberoId?: string) =>
    ['horarios', slug, ...[servicioId, fecha, barberoId].filter((parte) => parte !== undefined)] as const,
};
