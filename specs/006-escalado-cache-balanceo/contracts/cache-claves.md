# Contrato interno: claves de caché e invalidación

**Funcionalidad**: [spec.md](../spec.md) · **Decisiones**: [research.md](../research.md) R05, R07, R08, R09 y R10

Contrato entre M06 (adaptador de caché) y los módulos que lo usan. Lo verifican las pruebas
`claves-cache` (unitaria), `cache-catalogo` y `aislamiento-cache` (PR09).

## 1. Reglas obligatorias

1. **Única fábrica.** Las claves de datos de una barbería se crean solo con `ClavesCache`
   (`shared/cache/claves-cache.ts`). `CacheCompartida.obtener`, `guardarSiGeneracion` e `invalidar`
   aceptan una `ClaveCache`, nunca un `string`.
2. **Tenant obligatorio.** Cada método de `ClavesCache` para datos de barbería recibe un `TenantId`
   como primer argumento, y el identificador aparece en la clave como `t:{uuid}`. No existe un
   método sin `TenantId`.
3. **Sin claves por enlace.** No hay claves derivadas del `slug` (principio III; R07).
4. **Solo columnas públicas.** Los valores contienen solo columnas de la lista de ADR-021 y nunca
   datos personales (FR-013).
5. **Prefijo versionado.** Todas las claves empiezan por `bp:v1:` (datos) o `rl:v1:` (contadores).
   Cambiar el formato obliga a subir la versión.
6. **Contadores sin tenant.** `ClaveContador` solo se crea en `AlmacenLimitesCompartido`, a partir
   de la clave por IP de `@nestjs/throttler`. Si en el futuro hay límites por barbería o por
   usuario, su clave debe incluir `t:{tenantId}` (principio VIII).
   - **Interpretación de la constitución:** el principio III exige el tenant en "toda clave de
     caché". Los contadores del límite general no son caché de datos de una barbería: son contadores
     no críticos por IP, regulados por el principio VIII, más específico. Este exige el tenant solo
     cuando el límite es por barbería o por usuario. Así lo registra ADR-029.
7. **Invalidar después de confirmar.** Siempre con `UnitOfWork.alConfirmar`, nunca dentro de la
   transacción.

## 2. Catálogo de claves

| Fábrica                                                               | Clave                                                             | TTL                              | Escribe                                               | Lee                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `ClavesCache.catalogoPublico(t)`                                      | `bp:v1:t:{t}:catalogo-publico`                                    | 120 s (configurable, máximo 300) | `ObtenerCatalogoPublico` (M02), guardado condicionado | `GET /publico/{slug}` y `GET /publico/{slug}/horarios` |
| `ClavesCache.generacionCatalogo(t)`                                   | `bp:v1:t:{t}:catalogo-publico:gen`                                | 24 h                             | `InvalidadorCatalogoPublico` (`INCR`)                 | `ObtenerCatalogoPublico`                               |
| `ClavesCache.horarios(t, servicio, fecha, barbero?, gen)` _(FR-013b)_ | `bp:v1:t:{t}:horarios:g{gen}:{servicio}:{fecha}:{barbero\|todos}` | 30 s                             | Horarios públicos                                     | Horarios públicos                                      |
| `ClavesCache.generacionHorarios(t)` _(FR-013b)_                       | `bp:v1:t:{t}:horarios:gen`                                        | 24 h                             | `InvalidadorHorarios` (`INCR`)                        | Horarios públicos                                      |
| _(solo `AlmacenLimitesCompartido`)_                                   | `rl:v1:{hash}`                                                    | Ventana del límite               | Guard de límites                                      | Guard de límites                                       |

## 3. Matriz de invalidación

✓ = invalida después de confirmar. — = no invalida (el dato no está en esa entrada).

| Caso de uso (módulo)                     | Cambio                                                                       | Catálogo                                                  | Horarios _(FR-013b)_ |
| ---------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------- |
| `CrearServicio` (M02)                    | Servicio nuevo                                                               | ✓                                                         | ✓                    |
| `ActualizarServicio` (M02)               | Nombre, descripción, precio, duración, activar o desactivar                  | ✓                                                         | ✓                    |
| `CrearBarbero` (M02)                     | Barbero nuevo                                                                | ✓                                                         | ✓                    |
| `ActualizarBarbero` (M02)                | Nombre visible, activar o desactivar, servicios asignados, usuario vinculado | ✓                                                         | ✓                    |
| `ReemplazarHorarioAtencion` (M02)        | Horario de atención                                                          | ✓                                                         | ✓                    |
| `ReemplazarDisponibilidad` (M02)         | Disponibilidad semanal de un barbero                                         | —                                                         | ✓                    |
| `CrearBloqueo`, `EliminarBloqueo` (M02)  | Bloqueo                                                                      | —                                                         | ✓                    |
| `ReservarCita` (M02, también presencial) | Cita nueva                                                                   | —                                                         | ✓                    |
| `CancelarCita` (M02)                     | Cancelación                                                                  | —                                                         | ✓                    |
| `CambiarEstadoCita` (M02)                | Cambio de estado                                                             | —                                                         | ✓                    |
| `ActualizarBarberia` (M01)               | Nombre, enlace, dirección, teléfono, descripción, antelación                 | — (se lee en cada solicitud)                              | —                    |
| Suspensión de la barbería (003, futuro)  | Estado de la barbería                                                        | — (la resolución del enlace la rechaza en cada solicitud) | —                    |

- **Usuario vinculado:** `ActualizarBarbero` invalida aunque solo cambie el usuario vinculado,
  porque el caso de uso no distingue los campos. Invalidar de más es seguro.
- **Prueba de la matriz:** `cache-catalogo` recorre la columna "Catálogo" fila por fila. Si se
  activa FR-013b, otra prueba recorre la columna "Horarios".

## 4. Operaciones atómicas (scripts Lua)

| Operación                                               | Efecto                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `guardarSiGeneracion(clave, gen, esperada, valor, ttl)` | `if (GET gen or 0) == esperada then SET clave valor EX ttl end`; devuelve si guardó  |
| `invalidar(clave, gen)`                                 | `MULTI; INCR gen; EXPIRE gen 86400; DEL clave; EXEC`                                 |
| `contar(clave, ventanaMs)`                              | `n = INCR clave; if n == 1 then PEXPIRE clave ventanaMs end; return {n, PTTL clave}` |

## 5. Comportamiento ante fallos

| Situación                               | Resultado                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Redis no responde en `CACHE_TIMEOUT_MS` | La operación cuenta como fallo: lectura → ausente; guardado e invalidación → se omiten; contar → `null` (respaldo en memoria) |
| 5 fallos seguidos                       | Interruptor abierto 10 s; una línea `CACHE_NO_DISPONIBLE`                                                                     |
| Valor ilegible o con otra versión       | Ausente; se vuelve a leer de PostgreSQL y se reemplaza                                                                        |
| Sin `REDIS_URL`                         | `CacheInactiva`: todo ausente, límite en memoria, sin registros de alerta                                                     |
