// Fixture de PR14: un caso de uso que consulta la base sin pasar por un repositorio (kysely-solo-en-infraestructura).
import { sql } from 'kysely';

export const consultaDirecta = sql`select * from membership`;
