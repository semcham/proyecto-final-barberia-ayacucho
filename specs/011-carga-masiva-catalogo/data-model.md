# Data Model: Carga masiva de servicios y barberos (011)

Lo que se crea en una carga son **Servicios** y **Barberos** iguales a los de 002 (tablas `service`, `barber`,
`barber_service`; sin cambios). Lo nuevo es una tabla técnica de cargas para los reintentos y dos funciones puras del
dominio.

## 1. Tabla nueva `catalog_batch` (migración `0037_carga_lote`)

Una fila por carga **guardada** (las rechazadas no dejan fila). Sirve solo para que un reintento con la misma
`Idempotency-Key` devuelva el mismo resumen (research R06).

| Columna            | Tipo          | Reglas                                                                 |
| ------------------ | ------------- | ---------------------------------------------------------------------- |
| `id`               | `uuid`        | PK (UUIDv7)                                                            |
| `tenant_id`        | `uuid`        | NOT NULL, FK a la barbería; RLS                                        |
| `author_user_id`   | `uuid`        | NOT NULL; el propietario que guardó la carga                           |
| `idempotency_key`  | `uuid`        | NOT NULL                                                               |
| `kind`             | `text`        | NOT NULL, `CHECK (kind IN ('SERVICIOS', 'BARBEROS'))`                  |
| `rows_digest`      | `text`        | NOT NULL; SHA-256 (hex) de las filas normalizadas                      |
| `created_count`    | `int`         | NOT NULL, `CHECK (created_count BETWEEN 1 AND 50)`                     |
| `created_ids`      | `uuid[]`      | NOT NULL; ids de lo creado, en el orden de las filas                   |
| `created_at`       | `timestamptz` | NOT NULL DEFAULT `now()`                                               |

- Índice único `catalog_batch_idempotencia (tenant_id, author_user_id, idempotency_key)`.
- RLS habilitada y forzada con la política de tenant de las demás tablas de negocio (`tenant_id =
  current_setting('app.tenant_id')`, como en `sql-comun.ts`).
- Permisos: `barberias_app` solo `SELECT, INSERT`; `barberias_publico`, `barberias_plataforma` y el rol de conteos, nada.
  Sin `UPDATE` ni `DELETE`: la fila no cambia.
- Sin datos de personas: los nombres de servicios y barberos no se guardan aquí (solo su huella y los ids).
- Limpieza: no hace falta en esta etapa (una fila por carga, pocas por barbería). Anotado como mejora si crece.

## 2. Entrada de una carga (no se guarda como tal)

**Fila de servicio**

| Campo             | Regla (la misma de `Servicio`)                                     | Problema                        |
| ----------------- | ------------------------------------------------------------------ | ------------------------------- |
| `nombre`          | 2 a 80 caracteres tras quitar espacios de los extremos             | `longitud`                      |
| `duracionMinutos` | entero de 5 a 480                                                  | `rango`                         |
|                   | múltiplo de 5                                                      | `multiplo_de_5`                 |
| `precio`          | obligatorio: vacío o solo espacios                                 | `falta` (error, solo en la carga) |
| `precio`          | texto `^[0-9]{1,5}(\.[0-9]{1,2})?$` (0 a 99 999,99)                | `formato`                       |
| `descripcion`     | opcional, hasta 300 caracteres                                     | `longitud`                      |
| `nombre`          | distinto (sin mayúsculas) de las otras filas de la carga           | `repetido_en_carga` (error)     |
| `nombre`          | distinto de los servicios de la barbería, activos o no             | `ya_existe` (error)             |

**Fila de barbero**

| Campo         | Regla                                                              | Problema                              |
| ------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `nombre`      | 2 a 80 caracteres (la misma de `Barbero`)                          | `longitud` (error)                    |
| `servicioIds` | 0 o más ids, sin repetir, de servicios de la barbería              | `no_existe` (error)                   |
|               | todos activos                                                      | `inactivo` (error)                    |
| `nombre`      | distinto de las otras filas y de los barberos existentes           | `repetido_en_carga`, `ya_existe` (**advertencia**) |

**Carga**: 1 a 50 filas (`MAX_FILAS_LOTE`); el tipo lo da la ruta.

## 3. Resultado

- **Revisión**: `{ filas: n, errores: ProblemaDeFila[], advertencias: ProblemaDeFila[], cupo? }` con
  `ProblemaDeFila = { fila (1..n), campo, problema }`. En barberos, `cupo = { maximo, activos, disponibles }`, y si
  `n > disponibles` hay un error de carga (`fila: null`, `campo: 'filas'`, `problema: 'supera_cupo'`).
- **Guardado correcto**: `{ tipo, creados: n, ids: [...] }` (201; 200 en un reintento con la misma clave).
- **Guardado rechazado**: nada creado; error `CARGA_INVALIDA` (400) con los `ProblemaDeFila` de los errores, o los
  errores existentes `SUSCRIPCION_NO_PERMITE` (403, catálogo de solo lectura o cupo de barberos superado, con
  `LIMITE_BARBEROS`), `NOMBRE_DUPLICADO` (409, carrera con otra carga), `IDEMPOTENCIA_CONFLICTO` (422, como en `POST /citas`),
  `ACCESO_DENEGADO` (403).

## 4. Cambios en el dominio (sin cambiar las reglas)

- `domain/servicio.ts`: `problemasDeServicio(datos): { campo, problema }[]` (todas las reglas de campo).
  `Servicio.crear` y `editar` lanzan `DatoInvalido` con el **primero** de esa lista (mismo resultado que hoy).
- `domain/barbero.ts`: `problemasDeBarbero({ nombre })`; `Barbero.crear` y `renombrar` la usan igual.
- `domain/limite-barberos.ts`: `puedeAgregar(activos, maximo, nuevos = 1)` → `activos + nuevos <= maximo`;
  `exigir(activos, maximo, nuevos = 1)`. Con `nuevos = 1` es idéntico a hoy (`activos < maximo`).
- `domain/carga-lote.ts` (nuevo, puro): `MAX_FILAS_LOTE`, `revisarServicios(filas, nombresExistentes)` y
  `revisarBarberos(filas, nombresExistentes, serviciosActivos, cupo)` que arman errores y advertencias por fila usando
  las funciones anteriores; `huellaDeFilas(filas)` la calcula la infraestructura (hash).
- `domain/errores.ts`: `CargaInvalida` (`CARGA_INVALIDA`, detalles = errores por fila).

## 5. Sin transiciones de estado

Lo creado nace **activo** (servicios y barberos) y los barberos **sin usuario vinculado**. Editar, desactivar o vincular
sigue por las pantallas y rutas actuales.
