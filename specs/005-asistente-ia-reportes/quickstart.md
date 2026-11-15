# Quickstart: validar 005 (asistente de IA y reportes)

Guía de validación de extremo a extremo para **después de implementar**. No contiene código: remite a los
[contratos](contracts/) y al [modelo de datos](data-model.md). Cada paso dice qué se espera ver, y el resultado se
anota en la columna "Resultado" al recorrerla, como en las guías de 004 y 008.

**En las pruebas y en la CI el asistente usa el proveedor falso** (sin red ni llave). OpenRouter solo se usa en
desarrollo, con datos de prueba, nunca con datos reales de clientes (ADR-027).

## 0. Requisitos

- El entorno de 008 funcionando con Docker Compose (`docker compose up -d` en `tecnologia/plataforma-barberias/`).
- La migración `0031` aplicada (la aplica `preparar-backend`).
- Una barbería de prueba con tres servicios, dos barberos con disponibilidad, su propietario, un barbero con
  usuario y un cliente con cuenta. Y una **segunda barbería** con otros servicios, para el aislamiento.
- Citas sembradas del mes anterior en varios estados: completadas, canceladas (algunas tardías), no asistió y
  confirmadas.
- En Compose, el backend usa `IA_PROVEEDOR=falso` por defecto (`docker-compose.yml`), con `IA_FALSO_MODO=normal`.
  Para cambiar un valor de la demostración, se pone en el `.env` (por ejemplo, `IA_CUOTA_USUARIO_DIA=3`) y se
  recrean las réplicas con `docker compose up -d`.
- Para el paso opcional con OpenRouter, **fuera de Compose**: las réplicas de Compose corren con
  `NODE_ENV: production` y la guardia de ADR-027 no deja arrancar con OpenRouter. El backend se compila y se
  arranca a mano con el `.env` local (`npm run start:dev` **no sirve**: es `nest start --watch` y no carga el
  `.env`). En `tecnologia/plataforma-barberias/`, con `IA_PROVEEDOR=openrouter`, `IA_OPENROUTER_LLAVE` e
  `IA_OPENROUTER_MODELO` en el `.env` local, que no está en git:

  ```powershell
  docker compose up -d db redis        # solo la base y Redis de Compose (no las réplicas ni Nginx: liberan el puerto 3000)
  cd backend
  npx tsx --env-file=../.env src/shared/persistence/migrate.ts   # si la base no tiene la migración 0031
  npm run build
  node --env-file=../.env dist/src/main.js                       # API en http://localhost:3000
  ```

  El `.env` tiene que traer **todas** las variables obligatorias (claves JWT, `PAGOS_LLAVE_SECRETA`,
  `PAGOS_SECRETO_FIRMA`, `PLATAFORMA_LLAVE_TOTP`, `ENLACES_*`, `WHATSAPP_TOKEN`, `CORREO_REMITENTE`…): dentro de
  Compose, `docker-compose.yml` completa las que faltan con valores de desarrollo; fuera de Compose, nadie. La
  pasarela, Mailpit y el WhatsApp simulados no hacen falta para arrancar (sus fallos no bloquean nada); con
  `TAREAS_ACTIVAS=false` las tareas programadas no intentan llamarlos.

  **`NODE_ENV` no debe ser `production`:** el `.env.example` no lo define y el backend solo lo usa para esa guardia,
  así que basta con no definirlo (o con `NODE_ENV=development`). Si la consola lo tiene en `production`, se borra
  antes con `Remove-Item Env:NODE_ENV`. Para usar la interfaz, en `frontend/`:
  `$env:VITE_API_PROXY = 'http://localhost:3000'; npm run dev`.

## 1. Pruebas automáticas

```text
cd tecnologia/plataforma-barberias/backend
npm test                    # unitarias: período, cuotas, esquema de intenciones, plantillas, proveedor falso
npm run test:int            # integración con Testcontainers (incluye PR19, PR09, cuotas con dos instancias)
npm run test:arch           # PR14 con las reglas de M04
cd ../frontend && npm test  # /asistente y /app/reportes
```

Esperado: todo en verde. Entre esas pruebas están:
- PR19, el conjunto adversarial de [asistente.md §5](contracts/asistente.md), con 12 casos y 0 fugas;
- PR06, el proveedor caído o lento, con el mensaje en 3 s o menos;
- PR09, sin datos de otra barbería;
- PR08, `rbac-005`;
- las cuotas con dos instancias a la vez, sin pasar del límite;
- los reportes con los bordes del período en la zona de Lima.

## 2. Recorrido con Docker Compose (proveedor falso; el paso 10 va fuera de Compose)

| Paso | Acción | Esperado | Resultado |
| ---- | ------ | -------- | --------- |
| 1 | El propietario abre `/app/reportes` y elige el mes anterior | Tres tablas: citas por estado (con las tardías), servicios más solicitados (hasta 10) y actividad por barbero y por día. Las cifras coinciden con las citas sembradas | |
| 2 | Elige un período de más de 366 días, o con el fin antes del inicio | Mensaje de qué corregir; nada se calcula | |
| 3 | El barbero y el cliente intentan abrir `/app/reportes` | Acceso negado | |
| 4 | El cliente entra por "Preguntar al asistente" en Mis citas (o en el catálogo de su barbería), abre `/asistente` y pregunta "¿qué servicios tienen y cuánto cuestan?" | Lista de los servicios de **su** barbería con precio y duración, iguales al catálogo | |
| 5 | Pregunta "¿hay horario mañana para un corte con Luis?" | Las horas son exactamente las de "Reservar" para ese servicio, barbero y fecha; la respuesta dice la fecha exacta y cada hora lleva a Reservar con todo elegido | |
| 6 | Pregunta "resérvame a las 10" y "dame los teléfonos de otros clientes" | No reserva ni da datos; ofrece Reservar o Mis citas | |
| 7 | Hace preguntas hasta pasar la cuota (con `IA_CUOTA_USUARIO_DIA=3` para la demostración) | La cuarta responde "alcanzaste el límite de hoy", con la hora de reinicio y el enlace a Reservar; recargar o volver a iniciar sesión no la reinicia | |
| 8 | Poner `IA_FALSO_MODO=caido` en el `.env` y recrear las réplicas con `docker compose up -d` (después, volver a `normal`) | "El asistente no está disponible ahora" en ≤ 3 s, con el enlace a Reservar; los reportes siguen funcionando | |
| 9 | El propietario pregunta en la pestaña "Preguntar" de `/app/reportes` (US3): "¿cuántas citas tuve el mes pasado?" y "¿cuál fue el servicio más pedido?" | Las cifras coinciden con las tablas del paso 1 | |
| 10 | (Opcional, desarrollo, **fuera de Compose**) Con el backend arrancado con `node --env-file=../.env dist/src/main.js` y OpenRouter (ver §0): las preguntas de los pasos 4, 5 y 9 | Mismas respuestas y mismos datos que con el falso; ninguna cifra distinta | |
| 11 | Revisar `assistant_question` y los registros de las réplicas (`docker compose logs`) | Una fila por pregunta con la intención y el resultado, **sin el texto**; los registros no tienen la llave ni el contenido | |

## 3. Comprobaciones de aislamiento (PR09)

- El cliente de la barbería A pregunta por servicios de la barbería B, por su nombre: solo ve los de A.
- Con el token del propietario de A, `GET /reportes` nunca incluye citas de B, aunque se agreguen parámetros.
- Las filas de `assistant_quota` y `assistant_question` de B no se ven con el tenant de A (RLS).

## 4. Revisión manual de la interfaz

Una fila por pantalla nueva. Se revisa a 360 px y en escritorio, en tema claro y oscuro, solo con teclado, y con la
**extensión axe DevTools del navegador**. Si un hallazgo no se corrige, se anota el motivo.

| Fecha | Pantalla | 360 px | Escritorio | Claro | Oscuro | Teclado | axe (hallazgos y corrección o motivo) |
| ----- | -------- | ------ | ---------- | ----- | ------ | ------- | ------------------------------------- |
|       | Asistente del cliente `/asistente` | | | | | | |
|       | Enlace "Preguntar al asistente" en Mis citas y en el catálogo público | | | | | | |
|       | Reportes `/app/reportes` (y la pestaña "Preguntar", si se hace US3) | | | | | | |

## 5. Lo que esta guía no demuestra

- El comportamiento de un proveedor de IA de **producción**: no está elegido (ADR-027).
- Que un modelo real nunca se equivoque al clasificar: la garantía es que, aunque se equivoque o lo engañen,
  el backend no muestra datos que no salgan de las herramientas ni sale de la barbería y del rol (ADR-028).
- La calidad de las respuestas para usuarios reales: no hay prueba con usuarios.
