// Violación a propósito (T003 de 005, kysely-solo-en-infraestructura): un caso de uso de M04 consulta la base.
import { sql } from 'kysely';

export const consultaDirecta = sql`SELECT 1`;
