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
- Para el paso opcional con OpenRouter: `IA_PROVEEDOR=openrouter`, `IA_OPENROUTER_LLAVE` y `IA_OPENROUTER_MODELO`
  en el `.env` local, que no está en git.

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

## 2. Recorrido con Docker Compose (proveedor falso, salvo el paso 10)

| Paso | Acción | Esperado | Resultado |
| ---- | ------ | -------- | --------- |
| 1 | El propietario abre `/app/reportes` y elige el mes anterior | Tres tablas: citas por estado (con las tardías), servicios más solicitados (hasta 10) y actividad por barbero y por día. Las cifras coinciden con las citas sembradas | |
| 2 | Elige un período de más de 366 días, o con el fin antes del inicio | Mensaje de qué corregir; nada se calcula | |
| 3 | El barbero y el cliente intentan abrir `/app/reportes` | Acceso negado | |
| 4 | El cliente abre `/asistente` y pregunta "¿qué servicios tienen y cuánto cuestan?" | Lista de los servicios de **su** barbería con precio y duración, iguales al catálogo | |
| 5 | Pregunta "¿hay horario mañana para un corte con Luis?" | Las horas son exactamente las de "Reservar" para ese servicio, barbero y fecha; la respuesta dice la fecha exacta y cada hora lleva a Reservar con todo elegido | |
| 6 | Pregunta "resérvame a las 10" y "dame los teléfonos de otros clientes" | No reserva ni da datos; ofrece Reservar o Mis citas | |
| 7 | Hace preguntas hasta pasar la cuota (con `IA_CUOTA_USUARIO_DIA=3` para la demostración) | La cuarta responde "alcanzaste el límite de hoy", con la hora de reinicio y el enlace a Reservar; recargar o volver a iniciar sesión no la reinicia | |
| 8 | Con `npm run ia:modo -- caido` (o deteniendo el proveedor en desarrollo) | "El asistente no está disponible ahora" en ≤ 3 s, con el enlace a Reservar; los reportes siguen funcionando | |
| 9 | El propietario pregunta en la pestaña "Preguntar" de `/app/reportes` (US3): "¿cuántas citas tuve el mes pasado?" y "¿cuál fue el servicio más pedido?" | Las cifras coinciden con las tablas del paso 1 | |
| 10 | (Opcional, desarrollo) Con OpenRouter: las preguntas de los pasos 4, 5 y 9 | Mismas respuestas y mismos datos que con el falso; ninguna cifra distinta | |
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
|       | Reportes `/app/reportes` (y la pestaña "Preguntar", si se hace US3) | | | | | | |

## 5. Lo que esta guía no demuestra

- El comportamiento de un proveedor de IA de **producción**: no está elegido (ADR-027).
- Que un modelo real nunca se equivoque al clasificar: la garantía es que, aunque se equivoque o lo engañen,
  el backend no muestra datos que no salgan de las herramientas ni sale de la barbería y del rol (ADR-028).
- La calidad de las respuestas para usuarios reales: no hay prueba con usuarios.
