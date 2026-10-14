# C4 Nivel 4: Diagrama de código

**Propósito.** Mostrar clases e interfaces de componentes críticos. Se documentan dos: **"Reservar cita" (submódulo `citas`, M02)** y **`PaymentGateway` (submódulo `pagos`, M03)**. **Audiencia:** desarrolladores. Es el "zoom" del componente del nivel 3; el diagrama es ilustrativo del diseño y se detallará durante la implementación (estado: planificado).

## 1. Submódulo `citas` (M02): caso de uso "Reservar cita"

![1. Submódulo `citas` (M02): caso de uso "Reservar cita"](../../img/c4-nivel4-reservar-cita.png)

_Figura. 1. Submódulo `citas` (M02): caso de uso "Reservar cita"._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
classDiagram
    direction LR

    class CitasController {
        <<presentación>>
        +postCita(dto, contexto) Respuesta
    }
    class ReservarCita {
        <<aplicación>>
        +ejecutar(comando, contexto) CitaDto
    }
    class ReservarCitaComando {
        +barberoId
        +servicioId
        +inicio
    }
    class CitaRepository {
        <<interface>>
        +guardar(cita)
        +buscarPorId(id)
        +listarPorBarbero(barberoId, rango)
    }
    class SubscriptionPolicy {
        <<interface M03>>
        +puedeOperar(tenantId) boolean
    }
    class CatalogQuery {
        <<interface M02>>
        +servicioActivo(tenantId, servicioId)
        +horarioDelBarbero(tenantId, barberoId, fecha)
    }
    class EventBus {
        <<interface M06>>
        +publicar(evento)
    }
    class Cita {
        <<dominio>>
        +CitaId id
        +TenantId tenantId
        +EstadoCita estado
        +confirmar()
        +cancelar(ahora)
        +reprogramar(nuevoRango, ahora)
        +completar()
        +marcarNoAsistio()
    }
    class RangoHorario {
        <<valor>>
        +inicio
        +fin
        +seSolapaCon(otro) boolean
        +duracionMinutos() int
    }
    class EstadoCita {
        <<enumeración>>
        PENDING
        CONFIRMED
        COMPLETED
        NO_SHOW
        CANCELLED
    }
    class HorarioNoDisponible {
        <<error de dominio>>
    }
    class CitaRepositoryPostgres {
        <<infraestructura>>
        +guardar(cita)
    }
    class CitaCreada {
        <<evento>>
    }

    CitasController --> ReservarCita : llama
    ReservarCita ..> ReservarCitaComando : recibe
    ReservarCita --> SubscriptionPolicy : consulta
    ReservarCita --> CatalogQuery : consulta
    ReservarCita --> CitaRepository : usa
    ReservarCita --> EventBus : publica
    ReservarCita ..> Cita : crea
    ReservarCita ..> CitaCreada : emite
    Cita *-- RangoHorario
    Cita --> EstadoCita
    CitaRepository <|.. CitaRepositoryPostgres : implementa
    CitaRepositoryPostgres ..> HorarioNoDisponible : lanza si hay conflicto
```

</details>

**Lectura.** `ReservarCita` (aplicación) solo conoce interfaces; `Cita` y `RangoHorario` (dominio) no conocen nada de infraestructura; `CitaRepositoryPostgres` traduce la violación de la restricción de exclusión a `HorarioNoDisponible`.

| Clase / interfaz                     | Capa                | Responsabilidad                                                               | Requisito    |
| ------------------------------------ | ------------------- | ----------------------------------------------------------------------------- | ------------ |
| `CitasController`                    | Presentación        | Validar formato, recibir contexto, mapear errores a HTTP (409 para conflicto) | RF12         |
| `ReservarCita`                       | Aplicación          | Orquestar la reserva                                                          | RF12, RF21   |
| `Cita`, `RangoHorario`, `EstadoCita` | Dominio             | Invariantes y transiciones                                                    | RF12–RF15    |
| `CitaRepository`                     | Aplicación (puerto) | Contrato de persistencia                                                      | EQ-09, EQ-16 |
| `CitaRepositoryPostgres`             | Infraestructura     | Inserción en transacción con tenant fijado                                    | ADR-009      |

## 2. Submódulo `pagos` (M03): puerto `PaymentGateway` y casos de uso

![2. Submódulo `pagos` (M03): puerto `PaymentGateway` y casos de uso](../../img/c4-nivel4-pagos.png)

_Figura. 2. Submódulo `pagos` (M03): puerto `PaymentGateway` y casos de uso._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
classDiagram
    direction LR

    class PagosController {
        <<presentación>>
        +iniciar(dto, contexto)
    }
    class WebhookController {
        <<presentación>>
        +recibir(cuerpoCrudo, cabeceras)
    }
    class IniciarPagoDeSuscripcion {
        <<aplicación>>
        +ejecutar(planId, contexto) OrdenDePago
    }
    class ProcesarConfirmacionDePago {
        <<aplicación>>
        +ejecutar(cuerpoCrudo, cabeceras)
    }
    class ConciliarPagosPendientes {
        <<aplicación>>
        +ejecutar()
    }
    class PaymentGateway {
        <<interface>>
        +crearOrden(monto, referencia) OrdenDePago
        +verificarNotificacion(cuerpo, cabeceras) NotificacionDePago
        +consultarPago(referencia) EstadoPago
    }
    class PagoRepository {
        <<interface>>
        +guardar(pago)
        +buscarPorReferencia(ref) Pago
        +registrarEventoUnico(idEvento) boolean
        +pendientesAntiguos(desde) lista
    }
    class Pago {
        <<dominio>>
        +PagoId id
        +TenantId tenantId
        +EstadoPago estado
        +confirmar()
        +rechazar()
        +expirar()
    }
    class EstadoPago {
        <<enumeración>>
        PENDING
        CONFIRMED
        REJECTED
        EXPIRED
    }
    class CulqiPaymentGateway {
        <<infraestructura>>
    }
    class FakePaymentGateway {
        <<infraestructura pruebas>>
    }
    class PagoRepositoryPostgres {
        <<infraestructura>>
    }
    class CircuitBreaker {
        <<infraestructura>>
    }
    class PagoConfirmado {
        <<evento>>
    }

    PagosController --> IniciarPagoDeSuscripcion
    WebhookController --> ProcesarConfirmacionDePago
    IniciarPagoDeSuscripcion --> PaymentGateway
    IniciarPagoDeSuscripcion --> PagoRepository
    ProcesarConfirmacionDePago --> PaymentGateway
    ProcesarConfirmacionDePago --> PagoRepository
    ProcesarConfirmacionDePago ..> PagoConfirmado : emite
    ConciliarPagosPendientes --> PaymentGateway
    ConciliarPagosPendientes --> PagoRepository
    Pago --> EstadoPago
    PagoRepository ..> Pago
    PaymentGateway <|.. CulqiPaymentGateway
    PaymentGateway <|.. FakePaymentGateway
    PagoRepository <|.. PagoRepositoryPostgres
    CulqiPaymentGateway --> CircuitBreaker : protegido por
```

</details>

**Lectura.** Cambiar de proveedor o agregar un método de pago es escribir otra implementación de `PaymentGateway` (EQ-14, EQ-20). `registrarEventoUnico` usa el índice único de `webhook_event` para la idempotencia (EQ-17). Ninguna clase guarda datos de tarjeta (RC12).

| Clase / interfaz             | Capa                | Responsabilidad                                                  | Requisito     |
| ---------------------------- | ------------------- | ---------------------------------------------------------------- | ------------- |
| `IniciarPagoDeSuscripcion`   | Aplicación          | Crear `Pago` PENDING y pedir la orden al proveedor               | RF23          |
| `ProcesarConfirmacionDePago` | Aplicación          | Verificar, registrar evento único, confirmar pago, emitir evento | RF24          |
| `ConciliarPagosPendientes`   | Aplicación          | Consultar al proveedor los pagos sin resolver                    | RF26          |
| `PaymentGateway`             | Aplicación (puerto) | Contrato con el proveedor                                        | RC05, ADR-007 |
| `CulqiPaymentGateway`        | Infraestructura     | Adaptador del candidato (por confirmar)                          | ADR-007       |
| `FakePaymentGateway`         | Infraestructura     | Simulador para pruebas                                           | EQ-20         |

## 3. Notas

- Los nombres son de diseño; el código real puede variar al implementar, manteniendo las responsabilidades.
- La IA (`AIProvider`) sigue el mismo patrón: ver [diseño interno, sección 4](../03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md#4-submódulo-asistente-m04-asistente-ia-y-reportes).

**Anterior:** [Nivel 3](Nivel3-Diagrama-de-Componentes.md).
