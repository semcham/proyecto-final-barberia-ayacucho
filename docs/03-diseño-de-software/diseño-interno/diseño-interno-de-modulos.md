# Diseño interno de los módulos críticos

**Arquitectura** es la estructura general, los componentes principales y sus decisiones ([componentes](../../02-arquitectura-software/componentes-arquitectonicos.md)). **Diseño de software** es el nivel de clases, métodos, responsabilidades, interfaces y colaboración. Se complementan: este documento baja un nivel.

Flujo interno común: **Controlador → Caso de uso → Entidad → Repositorio (puerto) → Infraestructura (adaptador)**. Los submódulos críticos son `citas` (M02), `suscripciones` y `pagos` (M03) y `asistente` (M04). Cada submódulo tiene sus cuatro capas. Estado: **planificado**.

## 1. Submódulo `citas` (M02 Catálogo y citas)

| Elemento                                                                | Capa                                                        | Responsabilidad                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CitasController`                                                       | Presentación                                                | Valida formato (fechas, identificadores), toma el contexto de la solicitud y llama al caso de uso                |
| `ConsultarDisponibilidad`                                               | Aplicación                                                  | Obtiene horario y bloqueos (`catalogo`, mismo módulo), citas ocupadas y calcula huecos para un servicio          |
| `ReservarCita`                                                          | Aplicación                                                  | Orquesta: verifica `SubscriptionPolicy`, valida servicio y barbero, crea la entidad, la persiste, publica evento |
| `CancelarCita`, `ReprogramarCita`                                       | Aplicación                                                  | Aplican la política de antelación y las transiciones de estado                                                   |
| `Cita`                                                                  | Dominio                                                     | Entidad con identidad, tenant, barbero, servicio, cliente, `RangoHorario`, estado                                |
| `RangoHorario`                                                          | Dominio                                                     | Objeto de valor: inicio < fin, duración, operación `seSolapaCon`                                                 |
| `EstadoCita`                                                            | Dominio                                                     | Transiciones válidas                                                                                             |
| `CitaRepository`                                                        | Aplicación (puerto)                                         | `guardar`, `buscarPorId`, `listarPorBarbero`, `listarPorRango`                                                   |
| `CitaRepositoryPostgres`                                                | Infraestructura                                             | Implementa el puerto; traduce la violación de exclusión a `HorarioNoDisponible`                                  |
| `CatalogQuery` (submódulo `catalogo`, M02) y `SubscriptionPolicy` (M03) | Interfaz del mismo módulo y interfaz pública de otro módulo | Consultadas desde `ReservarCita`                                                                                 |

### 1.1 Estados de la cita

![1.1 Estados de la cita](../../../img/estados-de-la-cita.png)

_Figura. 1.1 Estados de la cita._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
stateDiagram-v2
    [*] --> PENDING: reserva requiere aprobación
    [*] --> CONFIRMED: reserva directa
    PENDING --> CONFIRMED: aprobar
    PENDING --> CANCELLED: cancelar o rechazar
    CONFIRMED --> CANCELLED: cancelar
    CONFIRMED --> CONFIRMED: reprogramar
    CONFIRMED --> COMPLETED: marcar atendida
    CONFIRMED --> NO_SHOW: marcar inasistencia
    COMPLETED --> [*]
    NO_SHOW --> [*]
    CANCELLED --> [*]
```

</details>

Solo `PENDING` y `CONFIRMED` ocupan el horario (la restricción de exclusión usa esos estados). Cualquier otra transición lanza un error de dominio.

### 1.2 Secuencia de reserva

![1.2 Secuencia de reserva](../../../img/secuencia-reserva.png)

_Figura. 1.2 Secuencia de reserva._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant FE as Interfaz web
    participant API as CitasController
    participant UC as ReservarCita
    participant SUB as SubscriptionPolicy (M03)
    participant CAT as CatalogQuery (M02, catálogo)
    participant REP as CitaRepository
    participant DB as PostgreSQL
    participant BUS as EventBus (M06)
    C->>FE: Elige servicio, barbero, fecha y hora
    FE->>API: POST /citas con token
    API->>API: Valida formato y toma tenant del token
    API->>UC: reservar(comando, contexto)
    UC->>SUB: puedeOperar(tenant)
    SUB-->>UC: permitido
    UC->>CAT: servicio y barbero activos, horario configurado
    CAT-->>UC: datos del catálogo
    UC->>UC: Crea Cita con RangoHorario y valida reglas
    UC->>REP: guardar(cita)
    REP->>DB: BEGIN, fija tenant, INSERT
    alt Horario libre
        DB-->>REP: OK
        REP-->>UC: cita guardada
        UC->>BUS: publica CitaCreada
        UC-->>API: confirmación
        API-->>FE: 201 con datos de la cita
    else Conflicto de horario
        DB-->>REP: violación de exclusión
        REP-->>UC: HorarioNoDisponible
        UC-->>API: error de dominio
        API-->>FE: 409 horario no disponible
    end
```

</details>

## 2. Submódulo `suscripciones` (M03 Suscripciones y pagos)

| Elemento                                                                                                                  | Capa                          | Responsabilidad                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `SuscripcionController`                                                                                                   | Presentación                  | Consulta de estado, contratación, cambio de plan                       |
| `IniciarPrueba`, `ContratarPlan`, `ActivarPorPago`, `SuspenderSuscripcion`, `ReactivarSuscripcion`, `VencerSuscripciones` | Aplicación                    | Casos de uso; los dos últimos también se ejecutan por tarea programada |
| `Suscripcion`                                                                                                             | Dominio                       | Entidad con estado, fechas y reglas de transición                      |
| `EstadoSuscripcion`                                                                                                       | Dominio                       | TRIAL, ACTIVE, PAST_DUE, EXPIRED, CANCELLED, SUSPENDED                 |
| `PlanPolicy` (Strategy)                                                                                                   | Dominio                       | Reglas por plan: límites de barberos/usuarios, IA habilitada           |
| `SubscriptionPolicy`                                                                                                      | Aplicación (interfaz pública) | `puedeOperar(tenant)`, `limitesDelPlan(tenant)`                        |
| `SubscriptionRepository` / `...Postgres`                                                                                  | Aplicación / Infraestructura  | Persistencia con bloqueo de fila                                       |

### 2.1 Flujo de suscripción

![2.1 Flujo de suscripción](../../../img/flujo-suscripcion.png)

_Figura. 2.1 Flujo de suscripción._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
flowchart TD
    A["Alta de la barbería"] --> B["TRIAL: prueba gratuita"]
    B -->|"El propietario contrata y paga"| C["Pago en proceso"]
    B -->|"Vence la prueba sin pago"| X["EXPIRED"]
    C -->|"Confirmación oficial del proveedor"| D["ACTIVE"]
    C -->|"Rechazado o pendiente"| B2["Se mantiene el estado y se avisa"]
    D -->|"Llega el fin del periodo"| E{"¿Renovación pagada?"}
    E -->|"Sí"| D
    E -->|"No"| F["PAST_DUE: periodo de gracia"]
    F -->|"Pago confirmado"| D
    F -->|"Termina la gracia"| X
    D -->|"El propietario cancela"| G["CANCELLED: opera hasta fin del periodo"]
    G -->|"Termina el periodo"| X
    D -->|"Decisión del administrador"| H["SUSPENDED"]
    F -->|"Decisión del administrador"| H
    B -->|"Decisión del administrador"| H
    H -->|"Reactivación"| D
    X -->|"Nueva contratación y pago"| C
```

</details>

### 2.2 Funciones disponibles según el estado

| Estado    | Reservas nuevas                 | Gestión (servicios, barberos) | Lectura de agenda y reportes                 | Asistente de IA      | Aviso             |
| --------- | ------------------------------- | ----------------------------- | -------------------------------------------- | -------------------- | ----------------- |
| TRIAL     | Sí (límites del plan de prueba) | Sí                            | Sí                                           | Según plan de prueba | Días restantes    |
| ACTIVE    | Sí                              | Sí                            | Sí                                           | Según plan           | —                 |
| PAST_DUE  | Sí (gracia propuesta: 7 días)   | Sí                            | Sí                                           | No                   | Pago pendiente    |
| CANCELLED | Hasta fin del periodo           | Hasta fin del periodo         | Sí                                           | No                   | Fecha de fin      |
| EXPIRED   | **No**                          | Solo lectura                  | Sí (exportación de datos)                    | No                   | Reactivar         |
| SUSPENDED | **No**                          | **No**                        | **No** para la barbería; solo administración | No                   | Contactar soporte |

Los datos nunca se borran por cambiar de estado.

## 3. Submódulo `pagos` (M03 Suscripciones y pagos)

| Elemento                                                 | Capa                         | Responsabilidad                                                                                        |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PagosController`                                        | Presentación                 | Inicia pago (autenticado)                                                                              |
| `WebhookController`                                      | Presentación                 | Recibe notificaciones **sin token de usuario**; entrega el cuerpo crudo y las cabeceras al caso de uso |
| `IniciarPagoDeSuscripcion`                               | Aplicación                   | Crea `Pago` en estado PENDING y pide al `PaymentGateway` una orden/checkout                            |
| `ProcesarConfirmacionDePago`                             | Aplicación                   | Verifica autenticidad, registra el evento (único), actualiza el pago y publica `PagoConfirmado`        |
| `ConciliarPagosPendientes`                               | Aplicación                   | Consulta al proveedor los pagos PENDING antiguos                                                       |
| `Pago`, `EstadoPago`                                     | Dominio                      | PENDING, CONFIRMED, REJECTED, EXPIRED; transiciones válidas                                            |
| `PaymentGateway`                                         | Aplicación (puerto)          | `crearOrden`, `verificarNotificacion`, `consultarPago`                                                 |
| `CulqiPaymentGateway` (candidato) / `FakePaymentGateway` | Infraestructura              | Adaptador real y simulador de pruebas                                                                  |
| `PagoRepository`                                         | Aplicación / Infraestructura | Persistencia y `webhook_event` único                                                                   |

### 3.1 Secuencia de pago de una suscripción

![3.1 Secuencia de pago de una suscripción](../../../img/secuencia-pago-suscripcion.png)

_Figura. 3.1 Secuencia de pago de una suscripción._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    actor P as Propietario
    participant FE as Interfaz web
    participant API as PagosController
    participant UI as IniciarPagoDeSuscripcion
    participant GW as PaymentGateway (adaptador)
    participant PROV as Proveedor de pagos
    participant WH as WebhookController
    participant UC as ProcesarConfirmacionDePago
    participant DB as PostgreSQL
    participant BUS as EventBus
    participant SUB as suscripciones (M03)
    P->>FE: Elige plan y pagar
    FE->>API: POST /pagos con token
    API->>UI: iniciar(plan, contexto)
    UI->>DB: Guarda Pago PENDING
    UI->>GW: crearOrden(monto, referencia)
    GW->>PROV: Solicita orden o checkout
    PROV-->>GW: enlace o datos de pago
    GW-->>FE: Redirige al flujo del proveedor
    P->>PROV: Paga con Yape o tarjeta en el proveedor
    PROV->>WH: Notificación firmada
    WH->>UC: procesar(cuerpo crudo, cabeceras)
    UC->>GW: verificarNotificacion
    alt Firma válida y evento nuevo
        UC->>DB: Inserta webhook_event único, actualiza Pago a CONFIRMED
        UC->>BUS: publica PagoConfirmado
        BUS->>SUB: ActivarPorPago
        SUB->>DB: Suscripción pasa a ACTIVE en la misma transacción lógica
        WH-->>PROV: 200
    else Evento repetido
        UC-->>WH: sin cambios
        WH-->>PROV: 200
    else Firma inválida
        UC-->>WH: rechazado
        WH-->>PROV: 401
    end
```

</details>

Garantías: la suscripción solo se activa por confirmación oficial del proveedor; el índice único de `webhook_event` impide efectos repetidos; si el proveedor no avisa, `ConciliarPagosPendientes` consulta el estado. No se guardan datos de tarjeta.

> **Atomicidad.** El registro del evento, la actualización del pago y la activación de la suscripción se ejecutan de modo que, ante un fallo, se reintente sin duplicar. Si se usa el bus en proceso, la activación se dispara después del _commit_ del pago y es idempotente (`UPDATE ... WHERE estado <> 'ACTIVE'`); la conciliación cubre un fallo entre ambos pasos.

## 4. Submódulo `asistente` (M04 Asistente IA y reportes)

| Elemento                                                                             | Capa                | Responsabilidad                                                                             |
| ------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------- |
| `AsistenteController`                                                                | Presentación        | Recibe el mensaje; el límite de tasa se aplica antes                                        |
| `ConsultaIAAutorizada`                                                               | Aplicación          | Orquesta: contexto → intención estructurada → herramienta cerrada → respuesta               |
| `HerramientaIA` (interfaz)                                                           | Aplicación          | `nombre`, `rolesPermitidos`, `esSensible`, `ejecutar(params, contexto)`                     |
| `ConsultarServicios`, `ConsultarDisponibilidad`, `ResumenDeCitas`, `PrepararReserva` | Aplicación          | Herramientas que llaman a casos de uso de M02 y del submódulo `reportes`                    |
| `Intencion`                                                                          | Dominio             | Objeto de valor: nombre de herramienta + parámetros tipados                                 |
| `AIProvider`                                                                         | Aplicación (puerto) | `interpretar(mensaje, herramientasPermitidas) → Intencion`, `redactarRespuesta(resultados)` |
| `LlmAIProvider` / `FakeAIProvider`                                                   | Infraestructura     | Adaptador al proveedor y simulador                                                          |
| `AiLogRepository`                                                                    | Infraestructura     | Registro de interacciones                                                                   |

### 4.1 Secuencia del asistente

![4.1 Secuencia del asistente](../../../img/secuencia-asistente-ia.png)

_Figura. 4.1 Secuencia del asistente._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant FE as Interfaz web
    participant API as AsistenteController
    participant RL as RateLimiter (M06)
    participant UC as ConsultaIAAutorizada
    participant IA as AIProvider (adaptador)
    participant PROV as Proveedor de IA
    participant HER as Herramienta cerrada
    participant M02 as Caso de uso de M02 o reportes (M04)
    U->>FE: Escribe en lenguaje natural
    FE->>API: POST /asistente con token
    API->>RL: verifica cuota
    RL-->>API: permitido
    API->>UC: consultar(mensaje, contexto con rol y tenant)
    UC->>UC: Determina herramientas permitidas para el rol
    UC->>IA: interpretar(mensaje, herramientasPermitidas)
    IA->>PROV: solicitud sin secretos ni datos innecesarios
    alt Proveedor disponible
        PROV-->>IA: intención estructurada
        IA-->>UC: Intencion
        UC->>UC: Valida que la herramienta esté permitida y los parámetros sean válidos
        UC->>HER: ejecutar(parámetros, contexto)
        HER->>M02: caso de uso con permisos del usuario
        M02-->>HER: datos reales
        HER-->>UC: resultado
        UC->>IA: redactarRespuesta(resultado)
        IA-->>UC: texto
        UC-->>API: respuesta
        API-->>FE: texto con datos del backend
    else Proveedor caído o circuito abierto
        IA-->>UC: error controlado
        UC-->>API: degradación
        API-->>FE: Mensaje y enlace al flujo manual de reserva
    end
```

</details>

Reglas: la IA nunca recibe SQL ni acceso a la base; **la disponibilidad siempre viene de `ConsultarDisponibilidad`**; la confirmación de una reserva solo ocurre con `ReservarCita` tras confirmación explícita del usuario; las acciones sensibles piden verificación adicional; cada interacción se registra.

## 5. Diagrama de clases del módulo Suscripciones (resumen)

![5. Diagrama de clases del módulo Suscripciones (resumen)](../../../img/clases-suscripciones.png)

_Figura. 5. Diagrama de clases del módulo Suscripciones (resumen)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
classDiagram
    class Suscripcion {
        +TenantId tenantId
        +EstadoSuscripcion estado
        +Fecha finDePrueba
        +Fecha finDePeriodo
        +activarPorPago(fecha)
        +marcarImpaga(fecha)
        +vencer(fecha)
        +suspender()
        +reactivar()
        +puedeOperar() boolean
    }
    class EstadoSuscripcion {
        <<enumeration>>
        TRIAL
        ACTIVE
        PAST_DUE
        EXPIRED
        CANCELLED
        SUSPENDED
    }
    class PlanPolicy {
        <<interface>>
        +maxBarberos() int
        +maxUsuarios() int
        +iaHabilitada() boolean
    }
    class PlanPrueba
    class PlanBasico
    class PlanProfesional
    class SubscriptionRepository {
        <<interface>>
        +porTenant(tenantId) Suscripcion
        +guardar(s)
    }
    Suscripcion --> EstadoSuscripcion
    Suscripcion --> PlanPolicy
    PlanPolicy <|.. PlanPrueba
    PlanPolicy <|.. PlanBasico
    PlanPolicy <|.. PlanProfesional
    SubscriptionRepository ..> Suscripcion
```

</details>

Los nombres y límites de los planes son **ejemplos hipotéticos**, no precios ni condiciones de mercado.

## 6. Módulos no críticos

`identidad`, `barberias`, `catalogo` y `reportes` siguen el mismo flujo con casos de uso delgados (ver la simplificación proporcional en [enfoque](../../02-arquitectura-software/enfoque-arquitectonico.md#6-justificación-honesta-frente-al-criterio-de-la-guía)).

## 7. M05 Notificaciones

El cliente recibe la **fecha y hora de su cita** por su correo electrónico o por su número de WhatsApp, según el canal que eligió al registrarse (RF30, RF33, HU25). Decisión: [ADR-013](../../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-013-notificaciones-multicanal-al-cliente-correo-y-whatsapp).

| Elemento                                       | Capa                          | Responsabilidad                                                                                                                |
| ---------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CitaEventosHandler`                           | Aplicación                    | Escucha `CitaCreada`, `CitaReprogramada`, `CitaCancelada`; crea los envíos inmediatos y programa el recordatorio               |
| `EnviarNotificacion`                           | Aplicación                    | Elige el canal, aplica la plantilla, envía por el puerto y registra el resultado                                               |
| `ProcesarRecordatorios`                        | Aplicación                    | Tarea periódica: toma recordatorios vencidos con bloqueo (`FOR UPDATE SKIP LOCKED`) para que dos instancias no envíen el mismo |
| `CanalDeNotificacion`, `PlantillaDeMensaje`    | Dominio                       | Canal (EMAIL, WHATSAPP), tipos de mensaje y reglas (WhatsApp solo con consentimiento)                                          |
| `NotificationChannel`                          | Aplicación (puerto)           | `enviar(destinatario, mensaje) → ResultadoDeEnvio`                                                                             |
| `EmailSender`, `WhatsAppSender`                | Infraestructura (adaptadores) | Implementan el puerto; protegidos por reintentos y circuit breaker                                                             |
| `NotificationJobRepository`, `NotificationLog` | Aplicación / Infraestructura  | Programación y trazabilidad de envíos                                                                                          |

**Dependencias.** M05 solo depende de M06. Para no depender de M01, el evento de M02 lleva los datos mínimos de contacto (canal elegido, correo, número de WhatsApp y si aceptó recibirlos) y los datos de la cita (barbería, servicio, fecha y hora).

![7. M05 Notificaciones](../../../img/secuencia-notificacion-cita.png)

_Figura. 7. M05 Notificaciones._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    participant M02 as M02 Catálogo y citas
    participant BUS as EventBus (M06)
    participant H as CitaEventosHandler
    participant UC as EnviarNotificacion
    participant WA as WhatsAppSender
    participant PW as Servicio de WhatsApp
    participant EM as EmailSender
    participant PE as Servicio de correo
    participant DB as PostgreSQL
    actor C as Cliente
    M02->>BUS: publica CitaCreada con datos mínimos de contacto
    BUS->>H: entrega el evento
    H->>DB: programa recordatorio del día de la cita (2 h antes, configurable)
    H->>UC: enviar confirmación
    UC->>UC: Canal elegido y consentimiento válido
    alt Canal WhatsApp con consentimiento
        UC->>WA: enviar(número, mensaje con fecha y hora)
        WA->>PW: solicitud
        alt Entrega aceptada
            PW-->>WA: aceptado
            WA-->>UC: enviado
            PW-->>C: Mensaje de WhatsApp con la fecha y hora de la cita
        else Falla o circuito abierto
            WA-->>UC: error
            UC->>EM: enviar(correo, mensaje) como respaldo
            EM->>PE: solicitud
            PE-->>C: Correo con la fecha y hora de la cita
        end
    else Canal correo
        UC->>EM: enviar(correo, mensaje)
        EM->>PE: solicitud
        PE-->>C: Correo con la fecha y hora de la cita
    end
    UC->>DB: registra notification_log con canal y estado
```

</details>

**Reglas.**

1. El envío es **asíncrono**: nunca bloquea ni revierte la reserva (HU25 criterio 6).
2. WhatsApp solo se usa si el cliente dio su número y aceptó expresamente recibir mensajes; si no, se usa correo.
3. Reintentos con espera creciente en errores transitorios; si se agotan, se usa el respaldo por correo y se deja registro.
4. Los mensajes contienen solo barbería, servicio, fecha y hora, y una forma de cancelar o reprogramar mediante la plataforma.
5. El recordatorio se reprograma o se cancela si la cita cambia de horario o se cancela.
6. El recordatorio del día de la cita incluye acciones para el cliente (ver 7.1).
7. Las condiciones de WhatsApp (plantillas aprobadas, costos) dependen del proveedor y están por verificar.

### 7.1 Recordatorio del día de la cita y respuesta del cliente

El mismo día de la cita (propuesta: 2 horas antes, configurable por barbería) el sistema avisa al cliente que tiene cita y le pregunta si podrá asistir, por si surgió un imprevisto (RF34, HU28). Si la cita se reservó con menos tiempo que el de aviso, no se envía recordatorio: basta la confirmación.

| Acción del enlace       | Qué ocurre                                                                                                 | Reglas                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Confirmo asistencia** | Se registra `client_confirmed_at`; la agenda del barbero lo muestra                                        | No cambia el estado de la cita                                                                         |
| **Cancelar**            | `CancelarCita` pasa la cita a CANCELLED y libera el horario; se avisa al barbero y al propietario          | Siempre permitido; si es con menos antelación que la mínima configurable, se marca `late_cancellation` |
| **Reprogramar**         | Abre la pantalla de disponibilidad con la cita precargada; el cambio sigue las reglas de `ReprogramarCita` | Misma validación y restricción de exclusión que una reserva nueva                                      |
| Sin respuesta           | La cita **no se cancela automáticamente**; queda "sin confirmar"                                           | Una regla de cancelación automática sería evolución futura, a validar con las barberías                |

Los enlaces los firma el servicio `SignedActionToken` de M06 con: cita, tenant, acción y vencimiento (hasta el inicio de la cita) y un identificador `jti`. M02 los verifica y registra el `jti` en `used_action_token` con restricción de unicidad, así que **cada enlace sirve una sola vez**. M05 no depende de M02: solo firma enlaces con el servicio de M06.

![7.1 Recordatorio del día de la cita y respuesta del cliente](../../../img/secuencia-recordatorio-del-dia.png)

_Figura. 7.1 Recordatorio del día de la cita y respuesta del cliente._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
sequenceDiagram
    autonumber
    participant J as Planificador (una sola instancia por bloqueo)
    participant UC as ProcesarRecordatorios (M05)
    participant TK as SignedActionToken (M06)
    participant CH as NotificationChannel
    actor C as Cliente
    participant API as Host y API REST
    participant R as ResponderRecordatorio (M02)
    participant DB as PostgreSQL
    participant BUS as EventBus
    J->>UC: toma recordatorios vencidos con FOR UPDATE SKIP LOCKED
    UC->>DB: verifica que la cita siga CONFIRMED y no pasada
    UC->>TK: firma enlaces confirmar, reprogramar, cancelar
    TK-->>UC: enlaces de un solo uso
    UC->>CH: enviar mensaje Hoy tienes cita a las HH:MM, podras asistir
    CH-->>C: WhatsApp o correo con los tres enlaces
    C->>API: abre un enlace
    API->>R: responder(token, accion)
    R->>TK: verifica firma, vencimiento, cita y tenant
    R->>DB: registra jti único, si ya existe rechaza
    alt Confirmo asistencia
        R->>DB: guarda client_confirmed_at
        R-->>C: Gracias, te esperamos
    else Cancelar
        R->>DB: cita a CANCELLED y horario libre
        R->>BUS: publica CitaCancelada
        BUS-->>C: aviso de cancelación
        R-->>C: Cita cancelada
    else Reprogramar
        R-->>C: pantalla de disponibilidad con la cita precargada
    end
    Note over R,DB: Sin respuesta la cita queda sin confirmar y no se cancela sola
```

</details>
