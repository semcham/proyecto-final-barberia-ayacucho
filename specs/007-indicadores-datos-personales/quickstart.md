# Quickstart: validar 007 (indicadores y datos personales)

Guía de validación de extremo a extremo para **después de implementar**. No contiene código: remite a los
[contratos](contracts/) y al [modelo de datos](data-model.md). Cada paso dice qué se espera ver, y el resultado se
anota en la columna "Resultado" al recorrerla. Cada historia se valida sola: si una se recortó, sus pasos se
marcan "no construido".

## 0. Requisitos

- El entorno de 005 funcionando con Docker Compose (`docker compose up -d` en `tecnologia/plataforma-barberias/`).
- Las migraciones de 007 que se hayan construido, aplicadas por `preparar-backend`.
- **US2 (vistas):** el rol `barberias_conteos` creado. En una base nueva lo crea `db/init/01-roles.sql`; en un
  volumen anterior a 007, se crea a mano una vez como superusuario, igual que los roles de 002 y 003, con el bloque
  SQL del README de la plataforma (incluye `GRANT barberias_conteos TO barberias_owner WITH INHERIT FALSE, SET
  TRUE`). Comprobación, antes de recrear las réplicas:

  ```sql
  SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'barberias_conteos';   -- una fila: f, f
  SELECT r.rolname, m.inherit_option, m.set_option
    FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles r ON r.oid = m.member
   WHERE g.rolname = 'barberias_conteos';                                                      -- solo barberias_owner: f, t
  ```
- **US3:** `INTENTOS_SAL_IP`. **El responsable la añade a mano a su `.env` local** (el agente no lo lee ni lo
  cambia); con Compose, si falta, se usa el valor solo de desarrollo de `docker-compose.yml`. Sin ella, fuera de
  Compose no arrancan ni el backend ni los scripts que construyen `Configuracion` (por ejemplo,
  `npm run plataforma:crear-admin`).
- Dos barberías de prueba, cada una con su propietario, un barbero con usuario y un cliente con cuenta; citas en
  varios meses y en varios estados; y el administrador de la plataforma con su segundo factor.

## 1. Pruebas automáticas

```text
cd tecnologia/plataforma-barberias/backend
npm test                 # unitarias: estados y plazo de la solicitud, días hábiles, derivación del origen
npm run test:int         # integración (solicitudes, aislamiento, rbac-007, lectura-plataforma, límite de intentos)
npm run test:arch        # PR14 con las reglas nuevas de 007
cd ../frontend && npm test
```

Esperado: todo en verde.

## 2. Recorrido con Docker Compose

### US1 · Solicitudes sobre datos personales

| Paso | Acción | Esperado | Resultado |
| ---- | ------ | -------- | --------- |
| 1 | El cliente de A abre "Mis datos" y registra una solicitud de acceso | Queda "recibida", con la fecha y el plazo (10 días hábiles después) | |
| 2 | Registra una de rectificación sin decir qué dato | No se registra: se pide el detalle | |
| 3 | Intenta otra de acceso con la primera abierta | Se le muestra la existente | |
| 4 | El barbero de A registra una de eliminación | Queda "recibida"; él ve solo la suya | |
| 5 | El propietario de A abre la bandeja | Ve las dos, con el titular, el tipo, el plazo y si está vencida; no ve nada de B | |
| 6 | La pasa a "en atención" y luego a "atendida" con una respuesta; rechaza la otra con un motivo | El cliente y el barbero ven el estado y la respuesta o el motivo | |
| 7 | El propietario busca cómo registrar una solicitud sobre su propia cuenta | No existe esa opción (fuera de 007) | |
| 8 | El propietario registra una en nombre de un cliente presencial | Queda marcada "en nombre de" | |
| 9 | Revisar `audit_log` de A | Una fila por paso, con el actor y `solicitud_datos:<id>;<tipo>`, sin ningún texto | |

### US2 · Indicadores de la plataforma

| Paso | Acción | Esperado | Resultado |
| ---- | ------ | -------- | --------- |
| 10 | El administrador abre "Indicadores" | Barberías activas y por estado; citas de los últimos 12 meses; usuarios por tipo (con el corte, solo barberías). La hora del cálculo | |
| 11 | Comparar con lo sembrado | Los mismos números; ningún nombre, correo, teléfono ni id | |
| 12 | Un propietario abre `/plataforma/indicadores` con su token | 401 | |
| 13 | Revisar `platform_audit_log` | Una fila `ADMIN_INDICADORES_CONSULTADOS` por consulta | |

### US3 · Intentos sin la IP

| Paso | Acción | Esperado | Resultado |
| ---- | ------ | -------- | --------- |
| 14 | Fallar el inicio de sesión varias veces y consultar `login_attempt` | Solo `email_hash`, `ip_hash` y la fecha; ninguna IP legible | |
| 15 | Seguir fallando hasta el umbral | El mismo bloqueo y el mismo mensaje que antes de 007 | |
| 16 | Ingresar bien | Se borran los fallos de ese par; el siguiente ingreso no está bloqueado | |

## 3. Comprobaciones de aislamiento y permisos (PR09, PR08)

- Con el token de A, ninguna solicitud de B se lee, cambia ni crea (`aislamiento-007`, `rls`).
- `barberias_plataforma` no puede hacer `SELECT id FROM appointment`, `FROM membership` ni `FROM customer_profile`.
  Sí puede leer las dos vistas, si se construyeron (`lectura-plataforma`).
- `barberias_conteos` no puede iniciar sesión ni escribir, y ningún rol con inicio de sesión lo hereda.
- `barberias_app` y `barberias_publico` no pueden leer las vistas.
- `barberias_owner`, con el tenant de A fijado, sigue viendo solo las citas y membresías de A.

## 4. Revisión manual de la interfaz (del responsable)

Se revisa a 360 px y en escritorio, en tema claro y oscuro, solo con teclado y con axe DevTools.

| Fecha | Pantalla | 360 px | Escritorio | Claro | Oscuro | Teclado | axe (hallazgos y corrección o motivo) |
| ----- | -------- | ------ | ---------- | ----- | ------ | ------- | ------------------------------------- |
|       | "Mis datos" del cliente | | | | | | |
|       | "Mis datos" del barbero | | | | | | |
|       | Bandeja de solicitudes del propietario | | | | | | |
|       | Indicadores de la plataforma | | | | | | |

## 5. Lo que esta guía no demuestra

- Que el plazo de 10 días hábiles cumpla la Ley N.° 29733: está **por validar** contra el plazo legal, y no
  cuenta feriados.
- Que el propietario borre o corrija bien a mano lo que dice en su respuesta: el sistema solo registra la
  respuesta.
- Las solicitudes del propietario sobre su propia cuenta, la exportación, la anonimización y la vista de la
  auditoría para el administrador: **no construidas**.
