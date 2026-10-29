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

### 6.1 Recorrido con Docker Compose (T104, 2026-10-29)

Entorno: `docker compose up -d` con las dos réplicas, Nginx, Redis, PostgreSQL 16 y `pasarela-simulada`, más
un archivo temporal de Compose con `TAREAS_INTERVALO_MS=60000` y una cuenta bancaria **de prueba**
(`PAGOS_CUENTA_*`). Se recorrió por HTTP (puerto 3000, por Nginx) con un script temporal que se borró al
terminar. El administrador fue una cuenta **descartable** creada para la verificación y desactivada al final;
la cuenta real la crea el responsable con `npm run plataforma:crear-admin`. Las barberías del recorrido se
sembraron como en las pruebas (salvo la del paso 1, registrada por la API) y la demostración de §4 se borró
con `npm run demo:vencimiento -- --limpiar`.

**Resultado: 39 de 39 comprobaciones conformes.**

| Paso | Qué se comprobó                                                                                                                                                                                                                                                            | Resultado                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Registro por la API; "En prueba" con fin, 14 días restantes y límites; planes BÁSICO (4 900) y PRO (8 900)                                                                                                                                                                 | Conforme                                                                                                                                                                                            |
| 2    | Pago con Yape, aprobado en la página del simulador; "pagado" por la notificación, sin volver del navegador; período desde el fin de la prueba; historial                                                                                                                   | Conforme. Del inicio al pago aprobado: 1,4 s (el inicio respondió en 0,8 s)                                                                                                                         |
| 3    | `duplicar 10`: 1 período, 1 pago aprobado, 1 auditoría y 1 evento registrado. `firma_invalida`: el pago sigue pendiente                                                                                                                                                    | Conforme; 3 líneas `PAGO_NOTIFICACION_RECHAZADA` (los reintentos), sin el cuerpo                                                                                                                    |
| 4    | `docker compose stop pasarela-simulada`: 503 `PAGO_EN_LINEA_NO_DISPONIBLE`; catálogo público y panel funcionan                                                                                                                                                             | Conforme, en 2,6 s (meta: 3 s)                                                                                                                                                                      |
| 5    | Transferencia, comprobante en revisión, cola, detalle con el número completo, archivo, aprobación con el importe exacto; mismo número desde otra barbería: "número ya usado" y 409 `NUMERO_OPERACION_YA_APROBADO`; fecha de hace 3 días con la marca y la de ayer sin ella | Conforme. La revisión por la API (cola, detalle, archivo y aprobación) tomó 0,5 s                                                                                                                   |
| 6    | `.txt` renombrado a `.png`, fecha futura y de hace 31 días: 400 y nada guardado                                                                                                                                                                                            | Conforme                                                                                                                                                                                            |
| 7    | Prueba vencida hace una hora: "Vencida" tras la tarea; el cliente ve "Esta barbería no acepta reservas por ahora"; reserva 403; cancelar se permite; crear un servicio, 403                                                                                                | Conforme; vencida 27 s después de sembrarla                                                                                                                                                         |
| 8    | `aprobar_despues 900000` y aprobación sin notificación: la conciliación deja el pago aprobado, con un solo período                                                                                                                                                         | Conforme, 24 s después de cumplir los 10 minutos (la antigüedad se adelantó en la base para no esperar 10 minutos)                                                                                  |
| 9    | Suspender: 403 `ACCESO_SUSPENDIDO` y enlace "no disponible"; reactivar con la prueba vencida mientras tanto: EXPIRED; activación manual: "Activación manual" con el motivo y S/ 49,00                                                                                      | Conforme                                                                                                                                                                                            |
| 10   | Propietario de A pide un pago de B: 404; token del administrador en `GET /agenda`: 401                                                                                                                                                                                     | Conforme                                                                                                                                                                                            |
| §4   | `npm run demo:vencimiento -- --barberias 50`                                                                                                                                                                                                                               | Conforme: 50 de 50 vencidas, cada una con **una** `SUSCRIPCION_VENCIDA`, y 50 tras un ciclo más. Corridas: `backend-1` procesó 51 (las 50 y la del paso 7) y las siguientes, en las dos réplicas, 0 |

**SC-001 y SC-007:** el tramo del sistema está muy por debajo de las metas (1,4 s del inicio del pago a la
suscripción activa, frente a 3 minutos; 0,5 s de la revisión por la API, frente a 2 minutos). **El
cronometraje con una persona en la interfaz queda pendiente:** este recorrido es por HTTP y no mide el
tiempo de quien usa la pantalla.

### 6.2 Suite completa (T105, 2026-10-29)

| Parte                         | Resultado                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend: Prettier y lint      | Sin diferencias ni errores                                                                                                                                                                                                                                                                                                     |
| Backend: build                | Sin errores                                                                                                                                                                                                                                                                                                                    |
| Backend: unitarias            | 32 archivos, **642 de 642**. Al terminar, Jest avisa a veces que un proceso no cerró a tiempo ("A worker process has failed to exit gracefully"); el resultado no cambia                                                                                                                                                       |
| Backend: integración          | 78 archivos (77 ejecutados y 1 omitido), **1 328 en verde y 1 omitida** (`payment-gateway` contra el sandbox, sin credenciales). En la corrida completa, `aislamiento-cache` falló sus 4 casos porque Docker no pudo publicar el puerto del contenedor de Redis ("address already in use"); **repetida sola: 4 de 4 en verde** |
| Backend: arquitectura         | Sin violaciones (292 módulos, 1 334 dependencias); **24 de 24**                                                                                                                                                                                                                                                                |
| Frontend: Prettier y lint     | Sin diferencias ni errores                                                                                                                                                                                                                                                                                                     |
| Frontend: build               | Sin errores; JavaScript de `react` 286,6 KB (92,2 KB comprimido) e `index` 61,5 KB                                                                                                                                                                                                                                             |
| Frontend: Vitest (un proceso) | 22 archivos, **133 de 133** (525 s con un solo proceso)                                                                                                                                                                                                                                                                        |

### 6.3 Limitaciones conocidas

- **Notificaciones sin pago:** las del proveedor que no corresponden a ningún pago (`SIN_PAGO`) se listan 30
  días en "Pagos por revisar", pero no se pueden marcar resueltas. No hay ruta en el contrato, y el rol de la
  aplicación solo inserta en `provider_event` (C1); resolverlas exigiría una columna o tabla de resolución con
  su permiso.
- **Rotación de la llave TOTP:** cambiar `PLATAFORMA_LLAVE_TOTP` deja ilegibles los secretos guardados. No hay
  rotación: hay que volver a dar de alta al administrador (nuevo secreto y nuevos códigos).
- **Proveedor real:** el adaptador real (Culqi) depende de obtener credenciales del ambiente de pruebas y de
  confirmar que el comercio puede cobrar con Yape (R15). Hasta entonces, todo es con el simulador, y PR20
  contra el sandbox queda omitida.
- **Aviso de Jest:** al terminar `npm test`, Jest avisa a veces que un proceso no cerró a tiempo; todas las
  pruebas pasan y el aviso no cambia el resultado.
