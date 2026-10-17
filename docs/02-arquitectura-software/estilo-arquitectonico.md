# Estilo arquitectónico: monolito modular

Decisión: [ADR-001](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-001-monolito-modular). Drivers: DA04, DA06, DA09, DA10.

## 1. Definición

El backend es **una aplicación principal desplegable como unidad**, organizada internamente en **módulos con límites definidos**. No son microservicios: no se despliegan por separado ni se comunican por red entre sí; se llaman mediante interfaces públicas dentro del mismo proceso.

> **Vocabulario C4.** En el modelo C4, "contenedor" es una aplicación o almacén de datos ejecutable por separado (no necesariamente Docker). El backend es **un solo contenedor**; los módulos son **componentes** de ese contenedor ([Nivel 3](../04-modelo-c4/Nivel3-Diagrama-de-Componentes.md)).

## 2. Los seis módulos

Cinco módulos de negocio y un núcleo compartido. Se agrupó por **cohesión funcional** para que el equipo maneje pocas piezas; dentro de cada módulo hay **submódulos** (carpetas con sus cuatro capas) que conservan la separación fina y permiten, si el sistema crece, extraer uno sin rehacer el diseño.

| ID  | Módulo                             | Submódulos internos      | Responsabilidad                                                                                                                                                                       | RF                    | Estado      |
| --- | ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------- |
| M01 | Acceso y barberías                 | `identidad`, `barberias` | Cuentas, autenticación, tokens, roles, consentimiento, preferencia de canal, solicitudes de datos; alta y ciclo de vida de barberías, datos comerciales, horarios y estado del tenant | RF01–RF06, RF32, RF33 | Planificado |
| M02 | Catálogo y citas                   | `catalogo`, `citas`      | Servicios, barberos, disponibilidad configurada; cálculo de disponibilidad, reserva, reprogramación, cancelación, estados, agenda, historial y respuesta al recordatorio              | RF07–RF17, RF34       | Planificado |
| M03 | Suscripciones y pagos              | `suscripciones`, `pagos` | Planes, prueba gratuita, estados y restricciones; pago de suscripciones, webhooks, transacciones y conciliación                                                                       | RF18–RF26             | Planificado |
| M04 | Asistente IA y reportes            | `asistente`, `reportes`  | Asistente con herramientas cerradas, límites y registro; reportes por período e indicadores (solo lectura)                                                                            | RF27–RF29             | Planificado |
| M05 | Notificaciones                     | —                        | Correos y mensajes de WhatsApp al cliente por eventos y recordatorios                                                                                                                 | RF30, RF33, RF34      | Planificado |
| M06 | Núcleo compartido y observabilidad | —                        | Contexto de solicitud y tenant, bus de eventos, caché, auditoría, registro, métricas, limitación, enlaces firmados                                                                    | RF31                  | Planificado |

> **Por qué seis y no diez.** Un módulo por cada capacidad aislada aumenta las interfaces, las pruebas de frontera y la coordinación, algo que un equipo pequeño no necesita en el MVP (RC06, RC14). Las capacidades que cambian juntas (por ejemplo, catálogo y citas; suscripciones y pagos) se agrupan. La separación fina se mantiene dentro del módulo como submódulos con su propio puerto, de modo que el sistema sigue siendo escalable: un submódulo puede convertirse en módulo, o en servicio, sin cambiar su contrato.

## 3. Dependencias permitidas

Un módulo **solo** puede depender de otro a través de su **interfaz pública** (ver [componentes](componentes-arquitectonicos.md)). Nunca accede a sus tablas ni a sus clases internas. La siguiente matriz indica con ✓ que la fila **puede llamar** a la columna.

| Desde \ Hacia               | M01 | M02 | M03 | M04 | M05 | M06 |
| --------------------------- | --- | --- | --- | --- | --- | --- |
| M01 Acceso y barberías      | —   |     | ✓   |     |     | ✓   |
| M02 Catálogo y citas        | ✓ ¹ | —   | ✓   |     |     | ✓   |
| M03 Suscripciones y pagos   |     |     | —   |     |     | ✓   |
| M04 Asistente IA y reportes |     | ✓   | ✓   | —   |     | ✓   |
| M05 Notificaciones          |     |     |     |     | —   | ✓   |
| M06 Núcleo compartido       |     |     |     |     |     | —   |

¹ Agregado por [ADR-020](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-020-cuenta-de-cliente-con-membresía-y-sesión-por-barbería) (Aceptado el 2026-10-17, funcionalidad 002). M02 llama a M01 solo por su interfaz pública: `ClientesApi`, que identifica al cliente de la sesión y da nombre y teléfono para la agenda, `PersonalApi`, que comprueba que un usuario es personal activo para vincularlo a un barbero, y `BarberiasApi`, que da la zona horaria, la antelación de cancelación y los datos públicos de la barbería. M01 no llama a M02.

**Reglas.**

1. Todo lo que no tiene ✓ está **prohibido**.
2. No hay ciclos (se comprueba con la matriz: el grafo es acíclico).
3. M06 no depende de ningún módulo de negocio.
4. La comunicación **asíncrona dentro del proceso** se hace con eventos del bus de M06: el submódulo `pagos` publica `PagoConfirmado` y `suscripciones` lo escucha (ambos dentro de M03); M02 publica `CitaCreada` y M05 lo escucha. Quien publica no conoce a quien escucha.
5. El **identificador del tenant** (`TenantId`) es un valor compartido del núcleo (M06); por eso M03 no depende de M01. M02 depende de M01 solo para los datos del cliente y del personal (nota ¹), no para el tenant.
6. La **raíz de composición** (el host de la aplicación) es el único lugar autorizado para ensamblar módulos y aplicar el middleware de tenant, que consulta a M01 (estado del tenant) y M03 (política de suscripción).
7. Entre submódulos del **mismo** módulo se permite llamar a su interfaz interna; hacia otro módulo, solo a su interfaz pública (`index`).

![3. Dependencias permitidas](../../img/modulos-dependencias-permitidas.png)

_Figura. 3. Dependencias permitidas._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
flowchart LR
    M01["M01 Acceso y barberías"] --> M03["M03 Suscripciones y pagos"]
    M02["M02 Catálogo y citas"] --> M03
    M02 -- "ClientesApi, PersonalApi, BarberiasApi (ADR-020)" --> M01
    M04["M04 Asistente IA y reportes"] --> M02
    M04 --> M03
    M02 -. "evento CitaCreada" .-> M05["M05 Notificaciones"]
    M03 -. "evento SuscripcionPorVencer" .-> M05
    M06[("M06 Núcleo compartido")]
    M01 --> M06
    M02 --> M06
    M03 --> M06
    M04 --> M06
    M05 --> M06
```

</details>

_Nota._ Las flechas continuas son llamadas por interfaz pública; las discontinuas son eventos publicados en el bus de M06 (suscripción sin dependencia de código hacia el publicador, salvo el contrato del evento). El evento `PagoConfirmado` ocurre dentro de M03 y por eso no aparece entre módulos.

## 4. Organización del código

El código de la aplicación vive en `tecnologia/plataforma-barberias/` (`backend/` y `frontend/`). La estructura siguiente corresponde al backend, es decir, a `tecnologia/plataforma-barberias/backend/src/`.

```text
backend/src/
  modules/
    acceso-barberias/         (M01)
      identidad/              submódulo
      barberias/              submódulo
      index.ts                interfaz pública del módulo (única entrada permitida)
    catalogo-citas/           (M02)
      catalogo/
      citas/
        presentation/         controladores REST, DTO, validación de formato
        application/          casos de uso, puertos, transacciones
        domain/               entidades, objetos de valor, reglas
        infrastructure/       repositorios PostgreSQL, adaptadores
      index.ts
    suscripciones-pagos/      (M03)  suscripciones/ y pagos/
    asistente-reportes/       (M04)  asistente/ y reportes/
    notificaciones/           (M05)
  shared/                     núcleo compartido (M06)
  host/                       raíz de composición y middleware
```

Cada submódulo tiene sus cuatro capas, como se muestra en `citas/`.

## 4.1 Cómo crece el sistema

| Señal                                                    | Respuesta                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Un submódulo crece o lo toca otro equipo                 | Se promueve a módulo (nueva fila en la matriz)                                    |
| Un módulo tiene una carga muy distinta (por ejemplo, IA) | Se extrae como servicio detrás de su interfaz pública (evolución futura, ADR-001) |
| Aparecen reglas nuevas de notificación o canales         | Se agrega un adaptador al puerto `NotificationChannel` sin tocar a M02            |

## 5. Cómo se evita que el monolito se desordene

| Mecanismo                        | Descripción                                                                   | Verificación                      |
| -------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| Interfaz pública por módulo      | Solo `index` se importa desde afuera                                          | Regla de importación en el linter |
| Pruebas de arquitectura          | Una prueba falla si un módulo importa algo prohibido por la matriz            | PR14 (en CI)                      |
| Esquemas de datos por módulo     | Cada módulo es dueño de sus tablas; las demás consultas pasan por su interfaz | Revisión de código                |
| Revisión de código               | Pull request con checklist de dependencias                                    | Proceso Scrum                     |
| Eventos para efectos secundarios | Notificaciones y reacciones no se llaman directamente                         | Revisión                          |

## 6. Justificación, ventajas y desventajas

| Aspecto                          | Valoración                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Complejidad adecuada al proyecto | Un equipo pequeño opera una sola unidad                                                              |
| Costo                            | Una sola aplicación, una base de datos, una caché                                                    |
| Desarrollo, pruebas y despliegue | Transacciones locales; pruebas de integración sin red entre módulos                                  |
| Mantenibilidad                   | Límites explícitos facilitan cambios localizados                                                     |
| Escalado                         | Se replican instancias del mismo monolito detrás del balanceador                                     |
| **Desventajas**                  | Despliegue común; una falla del proceso afecta a todo; requiere disciplina para sostener los límites |

**Microservicios** quedan como opción futura, solo si una necesidad demostrada (por ejemplo, un módulo con carga muy distinta, como IA) lo justifica. Los módulos con interfaces claras facilitarían esa extracción.

## 7. Alternativas descartadas

| Alternativa          | Motivo del descarte                                                               |
| -------------------- | --------------------------------------------------------------------------------- |
| Microservicios       | Operación y consistencia distribuida superan la capacidad del equipo (RC06, RC14) |
| Monolito sin módulos | Alto riesgo de enredo (DA06)                                                      |
| Serverless           | Dificulta transacciones de reserva y control de costos en este contexto           |
