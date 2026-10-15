# Investigación (Fase 0): Registro de barbería, acceso con roles y aislamiento

**Funcionalidad**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Fecha**: 2026-10-15

Cada decisión sigue el formato Decisión / Justificación / Alternativas. Las fijadas por el usuario
o por la constitución se marcan como **dadas**; el resto se decide aquí. Las versiones exactas de
paquetes se fijan en `package.json` al iniciar la implementación (constitución, "Stack propuesto").

---

## R01. Plataforma y lenguajes (dada)

- **Decisión**: Node.js 22 LTS y TypeScript 5 (modo `strict`). Backend NestJS 11 en
  `tecnologia/plataforma-barberias/backend/`; frontend React 19 + Vite 6 en
  `tecnologia/plataforma-barberias/frontend/`.
- **Justificación**: indicado por el usuario; coincide con la constitución y ADR-014. Node 22 es
  LTS vigente durante el proyecto.
- **Alternativas**: Angular (descartado en ADR-014).

## R02. Acceso a datos compatible con RLS

- **Decisión**: Kysely (constructor de consultas tipado) sobre el driver `pg`, con migraciones
  versionadas del propio Kysely escritas en SQL explícito (políticas RLS, roles, funciones).
- **Justificación**: RLS exige ejecutar `SELECT set_config('app.tenant_id', $1, true)` dentro de
  la **misma transacción** que las consultas (multi-tenancy-y-datos.md §2). Kysely da control
  directo de la transacción y de la conexión, no genera entidades acopladas al dominio
  (principio II) y permite SQL tipado. Las migraciones en SQL dejan visibles las políticas.
- **Alternativas**:
  - *Prisma*: RLS exige transacciones interactivas y extensiones de cliente; el esquema propio
    complica `EXCLUDE USING gist` (necesario en M02) y las funciones `SECURITY DEFINER`.
  - *TypeORM*: decoradores de entidad tientan a usar el ORM como dominio; manejo de transacción
    por solicitud menos explícito.
  - *`pg` puro*: sin tipos de consulta; más errores en tiempo de ejecución.

## R03. Contexto de tenant y transacción por caso de uso (M06)

- **Decisión**: M06 expone el puerto `UnitOfWork` con `ejecutar(tenantId, fn)` y un
  `TenantContext` basado en `AsyncLocalStorage`. La implementación abre una transacción Kysely,
  ejecuta `set_config('app.tenant_id', tenantId, true)` y deja la transacción disponible para los
  repositorios de cualquier módulo que participe (M01 y M03 en el registro). El `tenantId` sale
  solo del token verificado (guard de autenticación en `host/`) o, en el registro, del tenant
  recién creado por el propio caso de uso.
- **Justificación**: `set_config(..., true)` limita el valor a la transacción, así no se filtra
  entre solicitudes del pool. Una sola transacción compartida cumple FR-002 (registro indivisible)
  aunque intervengan M01 y M03, sin que M01 toque tablas de M03.
- **Alternativas**:
  - *`SET app.tenant_id` a nivel de sesión*: se filtra entre solicitudes con pool.
  - *Transacción abierta por interceptor HTTP para toda solicitud*: oculta el límite
    transaccional y obliga a transacciones en rutas públicas que no las necesitan.

## R04. Roles de PostgreSQL y RLS

- **Decisión**: dos roles. `barberias_owner` es dueño de tablas y ejecuta migraciones.
  `barberias_app` (usado por la aplicación) es `NOSUPERUSER NOBYPASSRLS`, no es dueño de ninguna
  tabla, y recibe solo los `GRANT` necesarios. Toda tabla con `tenant_id` tiene
  `ENABLE` + `FORCE ROW LEVEL SECURITY` y la política `tenant_isolation` con `USING` y
  `WITH CHECK` sobre `current_setting('app.tenant_id', true)::uuid`. Sin contexto, la política
  no devuelve filas.
- **Justificación**: principio III y control 5 de multi-tenancy-y-datos.md. `FORCE` evita que el
  dueño se salte RLS por descuido en scripts.
- **Alternativas**: un solo rol dueño con RLS (puede omitir RLS: prohibido por la constitución).

## R05. Búsquedas previas a conocer el tenant (inicio de sesión, renovación, activación)

- **Decisión**: tres funciones `SECURITY DEFINER` propiedad de `barberias_owner`, con
  `search_path` fijo, sobre las que `barberias_app` solo tiene `EXECUTE`:
  - `auth_resolver_membresia(user_id)` → `tenant_id`, `role_code`, estado de membresía y estado
    del tenant del único miembro activo del personal.
  - `auth_buscar_sesion(token_hash)` → `session_id`, `tenant_id`, `user_id`, estado y vencimiento.
  - `auth_buscar_activacion(token_hash)` → `activation_id`, `tenant_id`, `user_id`, vencimiento,
    uso.
  Cada función devuelve como máximo una fila buscada por clave exacta (nunca listas) y no acepta
  `tenant_id` como parámetro. Con el `tenant_id` obtenido, el resto del flujo corre en una
  transacción con RLS normal.
- **Justificación**: al iniciar sesión el tenant aún no se conoce, y `membership`,
  `auth_session` y `account_activation` están bajo RLS. Es el mismo patrón de "acceso de sistema
  restringido" que multi-tenancy-y-datos.md ya prevé para el webhook de pagos. La superficie es
  mínima, se audita y se prueba en PR09.
- **Alternativas**:
  - *Hacer globales esas tablas*: viola el principio III (datos de negocio sin RLS).
  - *Un rol de sistema con `BYPASSRLS` para el login*: superficie mayor que tres funciones
    puntuales.
  - *Poner el tenant en la cookie o en el formulario de login*: el tenant vendría del cliente
    (prohibido).
- **Seguimiento documental**: añadir este caso a "Casos especiales" de
  `docs/02-arquitectura-software/multi-tenancy-y-datos.md` en el mismo cambio que lo implemente
  (principio XI). Es una aplicación de ADR-003/ADR-010, no un ADR nuevo.

## R06. Hash de contraseñas (dada: Argon2id o bcrypt)

- **Decisión**: Argon2id con el paquete `argon2`, parámetros iniciales m = 19 MiB, t = 2, p = 1
  (mínimo recomendado por OWASP), configurables por entorno; se guarda la cadena PHC completa
  (incluye sal y parámetros) para poder subirlos sin migrar. Si el correo no existe se verifica
  contra un hash ficticio para igualar tiempos (FR-009).
- **Justificación**: Argon2id es resistente a GPU y es la primera opción de OWASP; bcrypt trunca
  a 72 bytes.
- **Alternativas**: bcrypt costo 12 (válido, queda como respaldo si `argon2` diera problemas de
  compilación nativa en la imagen Docker).
- **Puerto**: `PasswordHasher` en `identidad/application`; adaptador en `infrastructure`.

## R07. Token de acceso (dada: JWT corto con usuario, rol y tenant)

- **Decisión**: JWT firmado con ES256, vida de 15 min, encabezado `kid` para rotar claves.
  Reclamaciones: `sub` (usuario), `tid` (tenant), `rol`, `sid` (sesión), `jti`, `iat`, `exp`,
  `iss`, `aud`. Claves privada y públicas desde variables de entorno o gestor de secretos; el
  verificador acepta varias públicas a la vez durante la rotación. Algoritmo fijado en la
  verificación (se rechaza `none` y HS*). Librería `jose`, envuelta en el puerto `TokenSigner`.
- **Justificación**: ADR-010 (vida corta + refresco, rotación de claves); asimétrico permite
  rotar sin compartir el secreto de firma; `jose` es mantenida y sin dependencias.
- **Alternativas**: HS256 con secreto compartido (rotación más incómoda); `@nestjs/jwt`
  (válido, pero `jose` maneja mejor varias claves con `kid`).

## R08. Renovación y cierre de sesión

- **Decisión**: al iniciar sesión se crea una fila `auth_session` (bajo RLS) y un token de
  renovación opaco de 256 bits; solo se guarda su SHA-256. Se entrega en cookie `HttpOnly`,
  `Secure`, `SameSite=Strict`, `Path=/api/v1/auth`. Cada renovación **rota** el token; si llega
  uno ya rotado (reutilización), se revoca la sesión completa. Vida de la sesión: 7 días
  deslizantes con tope absoluto de 30 días. Cerrar sesión marca la sesión como `REVOCADA` y borra
  la cookie.
- **Justificación**: FR-008 y FR-011. Un token en cookie `HttpOnly` no lo lee JavaScript (mitiga
  XSS); `SameSite=Strict` + ruta limitada mitiga CSRF sobre la renovación.
- **Alternativas**: token de renovación en `localStorage` (expuesto a XSS); JWT de renovación
  sin estado (no se puede revocar).

## R09. Invalidación inmediata (cierre de sesión, desactivación, suspensión)

- **Decisión**: el guard de autenticación, además de verificar la firma, comprueba en cada
  solicitud protegida, con una consulta por clave dentro del contexto del tenant del token, que
  la sesión `sid` siga `ACTIVA`, que la membresía siga activa con el mismo rol del token y que el
  tenant esté `ACTIVA`. Si algo cambió, responde 401 y el frontend intenta renovar (lo que fallará
  si el usuario está desactivado o el tenant suspendido).
- **Justificación**: SC-004 exige rechazar el 100 % de los usos tras el cierre de sesión; con
  solo la vida corta quedaría una ventana de hasta 15 min. Una consulta por clave primaria es
  barata y mantiene el backend sin estado entre instancias (el estado está en PostgreSQL).
- **Alternativas**: lista de bloqueo en Redis (Redis no puede ser fuente de verdad de usuarios,
  principio VIII); aceptar la ventana de 15 min (incumple SC-004).

## R10. Límite de intentos de inicio de sesión (EQ-12)

- **Decisión**: contador en PostgreSQL, tabla global `login_attempt` con
  (`email_hash`, `ip`, `intentado_en`). Se rechaza con 429 desde el sexto fallo en 60 s para el par
  cuenta + IP, con espera creciente (`Retry-After` duplica: 30 s, 60 s, 120 s… hasta 15 min). Un
  acierto borra los fallos del par. Limpieza de filas de más de 24 h. Para el resto de la API,
  `@nestjs/throttler` en memoria por instancia como freno general aproximado.
- **Justificación**: el conteo debe ser correcto con varias instancias (ADR-006); Redis solo puede
  usarse como caché (principio VIII) y este feature no necesita Redis. Bloquear por par cuenta + IP
  evita que un atacante bloquee la cuenta de otro desde su IP (SC-006).
- **Alternativas**: throttler con almacenamiento Redis (contador como fuente de verdad en Redis:
  contradice VIII); solo memoria (cada instancia contaría por separado).

## R11. Validación de entradas y rechazo de `tenant_id` del cliente

- **Decisión**: `ValidationPipe` global con `whitelist: true` y `forbidNonWhitelisted: true`
  (`class-validator`); cualquier campo no declarado, incluido `tenant_id`/`tenantId`/`barberiaId`,
  da 400 `VALIDACION`. Un interceptor rechaza el encabezado `X-Tenant-Id` si llega. Ninguna ruta
  de esta funcionalidad recibe tenant en la ruta. Límites de longitud en todos los campos, cuerpo
  máximo 16 KB, consultas siempre parametrizadas (Kysely).
- **Justificación**: FR-023, FR-028, EQ-10. Rechazar (en vez de ignorar) hace visible el intento y
  se audita.
- **Alternativas**: `zod` en el backend (válido; se prefiere lo estándar de Nest para el equipo).

## R12. Registro indivisible con M03

- **Decisión**: el caso de uso `RegistrarBarberia` (M01/barberias) abre `UnitOfWork` y, en una
  transacción: crea `tenant` (con `slug` único derivado del nombre), fija el contexto con el nuevo
  `tenant_id`, crea `user_account`, `membership` (PROPIETARIO, ACTIVA), `terms_acceptance`, llama a
  `SuscripcionesApi.iniciarPruebaGratuita(tenantId)` (interfaz pública de M03) y escribe la
  auditoría (M06). Si algo falla, todo se revierte. Luego emite la sesión del propietario
  (entra directo a su espacio, SC-001).
- **Justificación**: FR-002; la matriz permite M01 → M03 y el diagrama C4 ya muestra "Inicia
  prueba". Es una llamada síncrona con efecto requerido, no un efecto secundario, por eso no va por
  evento.
- **Alternativas**: evento `BarberiaRegistrada` escuchado por M03 tras confirmar (el registro
  podría quedar sin prueba si el oyente falla: incumple FR-002 y SC-002).

## R13. Duración y límites de la prueba gratuita

- **Decisión**: M03 siembra el plan `TRIAL` con `trial_days = 14` y `max_users = 5` (incluye al
  propietario), ambos datos del plan y editables por la plataforma sin cambiar código. M03 expone
  `obtenerLimiteUsuarios(tenantId)` para FR-020.
- **Justificación**: supuestos de la especificación; valores "por validar" con el modelo
  comercial.
- **Alternativas**: variable de entorno (no permitiría distintos planes).

## R14. Alta de usuarios del personal y activación

- **Decisión**: el propietario crea el usuario en estado `PENDIENTE`; se genera un token de
  activación de un solo uso (256 bits, se guarda su SHA-256, vence a las 72 h). Mientras M05 no
  exista, la respuesta devuelve el **enlace** de activación para que el propietario lo entregue; la
  pantalla lo muestra con botón de copiar. El usuario fija su contraseña en `/activar`; el token
  queda usado. El propietario puede regenerar el enlace (invalida el anterior).
- **Justificación**: FR-022 y supuesto de la especificación; el propietario nunca conoce la
  contraseña. Cuando exista M05, se enviará por correo escuchando `UsuarioCreado` sin cambiar M01.
- **Alternativas**: contraseña temporal elegida por el propietario (la conoce un tercero).

## R15. Un solo miembro del personal por cuenta y unicidad del correo

- **Decisión**: `user_account.email` único global (guardado normalizado: `trim` + minúsculas,
  restricción `UNIQUE` sobre la columna normalizada). Índice único parcial en
  `membership (user_id)` para roles de personal (PROPIETARIO, BARBERO). Correo
  repetido → 409 `CORREO_NO_DISPONIBLE` sin mencionar barbería.
- **Justificación**: FR-006, FR-029 y supuesto "una barbería por usuario". El modelo
  `user_account` + `membership` queda listo para la evolución futura (quitar el índice parcial).
- **Alternativas**: `citext` (válido; se prefiere normalizar en el dominio y probarlo sin base).

## R16. Política de contraseñas

- **Decisión**: 10 a 128 caracteres, sin reglas de composición, rechazo de una lista corta de
  contraseñas comunes y de la que contenga el correo. Validación en el dominio
  (`Contrasena`), repetida en el frontend solo como ayuda.
- **Justificación**: guía NIST SP 800-63B (longitud sobre composición); usable en celular.
- **Alternativas**: reglas de mayúscula/número/símbolo (peor usabilidad sin ganancia real).

## R17. Auditoría (M06)

- **Decisión**: M06 expone `AuditLog.registrar({accion, actorId, recurso, resultado, origen})`;
  toma el tenant del contexto. Tabla `audit_log` con RLS y `GRANT INSERT, SELECT` solamente para
  `barberias_app` (sin `UPDATE`/`DELETE`: inmutable para la aplicación, EQ-13). Las denegaciones
  por rol y los intentos de tenant ajeno se registran fuera de la transacción del caso de uso
  (que se revierte) con su propia transacción corta.
- **Justificación**: FR-027, EQ-13.
- **Alternativas**: registros de aplicación en archivo (no consultables ni inmutables).

## R18. Pruebas (dada: obligatorias, incluida la de aislamiento)

- **Decisión**:
  - Backend: Jest + `supertest`. Dominio: unitarias sin infraestructura. Integración y contrato
    HTTP: PostgreSQL 16 real con Testcontainers, aplicando las migraciones y conectando con
    `barberias_app` (para que RLS actúe de verdad).
  - **PR09 aislamiento**: (a) suite parametrizada que recorre cada endpoint protegido de la
    funcionalidad con el token de la barbería A sobre recursos de B (ids, cuerpo, encabezado) y
    espera 404/400 y datos de B intactos; (b) prueba directa en base: con `barberias_app`, una
    consulta sin `set_config` devuelve 0 filas en cada tabla con RLS, y con el contexto de A no
    aparece ninguna fila de B; (c) cada función `SECURITY DEFINER` devuelve como máximo una fila.
  - PR07 autenticación, PR08 matriz RBAC parametrizada, PR10 entradas inválidas, PR12 límite de
    intentos, PR13 auditoría.
  - **PR14 arquitectura**: `dependency-cruiser` con reglas para la matriz de módulos (solo
    `index.ts` entre módulos) y la regla de capas (`domain` no importa `@nestjs/*`, `kysely`, `pg`,
    `argon2`, `jose` ni otras capas externas).
  - Frontend: Vitest + Testing Library para formularios y manejo de sesión; MSW para simular la
    API.
- **Justificación**: principio X. RLS solo se prueba con PostgreSQL real; un mock no lo
  demostraría.
- **Alternativas**: Vitest en backend (Jest es el predeterminado de Nest); pg-mem (no implementa
  RLS).

## R19. Frontend

- **Decisión**: React Router (rutas `/registro`, `/ingresar`, `/activar`, `/app/usuarios`),
  TanStack Query para llamadas, `react-hook-form` + `zod` para formularios, tipos de la API
  generados desde [contracts/openapi.yaml](contracts/openapi.yaml) con `openapi-typescript`. El
  token de acceso vive solo en memoria; al cargar la app se intenta `POST /auth/refresh` con la
  cookie. CSS Modules con diseño móvil primero; sin librería de componentes pesada (RC15).
- **Justificación**: ADR-014 (tipos compartidos con la API), principio IX (liviana, responsive).
- **Alternativas**: Redux (innecesario para este estado), librería de UI completa (peso).

## R20. Entorno local

- **Decisión**: `tecnologia/plataforma-barberias/docker-compose.yml` con `postgres:16`
  (script de inicio que crea `barberias_owner` y `barberias_app`), `backend` (Nest en modo watch)
  y `frontend` (Vite). Secretos en `.env` local no versionado, con `.env.example` versionado.
  Redis **no** se levanta en esta funcionalidad porque no hay lecturas que cachear.
- **Justificación**: dado por el usuario; principio VIII no obliga a usar Redis donde no aporta.
- **Alternativas**: base local instalada a mano (difícil de reproducir).

## R21. Formato de errores

- **Decisión**: el formato único de api-rest.md `{ codigo, mensaje, detalles }`, aplicado por un
  filtro global de excepciones que traduce errores de dominio a HTTP y nunca expone trazas.
- **Justificación**: api-rest.md §1; EQ-07 (sin detalles en 401).
