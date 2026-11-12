# Quickstart: validar 004 (notificaciones y reprogramación)

Guía de validación de extremo a extremo para **después de implementar**. No contiene código: remite a los [contratos](contracts/) y al [modelo de datos](data-model.md). Cada paso dice qué se espera ver; el resultado se anota en la columna "Resultado" al recorrerla (como en el quickstart de 003).

## 0. Requisitos

- Docker con el entorno de 003 funcionando (`docker compose up -d` en `tecnologia/plataforma-barberias/`).
- `.env` con las variables nuevas de `.env.example`: `ENLACES_LLAVE`, `SMTP_*` (apuntando a `mailpit:1025`), `WHATSAPP_*`, `URL_PUBLICA` (`http://localhost:5173`) y `EVENTOS_INTERVALO_MS` (15000).
- Servicios nuevos en marcha: `mailpit` (interfaz en `http://localhost:8025`) y `whatsapp-simulado` (`http://localhost:3200`). La imagen de Mailpit la descarga el responsable, después de comprobar que Docker guarda las imágenes en D:.
- Una barbería de prueba con servicios, dos barberos, horario y dos clientes (uno con canal correo y otro que elegirá WhatsApp).

## 1. Pruebas automáticas

```text
cd tecnologia/plataforma-barberias/backend
npm test                    # unitarias
npm run test:int            # integración con Testcontainers (incluye Mailpit en contenedor)
npm run test:arch           # PR14 con las reglas nuevas
cd ../frontend && npm test  # interfaz
```

Esperado: todo en verde, con las pruebas nombradas en el plan ("Pruebas por escenario"). La variante con un proveedor real de la suite de contrato aparece **omitida**.

**Resultado (2026-11-12, cierre de 004):** unitarias 777 de 777 (42 archivos); arquitectura 31 de 31 (346 módulos, 1 574 dependencias, sin violaciones); frontend 159 de 160 en la corrida completa, y la que falló (`transferencia`) pasó 6 de 6 sola. Integración: 1 573 en verde y 2 omitidas (`canal-sandbox` y `gateway-sandbox`, sin credenciales), en 50,6 min; `balanceador` y `proveedor-caido` fallaron por tiempo en la corrida completa y pasaron al repetirlas solas (`proveedor-caido` al segundo intento, `balanceador` al tercero), con el equipo cargado por otros programas. Las pruebas de tiempo del backend pueden fallar bajo carga en equipos lentos ([pruebas §2.4](../../docs/05-gestion/04-pruebas.md)).

## 2. Recorrido con Docker Compose (dos réplicas)

| Paso | Acción                                                                                                         | Esperado                                                                                               | Resultado |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| 1    | El cliente A (canal correo) reserva una cita para dentro de 3 h                                                 | 201. En Mailpit, **un** correo de confirmación en texto simple con barbería, servicio, barbero, fecha y hora, sin teléfono ni correo del cliente | **Conforme** (2026-11-12, `npm run demo:avisos`, dos réplicas): la cita la registra el propietario para un cliente con correo; 201 en 1 915 ms; 1 correo de confirmación en 30 s, sin el teléfono |
| 2    | `docker compose stop mailpit`; el cliente A reprograma su cita a otra hora libre                                | 200 en el mismo tiempo que con Mailpit en marcha. La hora anterior aparece libre                       | **Conforme en parte** (2026-11-12, `demo:avisos`): con Mailpit detenido, la reprogramación (hecha por el propietario) respondió 200 en 1 310 ms, menos que el registro del paso 1. El script no comprueba que la hora anterior quede libre: lo cubre la prueba `reprogramar` |
| 3    | `docker compose start mailpit` y esperar 1 minuto                                                               | **Un** correo de reprogramación con la hora anterior y la nueva; ninguno repetido                     | **Conforme** (2026-11-12, `demo:avisos`): 1 correo de reprogramación con la hora anterior y la nueva, sin el teléfono, 52 s después de volver a iniciar Mailpit; en la base, el aviso quedó `ENVIADO` con 1 intento fallido |
| 4    | El cliente A intenta reprogramar a una hora ocupada                                                             | 409 `HORARIO_NO_DISPONIBLE`; la cita conserva su hora; ningún correo nuevo                             | **Pendiente del responsable** (con la interfaz) |
| 5    | Con una cita a menos de la antelación mínima, el cliente A intenta reprogramarla                                | 422 `SIN_ANTELACION_PARA_REPROGRAMAR` y la interfaz ofrece cancelar; el propietario sí puede           | **Pendiente del responsable** (con la interfaz) |
| 6    | El cliente B abre "Cómo recibo mis avisos" desde Mis citas (`/mis-avisos`) y elige WhatsApp: el número aparece propuesto con su teléfono; acepta el consentimiento | 200; el consentimiento queda con fecha, hora, versión del texto y número                               | **Pendiente del responsable** (con la interfaz) |
| 7    | El cliente B reserva                                                                                            | La confirmación aparece en el simulador (`GET /mensajes?para=`), no en Mailpit                         | **Pendiente del responsable** |
| 8    | `npm run whatsapp:modo -- caido`; el propietario cancela la cita de B                                           | Tras los reintentos, el aviso llega a Mailpit **una vez** (respaldo). La cancelación respondió al instante | **Pendiente del responsable** |
| 9    | El cliente B retira el consentimiento; se reserva otra cita para B                                              | La confirmación llega por correo; 0 mensajes nuevos en el simulador                                    | **Pendiente del responsable** |
| 10   | `npm run demo:avisos -- --recordatorio`: adelanta el reloj de una cita para que falten 2 h                      | **Un** recordatorio con tres enlaces, aunque las dos réplicas estén en marcha                          | **No ejecutable con el script actual:** `demo:avisos` no tiene `--recordatorio` (se omitió por el recorte 2). Pendiente del responsable, con una cita reservada para dentro de 2 h y unos minutos |
| 11   | Abrir "confirmo asistencia" desde el correo                                                                     | La página muestra los datos mínimos; al confirmar, la agenda dice "confirmada por el cliente"          | **Pendiente del responsable** (depende del paso 10) |
| 12   | Abrir el mismo enlace otra vez                                                                                  | "Este enlace ya no es válido", con la opción de iniciar sesión; la cita no cambia                      | **Pendiente del responsable** (depende del paso 10) |
| 13   | Abrir "cancelar" de la misma cita                                                                               | Se permite (confirmar no invalida cancelar); la hora queda libre; el propietario recibe un correo      | **Pendiente del responsable** (depende del paso 10) |
| 14   | En otra cita, abrir "reprogramar", elegir una hora ocupada y luego una libre                                    | La primera falla sin consumir el enlace; la segunda reprograma y llega el aviso de reprogramación      | **Pendiente del responsable** (depende del paso 10) |
| 15   | Revisar los registros de Nginx y de las réplicas (`docker compose logs`)                                        | Ningún token de enlace aparece en los registros                                                        | **Pendiente del responsable**, después de los pasos 10 a 14 (en este recorrido no se emitió ningún enlace) |
| 16   | `docker compose stop backend-1` justo después de reservar una cita (`npm run demo:avisos -- --caida`)           | La confirmación llega igual, una vez, enviada por `backend-2`                                          | **Conforme** (2026-11-12, `demo:avisos -- --caida`): 201; `backend-1` detenido de inmediato; 1 confirmación en Mailpit a los 20 s, sin el teléfono; el aviso quedó `ENVIADO` sin intentos fallidos; `backend-1` volvió con `--no-deps` |
| 17   | (Fase 6, si no se recortó) `npm run demo:vencimiento` sobre una barbería en prueba                              | El propietario recibe, una vez cada uno, "prueba por terminar" y "suscripción vencida"                 | **No ejecutable con el script actual:** `demo:vencimiento` siembra barberías sin propietario, así que sus avisos se descartan (`SIN_CANAL`). La fase 6 no se recortó; pendiente del responsable con una barbería real en prueba |

## 3. Comprobaciones de aislamiento (PR09)

- Un enlace firmado para la barbería A con el identificador de una cita de B (fabricado en la prueba con la llave) es rechazado: la cita de B no existe con el tenant de A.
- Un token alterado en un solo carácter responde `ENLACE_NO_VALIDO` sin consultas a la base: la prueba cuenta las consultas.
- `GET /clientes/yo/aviso` con el token de otra barbería devuelve la preferencia de esa barbería, nunca la de la primera.

**Resultado (2026-11-12):** las tres comprobaciones están cubiertas por pruebas automáticas, en verde en la corrida completa: `aislamiento/aislamiento-avisos.spec.ts` ("un enlace firmado para la barbería A con la cita de B → 410 y la cita de B no cambia" y "un token alterado se rechaza sin abrir ninguna transacción con barbería ni leer la cita") y `clientes/canal-aviso.spec.ts` ("US4-6: con membresía en dos barberías, cada una conserva su propio canal y consentimiento"). No se repitieron a mano con Docker Compose.

## 4. Revisión manual de la interfaz

Una fila por pantalla nueva o cambiada (tareas de revisión de las fases 2, 4 y 5 en [tasks.md](tasks.md)). Se revisa a 360 px y en escritorio, en tema claro y oscuro, solo con teclado, y con la **extensión axe DevTools del navegador** (manual, sin dependencias nuevas). Si un hallazgo no se corrige, se anota el motivo.

| Fecha | Pantalla                                 | 360 px | Escritorio | Claro | Oscuro | Teclado | axe (hallazgos y corrección o motivo) |
| ----- | ---------------------------------------- | ------ | ---------- | ----- | ------ | ------- | ------------------------------------- |
|       | Reprogramar desde Mis citas              |        |            |       |        |         |                                       |
|       | Reprogramar desde la Agenda              |        |            |       |        |         |                                       |
|       | Página del enlace `/e`                   |        |            |       |        |         |                                       |
|       | Agenda con la marca de confirmación      |        |            |       |        |         |                                       |
|       | Canal de aviso `/mis-avisos`             |        |            |       |        |         |                                       |

### Medición manual de SC-002 (reprogramar en menos de 1 minuto)

Con cronómetro, tres intentos por vía, a 360 px y en escritorio. Se mide desde que la pantalla de partida está abierta hasta que aparece la confirmación de la nueva hora. Es una medición en local con una sola persona: no representa a usuarios reales.

| Fecha | Vía                                    | Ancho      | Intento 1 | Intento 2 | Intento 3 | ¿Todos < 1 min? |
| ----- | -------------------------------------- | ---------- | --------- | --------- | --------- | --------------- |
|       | Desde Mis citas (con sesión)           | 360 px     |           |           |           |                 |
|       | Desde Mis citas (con sesión)           | Escritorio |           |           |           |                 |
|       | Desde el enlace del recordatorio (`/e`) | 360 px     |           |           |           |                 |
|       | Desde el enlace del recordatorio (`/e`) | Escritorio |           |           |           |                 |

## 5. Lo que esta guía no demuestra

- La entrega en un buzón real o en un WhatsApp real: no hay proveedor de producción (ver "Lo que NO se afirmará" en el [plan](plan.md)).
- La ausencia de duplicados cuando una réplica cae **en medio del envío** al canal (ADR-025).
