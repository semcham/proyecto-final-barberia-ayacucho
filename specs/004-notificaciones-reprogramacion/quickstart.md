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

## 2. Recorrido con Docker Compose (dos réplicas)

| Paso | Acción                                                                                                         | Esperado                                                                                               | Resultado |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| 1    | El cliente A (canal correo) reserva una cita para dentro de 3 h                                                 | 201. En Mailpit, **un** correo de confirmación en texto simple con barbería, servicio, barbero, fecha y hora, sin teléfono ni correo del cliente | |
| 2    | `docker compose stop mailpit`; el cliente A reprograma su cita a otra hora libre                                | 200 en el mismo tiempo que con Mailpit en marcha. La hora anterior aparece libre                       | |
| 3    | `docker compose start mailpit` y esperar 1 minuto                                                               | **Un** correo de reprogramación con la hora anterior y la nueva; ninguno repetido                     | |
| 4    | El cliente A intenta reprogramar a una hora ocupada                                                             | 409 `HORARIO_NO_DISPONIBLE`; la cita conserva su hora; ningún correo nuevo                             | |
| 5    | Con una cita a menos de la antelación mínima, el cliente A intenta reprogramarla                                | 422 `SIN_ANTELACION_PARA_REPROGRAMAR` y la interfaz ofrece cancelar; el propietario sí puede           | |
| 6    | El cliente B abre "Cómo recibo mis avisos" desde Mis citas (`/mis-avisos`) y elige WhatsApp: el número aparece propuesto con su teléfono; acepta el consentimiento | 200; el consentimiento queda con fecha, hora, versión del texto y número                               | |
| 7    | El cliente B reserva                                                                                            | La confirmación aparece en el simulador (`GET /mensajes?para=`), no en Mailpit                         | |
| 8    | `npm run whatsapp:modo -- caido`; el propietario cancela la cita de B                                           | Tras los reintentos, el aviso llega a Mailpit **una vez** (respaldo). La cancelación respondió al instante | |
| 9    | El cliente B retira el consentimiento; se reserva otra cita para B                                              | La confirmación llega por correo; 0 mensajes nuevos en el simulador                                    | |
| 10   | `npm run demo:avisos -- --recordatorio`: adelanta el reloj de una cita para que falten 2 h                      | **Un** recordatorio con tres enlaces, aunque las dos réplicas estén en marcha                          | |
| 11   | Abrir "confirmo asistencia" desde el correo                                                                     | La página muestra los datos mínimos; al confirmar, la agenda dice "confirmada por el cliente"          | |
| 12   | Abrir el mismo enlace otra vez                                                                                  | "Este enlace ya no es válido", con la opción de iniciar sesión; la cita no cambia                      | |
| 13   | Abrir "cancelar" de la misma cita                                                                               | Se permite (confirmar no invalida cancelar); la hora queda libre; el propietario recibe un correo      | |
| 14   | En otra cita, abrir "reprogramar", elegir una hora ocupada y luego una libre                                    | La primera falla sin consumir el enlace; la segunda reprograma y llega el aviso de reprogramación      | |
| 15   | Revisar los registros de Nginx y de las réplicas (`docker compose logs`)                                        | Ningún token de enlace aparece en los registros                                                        | |
| 16   | `docker compose stop backend-1` justo después de reservar una cita (`npm run demo:avisos -- --caida`)           | La confirmación llega igual, una vez, enviada por `backend-2`                                          | |
| 17   | (Fase 6, si no se recortó) `npm run demo:vencimiento` sobre una barbería en prueba                              | El propietario recibe, una vez cada uno, "prueba por terminar" y "suscripción vencida"                 | |

## 3. Comprobaciones de aislamiento (PR09)

- Un enlace firmado para la barbería A con el identificador de una cita de B (fabricado en la prueba con la llave) es rechazado: la cita de B no existe con el tenant de A.
- Un token alterado en un solo carácter responde `ENLACE_NO_VALIDO` sin consultas a la base: la prueba cuenta las consultas.
- `GET /clientes/yo/aviso` con el token de otra barbería devuelve la preferencia de esa barbería, nunca la de la primera.

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
