# Quickstart: validar 008 (adelanto de reserva con QR)

Guía de validación de extremo a extremo para **después de implementar**. No contiene código: remite a los
[contratos](contracts/) y al [modelo de datos](data-model.md). Cada paso dice qué se espera ver; el resultado se
anota en la columna "Resultado" al recorrerla (como en las guías de 003 y 004). **Ningún paso mueve dinero real**:
el QR es una imagen de prueba y el "pago" es un número de operación inventado.

## 0. Requisitos

- El entorno de 004 funcionando con Docker Compose (`docker compose up -d` en `tecnologia/plataforma-barberias/`),
  con Mailpit (`http://localhost:8025`) y el WhatsApp simulado.
- Las migraciones `0028` a `0030` aplicadas (las aplica `preparar-backend`).
- Una barbería de prueba con un servicio de S/ 40, un barbero con disponibilidad y horario, su propietario y dos
  clientes con cuenta (A y B), con canal correo.
- Una imagen PNG de un QR de prueba (cualquier PNG de menos de 1 MB).

## 1. Pruebas automáticas

```text
cd tecnologia/plataforma-barberias/backend
npm test                    # unitarias (politica-adelanto y estados)
npm run test:int            # integración con Testcontainers (incluye Mailpit)
npm run test:arch           # PR14 con la regla adelantos-solo-por-api
cd ../frontend && npm test  # pantallas de configuración, pago y bandeja
```

Esperado: todo en verde, con las pruebas nombradas en el plan ("Pruebas por escenario de la especificación"),
entre ellas PR31 (aislamiento y número no repetible) y PR32 (confirmación sin doble efecto, también a la vez que
el vencimiento).

## 2. Recorrido con Docker Compose (dos réplicas)

| Paso | Acción | Esperado | Resultado |
| ---- | ------ | -------- | --------- |
| 1 | El propietario abre `/app/adelanto`, elige porcentaje 20 %, plazo 10 min y sube el QR | Guardado; la vista previa del QR aparece. Sin QR, "Activar" muestra el error y no guarda | |
| 2 | El cliente A reserva el servicio de S/ 40 para mañana | La cita queda **pendiente**; lo lleva a "Pagar adelanto" con el QR, S/ 8,00, el código de 6 caracteres y la hora límite. Ese horario ya no aparece libre para B | |
| 3 | En Mailpit, el correo de A | **Un** correo de instrucciones con monto, código y hora límite; sin QR adjunto, sin teléfono | |
| 4 | A registra el número `OP123456` con una captura PNG | El estado pasa a "pago por revisar"; el propietario recibe **un** correo de comprobante por revisar, sin el número | |
| 5 | B reserva otra hora y registra el mismo número `OP123456` | 409 `NUMERO_OPERACION_REPETIDO`; nada cambia | |
| 6 | El propietario abre `/app/adelantos` y confirma el pago de A | La cita de A pasa a **confirmada**; A recibe **un** correo de adelanto confirmado con el saldo S/ 32,00. En la agenda: "Adelanto S/ 8,00 · saldo S/ 32,00" | |
| 7 | B no registra nada y pasan 10 minutos | En la corrida siguiente de `vencer-adelantos` (≤ 5 min después) la cita de B se cancela sola, el horario vuelve a estar libre y B y el propietario reciben **un** aviso de adelanto vencido | |
| 8 | Otra reserva de B; B registra un número; el propietario lo rechaza con el motivo "No aparece en Yape" | B recibe el aviso con el motivo y puede registrar otro número dentro del plazo | |
| 9 | Otra reserva de B; B registra un número y el propietario no hace nada hasta pasar la hora límite | La cita **no** se cancela; en la bandeja aparece con el plazo vencido y su límite máximo | |
| 10 | Adelantar el límite máximo del paso 9 (`npm run demo:adelanto -- --limite`, si se implementa, o con la base de desarrollo) | La cita se cancela sola, el adelanto queda "por devolver" y los dos reciben un aviso | |
| 11 | A cancela su cita confirmada con tiempo | El adelanto queda "por devolver"; el propietario lo marca **devuelto** y A ve "devuelto" en Mis citas | |
| 12 | Otra cita confirmada con adelanto: el propietario la marca "no asistió" | El adelanto queda "retenido"; "marcar devuelto" no aparece (409 si se intenta por la API) | |
| 13 | El propietario registra una cita presencial | Nace confirmada, sin adelanto | |
| 14 | `docker compose stop backend-1` justo después de que B registre un pago | El aviso al propietario llega igual, una vez, enviado por `backend-2` | |
| 15 | Revisar los registros de las réplicas (`docker compose logs`) | No aparece ningún número de operación ni contenido de archivos | |

## 3. Comprobaciones de aislamiento (PR09, PR31)

- Con el token del cliente B, `GET /citas/{id de A}/adelanto`, `/qr` y `/captura` responden 404.
- Con el token del propietario de otra barbería, las mismas rutas con el id de la cita de A responden 404.
- El mismo número de operación registrado en **otra** barbería se acepta (la comparación es por barbería) y no
  revela nada de la primera.

## 4. Revisión manual de la interfaz

Una fila por pantalla nueva o cambiada. Se revisa a 360 px y en escritorio, en tema claro y oscuro, solo con
teclado, y con la **extensión axe DevTools del navegador**. Si un hallazgo no se corrige, se anota el motivo.

| Fecha | Pantalla | 360 px | Escritorio | Claro | Oscuro | Teclado | axe (hallazgos y corrección o motivo) |
| ----- | -------- | ------ | ---------- | ----- | ------ | ------- | ------------------------------------- |
|       | Configuración del adelanto `/app/adelanto` | | | | | | |
|       | Pagar adelanto `/mis-citas/:citaId/adelanto` | | | | | | |
|       | Bandeja `/app/adelantos` | | | | | | |
|       | Agenda y Mis citas con el estado del adelanto | | | | | | |

### Medición manual de SC-001 y SC-002

Con cronómetro, tres intentos, a 360 px y en escritorio: activar el adelanto (SC-001, < 3 min) y registrar el
pago desde que se ven las instrucciones (SC-002, < 1 min). Una sola persona, en local: no representa a usuarios
reales.

## 5. Lo que esta guía no demuestra

- Que el pago existe en Yape o Plin: lo comprueba el propietario en su aplicación (verificación manual, ADR-033).
- Que la barbería devolvió el dinero: la plataforma solo registra la marca del propietario.
- Ningún movimiento de dinero: la plataforma no lo recibe ni lo transfiere (principio V, 1.5.0).
