# Quickstart: Suscripciones y pagos (003)

Guía para validar la funcionalidad de punta a punta.

- Contratos: [contracts/](contracts/).
- Modelo: [data-model.md](data-model.md).
- Decisiones: [research.md](research.md).

**Todo es con el simulador o el ambiente de pruebas: no se hace ningún cobro real.**

## 1. Preparación

```powershell
cd tecnologia/plataforma-barberias
# Variables nuevas en .env (ver .env.example): PAGOS_PROVEEDOR=simulado, PAGOS_SECRETO_FIRMA,
# PAGOS_LLAVE_SECRETA, PAGOS_CUENTA_* (datos bancarios de prueba), PLATAFORMA_LLAVE_TOTP,
# SIMULADOR_TOKEN_CONTROL, TAREAS_INTERVALO_MS (para la demo, 60000).
docker compose up -d                 # suma el servicio pasarela-simulada (64 MB)
cd backend
npm run plataforma:crear-admin -- --correo admin@plataforma.local --nombre "Admin de pruebas"
#   → imprime una sola vez la URI otpauth:// (para la app de autenticación) y 10 códigos de recuperación
```

Requisitos: el entorno de 006 en marcha y una barbería registrada en prueba gratuita (flujo de 001).

## 2. Pruebas automáticas (en verde, también en CI)

| Comando (en `backend/`)                                         | Cubre                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                      | PR25: estados, períodos (fin de mes, gracia y adelantado), `PoliticaDeOperacion`, TOTP con los vectores del RFC 6238, firma HMAC y detección de tipo por bytes                                                                              |
| `npm run test:int`                                              | PR17 notificaciones, PR06 proveedor caído y lento, PR09 aislamiento de pagos y lectura de plataforma, restricciones por estado, vencimiento con dos réplicas, conciliación, comprobantes, administrador y segundo factor, canarios (SC-010) |
| `npm run test:int -- payment-gateway`                           | PR20 contra el simulador. Con `PAGOS_SANDBOX_*` definidas, también contra el ambiente de pruebas del proveedor                                                                                                                              |
| `npm run test:arch`                                             | PR14 con las reglas nuevas (lectura de plataforma confinada, pasarela solo por el puerto, simulador fuera del monolito, `exigirOperacion` en los casos de uso de escritura)                                                                 |
| `npx vitest run --maxWorkers=1 --minWorkers=1` (en `frontend/`) | Pantallas de suscripción, transferencia, historial, aviso de reservas y panel del administrador                                                                                                                                             |

## 3. Recorrido manual

1. **Ver la suscripción** (propietario, `/app/suscripcion`).
   - **Esperado:** "En prueba", fecha de fin, días restantes y límites; los planes BÁSICO y PRO con su
     precio referencial.
2. **Pagar con Yape** (US1).
   - **Acción:** elegir BÁSICO, luego Yape, y en la página del simulador pulsar "Aprobar".
   - **Esperado:** al volver, "pagado"; el período empieza al terminar la prueba (no se pierden días);
     el historial muestra "Aprobado · Yape · S/ 49,00".
   - Repetirlo cerrando la pestaña antes de volver: el resultado es el mismo (lo confirmó la
     notificación, no el navegador).
3. **Notificación repetida y firma inválida** (PR17).
   - **Acción:** `npm run simulador:modo -- duplicar 10` y pagar con **otra** barbería (la del paso 2 ya pagó el período siguiente, y el máximo es uno por adelantado).
   - **Esperado:** 1 período nuevo, 1 pago aprobado, 9 notificaciones respondidas como repetidas.
   - **Acción:** con `firma_invalida`, el pago queda pendiente.
   - **Esperado:** `docker compose logs` muestra una línea `PAGO_NOTIFICACION_RECHAZADA` por intento,
     sin el cuerpo.
4. **Pasarela caída** (PR06).
   - **Acción:** `docker compose stop pasarela-simulada` e intentar pagar con Yape.
   - **Esperado:** en 3 s o menos, "El pago en línea no está disponible ahora…" con la opción de
     transferencia; las reservas siguen funcionando.
   - Volver con `docker compose up -d --no-deps pasarela-simulada`.
5. **Transferencia** (US3).
   - **Acción:** elegir "Transferencia" y subir un PNG de prueba con un número de operación.
   - **Esperado:** "comprobante en revisión".
   - **Acción:** como administrador (`/plataforma`, con correo, contraseña y código TOTP) abrir
     "Comprobantes", ver el archivo y aprobarlo con el importe exacto.
   - **Esperado:** la suscripción se extiende un período.
   - **Acción:** subir otro con el **mismo** número de operación desde otra barbería.
   - **Esperado:** el administrador ve "número ya usado" y no puede aprobarlo.
   - **Acción:** en una barbería que inició la transferencia hoy, subir el comprobante con una fecha de
     hace 3 días (FR-020b).
   - **Esperado:** se acepta ("comprobante en revisión") y en la cola el administrador ve "Fecha anterior
     al pago" junto al día en que se inició; puede aprobarlo o rechazarlo igual. Con la fecha de ayer
     (tolerancia de un día por la hora de Lima) no aparece la marca.
6. **Comprobante inválido.** Renombrar un `.txt` a `.png` y subirlo.
   - **Esperado:** se rechaza sin guardarse. Una fecha futura o de hace más de 30 días también se
     rechaza sin guardarse.
7. **Vencimiento** (US2).
   - **Acción:** con una barbería de prueba sembrada con `npm run demo:vencimiento` (fin de prueba hace
     una hora), esperar a la tarea (`TAREAS_INTERVALO_MS=60000`).
   - **Esperado:** "Vencida"; el cliente ve "Esta barbería no acepta reservas por ahora" al entrar a
     reservar, y la reserva por la API responde 403 `SUSCRIPCION_NO_PERMITE`.
   - **Acción:** cancelar una cita existente. **Esperado:** se permite.
   - **Acción:** crear un servicio. **Esperado:** se rechaza.
8. **Conciliación** (US1, principio V).
   - **Acción:** `npm run simulador:modo -- aprobar_despues 900000` (la aprobación no notifica a
     tiempo) y aprobar con `POST /control/sesiones/{ref}/aprobar` sin notificación.
   - **Esperado:** a los 10 minutos o menos, la conciliación deja el pago aprobado.
9. **Administración** (US5).
   - **Acción:** suspender una barbería. **Esperado:** sus usuarios no inician sesión y su enlace dice
     "no disponible".
   - **Acción:** reactivarla. **Esperado:** el estado de la suscripción se recalcula por sus fechas.
   - **Acción:** activar un plan a mano con un motivo. **Esperado:** "Activación manual" en el historial.
10. **Aislamiento.**
    - **Acción:** como propietario de A, pedir `GET /suscripcion/pagos/{id de un pago de B}`.
      **Esperado:** 404.
    - **Acción:** con el token del administrador, pedir `GET /agenda`. **Esperado:** 401.

## 4. Demostración de vencimiento con dos réplicas

```powershell
cd backend
npm run demo:vencimiento -- --barberias 50   # siembra 50 suscripciones vencidas hace 1 h
# Esperar dos ciclos de la tarea; luego:
docker compose exec -T db psql -U postgres -d barberias -c "SELECT job, replica, processed FROM scheduled_job_run ORDER BY started_at DESC LIMIT 4"
```

**Esperado:**

- las 50 suscripciones vencidas, cada una con **una** fila de auditoría `SUSCRIPCION_VENCIDA`;
- las corridas alternan entre `backend-1` y `backend-2`, pero solo una procesa en cada ciclo, y la
  otra registra `processed = 0`.

## 5. Criterios de éxito y dónde se miden

| SC     | Medición                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------- |
| SC-001 | §3 paso 2 (cronometrado)                                                                             |
| SC-002 | PR17 y §3 paso 3                                                                                     |
| SC-003 | `vencimiento-dos-replicas` y §4                                                                      |
| SC-004 | `conciliacion` y §3 paso 8                                                                           |
| SC-005 | PR06 y §3 paso 4                                                                                     |
| SC-006 | PR09 (`aislamiento-pagos`, `lectura-plataforma`) y §3 paso 10                                        |
| SC-007 | §3 paso 5 (cronometrado)                                                                             |
| SC-008 | `restricciones-estado` y §3 paso 7                                                                   |
| SC-009 | PR20 (la misma suite con cada adaptador)                                                             |
| SC-010 | `canarios`                                                                                           |
| SC-011 | PR17 (aprobación tardía y período objetivo), `cobertura-derivada` y `comprobantes` (número repetido) |

## 6. Registro de ejecuciones

_(se completa al implementar)_
