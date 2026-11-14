# Diseño interno de los módulos críticos

**Arquitectura** es la estructura general, los componentes principales y sus decisiones ([componentes](../../02-arquitectura-software/componentes-arquitectonicos.md)). **Diseño de software** es el nivel de clases, métodos, responsabilidades, interfaces y colaboración. Se complementan: este documento baja un nivel.

Flujo interno común: **Controlador → Caso de uso → Entidad → Repositorio (puerto) → Infraestructura (adaptador)**.

| Submódulo             | Estado                                    | Secciones |
| --------------------- | ----------------------------------------- | --------- |
| `citas` (M02)         | Implementado (002)                        | 1         |
| `suscripciones` (M03) | Implementado (001 y 003)                  | 2 y 5     |
| `pagos` (M03)         | Implementado (003), con pasarela simulada | 3         |
| `asistente` (M04)     | **Planificado** (005)                     | 4         |
| M05 Notificaciones    | **Planificado** (004)                     | 7         |

Los nombres de las secciones 1, 2, 3 y 5 son clases reales de `backend/src/modules/`. Los de las secciones 4 y 7 son el **diseño propuesto**: todavía no hay código.

Convención de color de los diagramas: azul grisáceo = sistema propio; naranja = sistema externo; azul claro = datos; borde gris discontinuo = elemento definido que todavía no se usa.

## 1. Submódulo `citas` (M02 Catálogo y citas)

| Elemento                                                                                              | Capa                | Responsabilidad                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CitasController`, `AgendaController`, `HistorialController`                                          | Presentación        | Validan el formato (DTO), toman el actor del token y llaman al caso de uso                                                                           |
| `ConsultarHorarios` (submódulo `catalogo`)                                                            | Aplicación          | Calcula los horarios libres de un servicio con los tramos, los bloqueos y las citas activas del día                                                  |
| `ReservarCita`                                                                                        | Aplicación          | Orquesta: permiso, `SuscripcionesApi.exigirOperacion(RESERVAR)`, servicio y barbero activos, horario de atención, crea la `Cita`, la guarda y audita |
| `CancelarCita`, `CambiarEstadoCita`, `ConsultarAgenda`, `ConsultarHistorial`                          | Aplicación          | Cancelación con antelación (tardía), transiciones con historial, agenda con marca de conflicto e historial del cliente                               |
| `Cita`                                                                                                | Dominio             | Entidad con tenant, barbero, servicio, cliente, rango horario y estado                                                                               |
| `EstadoCita`, `MarcaConflicto`                                                                        | Dominio             | Transiciones válidas; marca "en conflicto" calculada al leer                                                                                         |
| `CitaRepository`                                                                                      | Aplicación (puerto) | `guardar`, `buscarPorIdempotencia`, `buscarParaActualizar`, `actualizarEstado`, `delRango`, `delCliente`                                             |
| `CitaRepositoryPostgres`                                                                              | Infraestructura     | Implementa el puerto; traduce `appointment_no_overlap_barber` a `HorarioNoDisponible` y `appointment_no_overlap_customer` a `CitaSolapadaDelCliente` |
| `CatalogQuery` (submódulo `catalogo`), `BarberiasApi` y `ClientesApi` (M01), `SuscripcionesApi` (M03) | Interfaces          | Consultadas desde `ReservarCita`                                                                                                                     |

### 1.1 Estados de la cita

![Estados de la cita](../../../img/estados-de-la-cita.png)

_Figura 1. Estados de la cita._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
stateDiagram-v2
    [*] --> CONFIRMADA: reservar
    [*] --> PENDIENTE: reserva con adelanto (008)
    PENDIENTE --> CONFIRMADA: confirmar el adelanto
    PENDIENTE --> CANCELADA: cancelar o vencer el adelanto
    CONFIRMADA --> CANCELADA: cancelar
    CONFIRMADA --> COMPLETADA: completar
    CONFIRMADA --> NO_ASISTIO: no asistió
    COMPLETADA --> [*]
    NO_ASISTIO --> [*]
    CANCELADA --> [*]

    classDef implementado fill:#e8eef7,stroke:#3b5b8c,color:#1f2d4a
    classDef planificado fill:#f5f5f5,stroke:#9e9e9e,stroke-dasharray:5 5,color:#424242
    class PENDIENTE,CONFIRMADA,CANCELADA,COMPLETADA,NO_ASISTIO implementado
```

</details>

Leyenda: todos los estados están implementados (desde 008, también `PENDIENTE`). La imagen `estados-de-la-cita.png` está **por regenerar** desde este código: todavía muestra `PENDIENTE` en gris.

Sin adelanto, toda cita nueva nace `CONFIRMADA` (FR-035a de 002). **Con el adelanto activo (008, ADR-033)**, la reserva del cliente nace `PENDIENTE` (ocupa el horario igual) y solo pasa a `CONFIRMADA` con `aprobar` cuando el propietario confirma el pago del adelanto (`ConfirmarAdelanto`); la aprobación de 002 (`POST /citas/{id}/estado`) responde 409 `ADELANTO_PENDIENTE` en una cita con adelanto. La tarea `vencer-adelantos` la cancela sola (`vencerAdelanto`: sin marca de tardía ni autor) si vence sin pago o sin revisión. El cliente cancela hasta la hora de inicio; el propietario, siempre. `COMPLETADA` y `NO_ASISTIO` se marcan desde la hora de inicio. La reprogramación (RF13, implementada en 004) cambia la hora sin otra transición, salvo una: una cita `PENDIENTE` sin adelanto queda `CONFIRMADA` (FR-007 de 004), y la que espera su adelanto sigue `PENDIENTE` (008, R11; solo la reprograma el propietario). La cita cambia de hora (y, si se pide, de barbero) en una sola transacción, con la misma restricción de exclusión que una reserva; sube su `version` y deja una fila en `appointment_reschedule`. `COMPLETADA`, `NO_ASISTIO` y `CANCELADA` son finales; cualquier otra transición lanza `TransicionInvalida` (422 `TRANSICION_INVALIDA`). Cada cambio, incluida la creación, deja una fila en `appointment_status_history` en la misma transacción, con la fila de la cita bloqueada (`FOR UPDATE`).

Solo `PENDIENTE` y `CONFIRMADA` ocupan el horario. Dos restricciones de exclusión de PostgreSQL sobre `period tstzrange [)` usan esos estados (principio IV):

- `appointment_no_overlap_barber`: nunca dos citas activas del mismo barbero que se solapen (→ 409 `HORARIO_NO_DISPONIBLE`);
- `appointment_no_overlap_customer`: un cliente no tiene dos citas activas que se solapen (→ 409 `CITA_SOLAPADA_DEL_CLIENTE`).

**Cancelación tardía (FR-038 de 002):** la del cliente con menos antelación que la mínima de la barbería se acepta y queda marcada (`late_cancellation`); la del propietario, nunca.

**Marca "en conflicto" (FR-016 y FR-005 de 002):** no se guarda. La agenda la calcula al leer (`MarcaConflicto`) comparando cada cita activa con los bloqueos y los tramos vigentes del día.

Evidencia: `backend/src/modules/catalogo-citas/citas/domain/estado-cita.ts`, `citas/domain/cita.ts`, `citas/domain/marca-conflicto.ts`, `backend/migrations/0011_citas.ts`; pruebas `backend/test/unit/citas/transiciones.spec.ts` e `integration/citas/agenda-estados.spec.ts`.

### 1.2 Secuencia de reserva

![Secuencia de reserva](../../../img/secuencia-reserva.png)

_Figura 2. Reserva de una cita (implementado)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant FE as Interfaz web
    participant UC as ReservarCita
    participant SUS as SuscripcionesApi (M03)
    participant CAT as CatalogQuery
    participant BD as PostgreSQL
    C->>FE: elige servicio, barbero, día y hora
    FE->>UC: POST /citas (token + Idempotency-Key)
    UC->>SUS: exigirOperacion(RESERVAR)
    SUS-->>UC: permitido
    UC->>CAT: servicio, barbero, tramos y bloqueos
    CAT-->>UC: datos del catálogo
    UC->>BD: INSERT appointment (tenant fijado, RLS)
    alt horario libre
        BD-->>UC: ok + historial + auditoría
        UC-->>FE: 201 cita CONFIRMADA
    else otra cita activa se solapa
        BD-->>UC: violación de exclusión
        UC-->>FE: 409 HORARIO_NO_DISPONIBLE
    else misma Idempotency-Key repetida
        UC-->>FE: 200 la cita ya creada
    end
```

</details>

El controlador (`CitasController`) y el repositorio (`CitaRepositoryPostgres`) se omiten para que se lea de un vistazo. Desde 004, la reserva publica además `CitaCreada` (y `RecordatorioDeCita`, si faltan 2 h o más) en la misma transacción, para el aviso al cliente; el diagrama no lo muestra.

Evidencia: `backend/src/modules/catalogo-citas/citas/presentation/citas.controller.ts`, `citas/application/reservar-cita.ts`, `citas/infrastructure/`; pruebas `backend/test/integration/citas/reservar.spec.ts` y `concurrencia-reservas.spec.ts` (PR16: 200 solicitudes simultáneas, una sola cita).

## 2. Submódulo `suscripciones` (M03 Suscripciones y pagos)

| Elemento                                                                                               | Capa                         | Responsabilidad                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SuscripcionController`                                                                                | Presentación                 | Planes, estado de la suscripción y estado operativo                                                                |
| `IniciarPruebaGratuita`, `AvanzarSuscripcion`, `VencerSuscripciones`, `ExigirOperacion`, `PlanVigente` | Aplicación                   | Prueba gratuita al registrar; transiciones automáticas; tarea de vencimiento; restricción por estado; plan vigente |
| `SuspenderSuscripcion`, `ReactivarSuscripcion`, `ActivacionManual` (submódulo `plataforma`)            | Aplicación                   | Operaciones del administrador sobre una barbería                                                                   |
| `Suscripcion`, `Plan`                                                                                  | Dominio                      | Entidades con estado, fechas y límites del plan                                                                    |
| `estado-suscripcion.ts` (`siguientePaso`, `suspender`, `reactivar`), `periodo.ts`                      | Dominio                      | Máquina de estados por fechas y cobertura (prueba y períodos pagados); 7 días de gracia                            |
| `PoliticaDeOperacion`                                                                                  | Dominio                      | Qué acciones permite cada estado (sección 2.2)                                                                     |
| `SuscripcionesApi`                                                                                     | Interfaz pública del módulo  | `exigirOperacion(tenant, acción)`, estado operativo, prueba gratuita                                               |
| `SuscripcionRepository` / `KyselySuscripcionRepository`                                                | Aplicación / Infraestructura | Persistencia con bloqueo de fila                                                                                   |

### 2.1 Flujo de suscripción

![Estados de la suscripción](../../../img/flujo-suscripcion.png)

_Figura 3. Estados de la suscripción._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
flowchart TB
    START(("inicio")):::inicio
    TRIAL["TRIAL<br/>prueba de 14 días"]
    ACTIVE["ACTIVE<br/>período pagado"]
    PAST["PAST_DUE<br/>7 días de gracia"]
    EXP["EXPIRED<br/>vencida"]
    SUS["SUSPENDED<br/>suspendida por el administrador"]
    POR["ESTADO_POR_FECHAS<br/>vuelve a TRIAL, ACTIVE,<br/>PAST_DUE o EXPIRED"]
    CAN["CANCELLED<br/>definido, ningún flujo lo usa"]:::planificado
    POR ~~~ CAN

    START -->|"registro"| TRIAL
    TRIAL -->|"primer período pagado"| ACTIVE
    TRIAL -->|"vence la prueba"| EXP
    ACTIVE -->|"termina el período"| PAST
    PAST -->|"pasa la gracia"| EXP
    PAST -->|"pago aprobado"| ACTIVE
    EXP -->|"pago aprobado"| ACTIVE
    ACTIVE -.->|"administrador (desde cualquier estado)"| SUS
    SUS -->|"reactivar"| POR

    classDef inicio fill:#424242,stroke:#424242,color:#ffffff
    classDef implementado fill:#e8eef7,stroke:#3b5b8c,color:#1f2d4a
    classDef planificado fill:#f5f5f5,stroke:#9e9e9e,stroke-dasharray:5 5,color:#424242
    classDef externo fill:#fff3e0,stroke:#ef6c00,color:#e65100
    class TRIAL,ACTIVE,PAST,EXP,SUS,POR implementado
```

</details>

Leyenda: gris discontinuo = estado que existe en la base y en el dominio, pero al que ningún flujo lleva todavía (no hay una operación "cancelar suscripción"). `ESTADO_POR_FECHAS` significa que, al reactivar, la suscripción vuelve a TRIAL, ACTIVE, PAST_DUE o EXPIRED según su cobertura; los días suspendidos no se devuelven.

Las transiciones automáticas las aplica la tarea `vencer-suscripciones` y la aprobación de un pago, de a un paso y con la fecha que les correspondía (cada paso se audita). Cambiar de plan es pagar el período siguiente con otro plan.

Evidencia: `backend/src/modules/suscripciones-pagos/suscripciones/domain/estado-suscripcion.ts` y `periodo.ts`, `suscripciones/application/vencer-suscripciones.ts`, `plataforma/application/suscripciones-plataforma.ts`; pruebas `backend/test/unit/suscripciones/estado-suscripcion.spec.ts`, `periodos.spec.ts`, `integration/tareas/vencimiento.spec.ts` y `vencimiento-dos-replicas.spec.ts`.

### 2.2 Qué permite cada estado

| Estado    | Reservar | Gestionar citas existentes | Configurar catálogo | Gestionar usuarios | Pagar |
| --------- | -------- | -------------------------- | ------------------- | ------------------ | ----- |
| TRIAL     | Sí       | Sí                         | Sí                  | Sí                 | Sí    |
| ACTIVE    | Sí       | Sí                         | Sí                  | Sí                 | Sí    |
| PAST_DUE  | Sí       | Sí                         | Sí                  | Sí                 | Sí    |
| EXPIRED   | **No**   | Sí                         | **No**              | **No**             | Sí    |
| CANCELLED | **No**   | Sí                         | **No**              | **No**             | Sí    |
| SUSPENDED | **No**   | Sí                         | **No**              | **No**             | Sí    |

Las lecturas nunca se restringen. Una acción no permitida responde 403 `SUSCRIPCION_NO_PERMITE`. Aparte de la suscripción, el administrador puede suspender **la barbería** (`tenant.status = SUSPENDIDA`): entonces nadie de esa barbería puede iniciar sesión y su enlace público responde "barbería no disponible". Los datos nunca se borran por cambiar de estado.

Evidencia: `backend/src/modules/suscripciones-pagos/suscripciones/domain/politica-de-operacion.ts`; contrato `specs/003-suscripciones-pagos/contracts/restricciones-estado.md`; prueba `backend/test/integration/suscripciones/restricciones-estado.spec.ts` (PR25, celda por celda).

## 3. Submódulo `pagos` (M03 Suscripciones y pagos)

| Elemento                                                                                                  | Capa                         | Responsabilidad                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SuscripcionController`                                                                                   | Presentación                 | Inicia el pago, historial, detalle y comprobante (con sesión del propietario)                                                                                        |
| `NotificacionesController`                                                                                | Presentación                 | `POST /pagos/notificaciones`: recibe el aviso **sin token de usuario** y entrega el cuerpo crudo y los encabezados al caso de uso                                    |
| `IniciarPago`                                                                                             | Aplicación                   | Crea el pago (Yape o transferencia), reutiliza el abierto si es el mismo intento y pide la sesión de pago al `PaymentGateway`                                        |
| `RecibirNotificacion`                                                                                     | Aplicación                   | Verifica la firma, encuentra el tenant por la referencia y aplica el resultado con el evento en **una** transacción                                                  |
| `AplicarResultadoDelProveedor`                                                                            | Aplicación                   | Única función que aplica un resultado: la usan la notificación, la conciliación, la revisión del comprobante y la activación manual                                  |
| `ConciliarPagos`, `ExpirarTransferencias`                                                                 | Aplicación                   | Tareas programadas: consultan los pendientes de más de 10 min y expiran los de 24 h; expiran transferencias sin comprobante a los 7 días                             |
| `SubirComprobante`; `RevisarComprobante` y `ResolverRevision` (submódulo `plataforma`)                    | Aplicación                   | Transferencia con comprobante revisado por el administrador                                                                                                          |
| `Pago`                                                                                                    | Dominio                      | Estados PENDIENTE, ESPERANDO_COMPROBANTE, EN_REVISION, APROBADO, RECHAZADO, ANULADO, EXPIRADO y sus transiciones                                                     |
| `PaymentGateway`                                                                                          | Aplicación (puerto)          | `crearSesionDePago`, `consultarPago`, `cancelarSesion`, `verificarNotificacion`, `limitesYape`                                                                       |
| `PasarelaSimuladaAdapter`                                                                                 | Infraestructura              | Habla por HTTP con `backend/simulador-pagos/`; tiempo límite de 2 s e interruptor. El adaptador real (`culqi`) **no existe**: `fabrica-pasarela.ts` lo rechaza (R15) |
| `PagoRepository`, `EventoProveedorRepository` / `KyselyPagoRepository`, `KyselyEventoProveedorRepository` | Aplicación / Infraestructura | Persistencia; `provider_event.event_id` como clave de idempotencia                                                                                                   |

### 3.1 Pago con Yape (pasarela simulada) y notificación firmada

![Pago de la suscripción con notificación firmada](../../../img/secuencia-pago-suscripcion.png)

_Figura 4. Pago de la suscripción con la pasarela simulada (implementado)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    actor P as Propietario
    participant FE as Interfaz web
    participant API as Backend (M03)
    participant SIM as Pasarela simulada
    participant BD as PostgreSQL
    P->>FE: elige plan y Yape
    FE->>API: POST /suscripcion/pagos
    API->>BD: payment PENDIENTE (uno abierto por suscripción)
    API->>SIM: crearSesionDePago (2 s, interruptor)
    SIM-->>API: checkout_url
    API-->>FE: 201 con la URL
    P->>SIM: aprueba en la página del simulador
    SIM->>API: POST /pagos/notificaciones (X-Firma, por Nginx)
    API->>API: verifica HMAC-SHA256 y ±5 min
    alt firma inválida o vencida
        API-->>SIM: 401 sin efecto (log PAGO_NOTIFICACION_RECHAZADA)
    else firma válida
        API->>BD: una transacción con el tenant del pago:<br/>pago APROBADO, período, suscripción ACTIVE<br/>e INSERT provider_event
        alt evento nuevo
            API-->>SIM: 200 aplicado
        else evento_id repetido
            API-->>SIM: 200 sin efecto (se deshace todo)
        end
    end
```

</details>

Leyenda: todo lo de esta secuencia está implementado; la pasarela es el simulador de `backend/simulador-pagos/` (sistema externo simulado). La confirmación nunca la da el navegador al volver: solo la notificación firmada o la conciliación. Con la pasarela caída o lenta, el propietario recibe 503 `PAGO_EN_LINEA_NO_DISPONIBLE` en 3 s o menos y puede pagar por transferencia.

Evidencia: `backend/src/modules/suscripciones-pagos/pagos/application/iniciar-pago.ts`, `recibir-notificacion.ts`, `aplicar-resultado.ts`, `pagos/presentation/notificaciones.controller.ts`, `pagos/infrastructure/pasarela-simulada.adapter.ts`, `backend/simulador-pagos/firma.ts`; pruebas `backend/test/integration/pagos/notificaciones.spec.ts` (PR17), `iniciar-pago.spec.ts`, `proveedor-caido.spec.ts` (PR06) y `gateway-simulado.spec.ts` (PR20).

### 3.2 Conciliación de pagos pendientes

![Conciliación de pagos pendientes](../../../img/secuencia-conciliacion.png)

_Figura 5. Conciliación: la tarea programada recupera los pagos cuya notificación no llegó (implementado)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    participant T as Tarea conciliar-pagos
    participant BD as PostgreSQL
    participant SIM as Pasarela simulada
    T->>BD: pg_try_advisory_lock (una sola réplica)
    T->>BD: pagos PENDIENTE de más de 10 min
    loop cada pago
        T->>SIM: consultarPago(referencia)
        alt aprobado o rechazado
            T->>BD: misma AplicarResultadoDelProveedor<br/>(transacción con su tenant)
        else sigue pendiente tras 24 h
            T->>BD: pago EXPIRADO
            T->>SIM: cancelarSesion
        else pasarela caída
            Note over T: el pago no cambia,<br/>se reintenta en la siguiente corrida
        end
    end
    T->>BD: scheduled_job_run (solo conteos)
```

</details>

La tarea corre cada `TAREAS_INTERVALO_MS` (5 min por defecto) en las dos réplicas; el candado hace que solo una procese cada ciclo. Si la notificación llega a la vez que la conciliación, el bloqueo de la fila y la transición condicional dejan un solo efecto.

Evidencia: `backend/src/modules/suscripciones-pagos/pagos/application/conciliar-pagos.ts`, `backend/src/shared/tareas/ejecutor-tareas.ts`, `shared/persistence/tareas-postgres.ts`, `backend/src/host/tareas.ts`, `backend/migrations/0017_tareas.ts`; pruebas `backend/test/integration/pagos/conciliacion.spec.ts`, `tareas/ejecutor-postgres.spec.ts` y `test/unit/shared/ejecutor-tareas.spec.ts`.

## 4. Submódulo `asistente` (M04 Asistente IA y reportes)

**Planificado (005). No hay código de este submódulo.** La tabla y el diagrama son el diseño propuesto ([ADR-008](../../01-analisis-de-sistema/07-decisiones-arquitectonicas.md)); los nombres se confirmarán en la especificación de 005.

| Elemento propuesto                                   | Capa                | Responsabilidad                                                                  |
| ---------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `AsistenteController`                                | Presentación        | Recibe el mensaje; la cuota se aplica antes                                      |
| `ConsultaIAAutorizada`                               | Aplicación          | Orquesta: contexto → intención estructurada → herramienta cerrada → respuesta    |
| `HerramientaIA` (interfaz)                           | Aplicación          | `nombre`, `rolesPermitidos`, `esSensible`, `ejecutar(params, contexto)`          |
| Herramientas (consultar servicios y horarios libres) | Aplicación          | Llaman a casos de uso existentes de M02 (`ConsultarHorarios`, `ListarServicios`) |
| `AIProvider`                                         | Aplicación (puerto) | `interpretar(mensaje, herramientasPermitidas)`, `redactarRespuesta(resultados)`  |
| Adaptador del proveedor y simulador                  | Infraestructura     | Proveedor de IA sin elegir                                                       |

### 4.1 Secuencia del asistente (planificada)

![Secuencia del asistente de IA (planificada)](../../../img/secuencia-asistente-ia.png)

_Figura 6. Secuencia propuesta del asistente de IA (planificado, 005)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant API as Backend: ConsultaIAAutorizada
    participant IA as Proveedor de IA
    participant M02 as Casos de uso de M02
    U->>API: mensaje en lenguaje natural (token)
    API->>API: cuota y herramientas permitidas para el rol
    API->>IA: mensaje + herramientas, sin secretos
    alt proveedor disponible
        IA-->>API: intención estructurada
        API->>M02: herramienta cerrada con los permisos del usuario
        M02-->>API: datos reales
        API->>IA: redactar respuesta
        IA-->>API: texto
        API-->>U: respuesta con datos del backend
    else proveedor caído
        API-->>U: aviso y enlace a la reserva manual
    end
```

</details>

Leyenda: todo este diagrama está **planificado**. Reglas propuestas: la IA nunca recibe SQL ni acceso a la base; la disponibilidad siempre viene del cálculo de M02; una reserva solo se confirma con `ReservarCita` tras confirmación explícita del usuario.

Evidencia: solo diseño, sin código. Decisión en ADR-008 (Propuesto) y requisitos RF27 y RF28.

## 5. Clases del submódulo `suscripciones` (resumen)

![Clases del submódulo de suscripciones](../../../img/clases-suscripciones.png)

_Figura 7. Clases principales del submódulo `suscripciones` (implementado)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
classDiagram
    class Suscripcion {
        +estado EstadoSuscripcion
        +planId
        +vencePruebaEn
        +finCobertura
        +graciaHasta
        +iniciarPrueba(plan, ahora)$
        +cobertura(periodos)
        +planVigente(periodos, ahora)
    }
    class Plan {
        +codigo
        +precioCentimos
        +maxUsuarios
        +maxBarberos
        +esContratable
    }
    class MaquinaDeEstados {
        <<estado-suscripcion.ts>>
        +siguientePaso(situacion, ahora)
        +suspender(estado)
        +reactivar(estado, cobertura, ahora)
    }
    class PoliticaDeOperacion {
        +permite(estado, accion)
        +exigir(estado, accion)
    }
    class SuscripcionRepository {
        <<puerto>>
    }
    class KyselySuscripcionRepository
    Suscripcion --> Plan
    MaquinaDeEstados ..> Suscripcion : decide el paso
    PoliticaDeOperacion ..> Suscripcion : lee el estado
    SuscripcionRepository <|.. KyselySuscripcionRepository
    SuscripcionRepository ..> Suscripcion
```

</details>

Leyenda: todo implementado. `MaquinaDeEstados` no es una clase: agrupa las funciones puras de `estado-suscripcion.ts`. Los planes son datos, no subclases: TRIAL (14 días, 5 usuarios y 5 barberos), BASICO (S/ 49, 3 y 3) y PRO (S/ 89, 8 y 8), sembrados por las migraciones 0004 y 0014.

Evidencia: `backend/src/modules/suscripciones-pagos/suscripciones/domain/suscripcion.ts`, `plan.ts`, `estado-suscripcion.ts`, `politica-de-operacion.ts`, `suscripciones/application/ports/suscripcion-repository.ts`, `suscripciones/infrastructure/`; `backend/migrations/0004_suscripciones.ts` y `0014_planes_y_suscripcion.ts`; prueba `backend/test/unit/suscripciones/politica-de-operacion.spec.ts`.

## 6. Módulos no críticos

`identidad`, `barberias`, `clientes` y `catalogo` siguen el mismo flujo con casos de uso delgados (ver la simplificación proporcional en [enfoque](../../02-arquitectura-software/enfoque-arquitectonico.md#6-justificación-honesta-frente-al-criterio-de-la-guía)). El submódulo `reportes` (M04) está planificado.

## 7. M05 Notificaciones

**Implementado (004)**, en `backend/src/modules/notificaciones/`. El cliente recibe la **fecha y hora de su cita** por correo o por WhatsApp (simulado), según el canal que elija (RF30, RF33, HU25), y el propietario recibe los avisos de su suscripción (US5 de 004). Decisiones: [ADR-013](../../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-013-notificaciones-multicanal-al-cliente-correo-y-whatsapp) (revisada), ADR-025 y ADR-026 (Aceptadas el 2026-11-04).

| Elemento                                                   | Capa                          | Responsabilidad                                                                                                     |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ManejadoresDeCita`, `ManejadorRecordatorio`, `ManejadoresDeSuscripcion`, `ManejadoresDeAdelanto` (008) | Aplicación          | Reciben los eventos del bus (`CitaCreada`, `CitaCancelada`, `CitaReprogramada`, `RecordatorioDeCita`, los cinco de suscripción y, desde 008, los cinco del adelanto) y crean un aviso `PENDIENTE` por destinatario, idempotente por evento y destinatario |
| `EnviarAvisos` (tarea `enviar-avisos`)                     | Aplicación                    | Reclama los avisos pendientes, lee el contacto en M01 al enviar, elige el canal, compone el texto y envía por el puerto; reintenta y usa el correo de respaldo |
| `elegirCanal`, `plantillas`, `politica-reintentos`         | Dominio                       | Reglas puras: canal según preferencia y consentimiento vigente, textos con datos mínimos y esperas entre intentos |
| `NotificationChannel`                                      | Aplicación (puerto)           | `enviar(mensaje)`                                                                                                   |
| `CanalCorreoSmtp`, `CanalWhatsappSimulado`                 | Infraestructura (adaptadores) | Implementan el puerto, con tiempo límite y el `Interruptor` de M06                                                  |
| `KyselyAvisoRepository`, `AvisosPendientesPlataforma`      | Infraestructura               | La tabla `notification` con RLS, y la lista de pendientes de todas las barberías con el rol de la plataforma        |

**Dependencias (revisión de ADR-013).** M05 depende de M06 (bus de eventos y tareas) y de M01, **solo para leer**, al enviar: el canal, el consentimiento vigente y el correo del destinatario. El evento de M02 lleva los datos mínimos de la cita, **sin datos de contacto**.

![Notificación de una cita](../../../img/secuencia-notificacion-cita.png)

_Figura 8. Notificación de una cita al cliente (004)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    participant M02 as M02 Catálogo y citas
    participant M05 as M05 Notificaciones
    participant WA as Servicio de WhatsApp
    participant EM as Servicio de correo
    actor C as Cliente
    M02->>M05: evento CitaCreada (datos mínimos)
    M05->>M05: canal elegido y consentimiento
    alt WhatsApp con consentimiento
        M05->>WA: mensaje con fecha y hora
        alt entregado
            WA-->>C: WhatsApp
        else falla
            M05->>EM: correo de respaldo
            EM-->>C: correo
        end
    else correo
        M05->>EM: mensaje con fecha y hora
        EM-->>C: correo
    end
```

</details>

Leyenda: diagrama simplificado de lo **implementado** (004): el evento pasa por la salida transaccional de M06 y el envío lo hace la tarea `enviar-avisos`, que el diagrama no muestra. Reglas: el envío es asíncrono y nunca revierte la reserva; WhatsApp solo con número y consentimiento vigente para ese número; tras 3 fallos de WhatsApp, con su circuito abierto o con el número rechazado, el mismo aviso sale una vez por correo; los mensajes solo llevan barbería, servicio, barbero, fecha y hora. El servicio de WhatsApp es un **simulador**: las condiciones del proveedor real (plantillas, costos) siguen por verificar.

Evidencia: `backend/src/modules/notificaciones/` (`application/enviar-avisos.ts`, `domain/eleccion-canal.ts`, `domain/plantillas.ts`, `infrastructure/canal-correo-smtp.ts`, `infrastructure/canal-whatsapp-simulado.ts`); pruebas `notificaciones/avisos-cita`, `correo-caido`, `respaldo-whatsapp`, `whatsapp-sin-consentimiento` y `salida-eventos-dos-instancias`. Requisitos RF30 y RF33; ADR-013, ADR-025 y ADR-026.

### 7.1 Recordatorio del día de la cita y respuesta del cliente

**Implementado (004).** El mismo día de la cita, **2 horas antes (fijo)**, el sistema avisa al cliente y le pregunta si podrá asistir (RF34, HU28). El recordatorio configurable por barbería quedó como evolución futura (revisión de ADR-013).

| Acción del enlace       | Qué ocurre                                                    | Reglas                                                                   |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Confirmo asistencia** | Se registra la confirmación; la agenda la muestra             | No cambia el estado de la cita                                           |
| **Cancelar**            | `CancelarCita` pasa la cita a CANCELADA y libera el horario   | Mismas reglas que la cancelación del cliente, incluida la tardía         |
| **Reprogramar**         | Abre los horarios libres con la cita precargada               | Misma validación y restricción de exclusión que una reserva nueva (RF13) |
| Sin respuesta           | La cita **no se cancela automáticamente**                     | Una cancelación automática sería evolución futura                        |

Los enlaces son de un solo uso, firmados (HMAC), con vencimiento a la hora de inicio de la cita y limitados a esa cita y a su tenant (ADR-032). El uso queda en `appointment_link_use` y los rechazos, con el hash de la IP, en `action_link_attempt`.

![Recordatorio del día de la cita](../../../img/secuencia-recordatorio-del-dia.png)

_Figura 9. Recordatorio del día y respuesta del cliente (004)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    participant T as Tarea de recordatorios
    participant M05 as M05 Notificaciones
    actor C as Cliente
    participant M02 as M02 Catálogo y citas
    T->>M05: recordatorios que vencen (con candado)
    M05->>C: "Hoy tienes cita a las HH:MM" + 3 enlaces
    C->>M02: abre un enlace firmado
    M02->>M02: verifica firma, vencimiento, cita, tenant y un solo uso
    alt confirmo asistencia
        M02-->>C: gracias, te esperamos
    else cancelar
        M02-->>C: cita cancelada
    else reprogramar
        M02-->>C: horarios libres con la cita precargada
    end
```

</details>

Leyenda: diagrama simplificado de lo **implementado** (004): la "tarea de recordatorios" son el evento `RecordatorioDeCita`, publicado al reservar o reprogramar para `inicio − 2 h`, y las tareas `despachar-eventos` y `enviar-avisos`, todas con el candado de ADR-024.

Evidencia: `backend/src/shared/enlaces/enlaces-firmados.ts`, `backend/src/modules/notificaciones/application/manejador-recordatorio.ts` y las acciones por enlace de `catalogo-citas/citas/`; pruebas `enlaces/recordatorio`, `enlaces-acciones`, `enlaces-rechazos` y `aislamiento/aislamiento-avisos`. Requisito RF34 e historia HU28.
