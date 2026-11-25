# Research: Carga masiva de servicios y barberos (011)

Fecha: 2026-11-25. Fuente: [spec.md](spec.md) aclarada (sin límite de servicios; nombre de barbero repetido = advertencia;
solo el propietario; barbero = nombre y servicios). Revisado el código actual de M02 (`catalogo-citas/catalogo`), M03
(`SuscripcionesApi.obtenerLimiteBarberos`, `exigirOperacion`) y M06 (`UnitOfWork`, `AuditLog`).

## R01 · Dos rutas nuevas por recurso: revisar y guardar

- **Decision**: `POST /servicios/lote/revision` y `POST /barberos/lote/revision` (revisan sin guardar) y
  `POST /servicios/lote` y `POST /barberos/lote` (guardan todo o nada). Mismo cuerpo `{ filas: [...] }` (1 a 50).
- **Rationale**: la vista previa necesita la comprobación de "ya existe", que solo conoce el servidor, y la spec pide no
  duplicar reglas. Una revisión en el servidor da la vista previa con las reglas reales; el guardado repite la revisión
  dentro de la transacción y tiene la última palabra.
- **Alternatives considered**: validar en el navegador (duplica las reglas de `Servicio` y `Barbero`, que pueden quedar
  distintas); una sola ruta con `?soloRevisar=true` (mezcla un efecto con una consulta y complica permisos y auditoría).

## R02 · Las reglas de cada fila salen del dominio actual, sin copiarlas

- **Decision**: extraer de `domain/servicio.ts` y `domain/barbero.ts` una función pura por entidad que devuelve **todos**
  los problemas de unos datos (`problemasDeServicio(datos)`, `problemasDeBarbero(datos)`: lista de `{ campo, problema }`),
  y hacer que `Servicio.crear`, `Servicio.editar`, `Barbero.crear` y `renombrar` lancen `DatoInvalido` con el primero de
  esa misma lista. La carga en lote usa la función para juntar los errores de cada fila.
- **Rationale**: una sola fuente para las reglas (nombre 2–80, duración 5–480 múltiplo de 5, precio, descripción ≤ 300);
  la creación individual sigue respondiendo igual (mismo primer error). Una prueba compara ambos caminos con los mismos
  casos (SC-005).
- **Precio vacío**: la revisión en lote distingue el precio vacío (precio: falta, "Falta el precio") del precio mal escrito
  (precio: formato). Lo hace carga-lote.ts antes de llamar a problemasDeServicio, sin cambiar la regla de Servicio:
  en la creación individual, el formulario ya exige el precio y un vacío sigue siendo ormato.
- **Alternatives considered**: llamar a `Servicio.crear` por fila con `try/catch` (solo da el primer error de cada fila:
  la vista previa mostraría un error por vez); una librería de esquemas compartida con el frontend (dependencia nueva y
  otra copia de las reglas).

## R03 · Nombres: servicio repetido es error; barbero repetido es advertencia

- **Decision**: en servicios, error `nombre: repetido_en_carga` o `nombre: ya_existe` (comparación con `lower(trim)`,
  como el índice único `service_nombre_unico (tenant_id, lower(name))`, que incluye los inactivos). En barberos, solo
  **advertencias** `nombre: repetido_en_carga` / `nombre: ya_existe` en la revisión; el guardado no las comprueba.
- **Rationale**: Q2 = A; la creación individual de barberos permite nombres repetidos y no cambia. El índice único sigue
  siendo la garantía final de servicios: si otra carga gana la carrera entre revisar y guardar, la transacción se revierte
  entera y responde `NOMBRE_DUPLICADO`; la interfaz vuelve a revisar y marca la fila (US1, escenario 5).
- **Alternatives considered**: bloquear la tabla de servicios para comprobar nombres (innecesario: el índice ya lo garantiza).

## R04 · Todo o nada en una transacción, con el cupo del plan para el lote entero

- **Decision**: un solo `UnitOfWork.ejecutar(tenant)` por carga: `exigirOperacion(tenant, 'CONFIGURAR_CATALOGO')` →
  revisión completa → (barberos) `obtenerLimiteBarberos(tenant)`, que deja **bloqueada la fila de la suscripción** hasta
  el final, y `LimiteBarberos.exigir(activos, maximo, nuevos)` → inserción de todas las filas → auditoría → invalidación
  del catálogo público. Cualquier error revierte todo.
- **Rationale**: es el mismo bloqueo que usa `CrearBarbero` (R13 de 002), así que una carga y una creación individual, o
  dos cargas, se ordenan sobre la misma fila y nunca superan el máximo (US3, SC-003). `LimiteBarberos` gana un parámetro
  `nuevos` con valor 1 por defecto: la regla individual no cambia.
- **Alternatives considered**: crear fila por fila llamando a `CrearBarbero` (N transacciones: no es todo o nada);
  bloqueo propio de la carga (dos bloqueos distintos no se excluyen entre sí).

## R05 · Sin límite de servicios

- **Decision**: no se toca M03 ni la tabla `plan`; la carga de servicios solo tiene el tope de 50 filas (Q1 = A).

## R06 · Reintentos sin duplicar: Idempotency-Key y una tabla de cargas

- **Decision**: el guardado exige la cabecera `Idempotency-Key` (UUID, como `POST /citas`). Se guarda una fila en una
  tabla nueva `catalog_batch` (tenant, autor, clave, tipo, cantidad creada, fecha) con índice único
  `(tenant_id, author_user_id, idempotency_key)`, en la misma transacción. Un reintento con la misma clave y el mismo
  tipo devuelve el resumen guardado (200) sin crear nada; con otro tipo o con otras filas responde
  `IDEMPOTENCIA_CONFLICTO` (422, como en `POST /citas`). Si dos reintentos llegan a la vez, el índice único hace perder al segundo, que en una
  transacción nueva devuelve el resumen del primero (patrón R09 de 002).
- **Rationale**: los servicios no se duplicarían (índice de nombres) pero el reintento respondería un error confuso; los
  barberos sí se duplicarían (nombres repetidos permitidos). FR-014.
- **Alternatives considered**: guardar la clave en la auditoría (la auditoría no es para leer reglas de negocio); en
  Redis (principio VIII: no puede ser la fuente de verdad); sin idempotencia (falla FR-014).
- **Huella de las filas**: se guarda un SHA-256 de las filas normalizadas para distinguir "mismo envío" de "otra carga con
  la misma clave". No contiene datos de personas (nombres de servicios o barberos, que ya son públicos).

## R07 · Auditoría

- **Decision**: dos acciones nuevas en `AccionAuditada`: `SERVICIOS_CARGADOS_EN_LOTE` y `BARBEROS_CARGADOS_EN_LOTE`,
  recurso `lote:<id>;cantidad=<n>`, resultado `PERMITIDO`, en la transacción de la carga (si se revierte, no queda). Las
  denegaciones por rol ya las registra `AutorizacionCatalogoCitas` (`ACCESO_DENEGADO_ROL`). Una carga rechazada por reglas
  o por cupo no se audita (no es un evento de seguridad; igual que la creación individual).

## R08 · Tope de 50 filas

- **Decision**: constante de dominio `MAX_FILAS_LOTE = 50` usada por el caso de uso; el DTO también limita el arreglo
  (`ArrayMinSize(1)`, `ArrayMaxSize(50)`) para cortar cuerpos grandes antes de abrir la transacción. El límite general de
  tamaño de cuerpo del host no cambia.

## R09 · Barberos: servicios elegidos entre los activos

- **Decision**: cada fila de barbero lleva `servicioIds` (puede ser vacío). La revisión y el guardado comprueban que
  existan y estén **activos** en la barbería (`servicioIds: no_existe` o `servicioIds: inactivo`). La creación individual
  hoy solo exige que existan; la carga es más estricta porque la interfaz solo ofrece los activos.
- **Nota**: esta comprobación extra solo vive en la carga; si se quiere igual en la creación individual, es un cambio
  aparte (no pedido).

## R10 · Interfaz

- **Decision**: dos pantallas nuevas del panel, `/app/servicios/agregar-varios` y `/app/barberos/agregar-varios`, con un
  botón "Agregar varios" en Servicios y en Barberos. A 360 px cada fila es una ficha con campos con etiqueta; desde 48rem,
  una tabla. El pegado lo ordena una función pura del frontend (`pegado-de-hoja.ts`: tabulaciones, comillas de Excel,
  encabezado, coma decimal, "S/", "30 min", tope de 50 con aviso). "Agregar servicios típicos" usa una lista fija del
  frontend. Errores con `aria-describedby` en cada campo y un resumen con enlaces a la primera fila con error; foco al
  resumen tras revisar y al mensaje final tras guardar.
- **Servicios típicos (nombre y duración sugerida, sin precio)**: Corte (30 min), Barba (20 min), Corte y barba (50 min),
  Cejas (10 min), Corte para niños (30 min), Lavado (10 min). El **precio queda vacío**: la aplicación no propone precios
  (ajuste del usuario del 2026-11-25). Al revisar, cada fila sin precio queda marcada con "Falta el precio" y no se puede
  guardar hasta escribirlo. Las duraciones son sugerencias editables.

## R11 · Pruebas

- **Decision**: unitarias del dominio (problemas por campo, `LimiteBarberos` con `nuevos`, la comparación de ambos
  caminos), integración con Testcontainers (todo o nada, cupo, nombres, idempotencia, suscripción vencida, permisos,
  aislamiento con dos barberías, auditoría), concurrencia (dos cargas simultáneas × 50, como PR16), contrato de las 4
  rutas, arquitectura (dependency-cruiser sin reglas nuevas) y frontend (Vitest + Testing Library: pegado, típicos,
  errores, advertencias, guardado, teclado) más capturas con axe a 360 y 1440, claro y oscuro.

## Riesgos

1. **Cambiar el dominio de `Servicio`/`Barbero`** podría alterar el error de la creación individual. Mitigación: el
   primer problema de la lista es el mismo que hoy; las pruebas actuales de servicios y barberos deben seguir verdes.
2. **Carrera de nombres de servicio** entre revisar y guardar: la cubre el índice único (todo se revierte).
3. **Bloqueo de la suscripción** durante una carga de 50 barberos: la transacción es corta (una inserción múltiple).
4. **Duraciones sugeridas de los servicios típicos** pueden no ajustarse a cada barbería: son editables. No hay precios sugeridos: el propietario los escribe siempre.
