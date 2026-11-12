# Estilo arquitectónico: monolito modular

Decisión: [ADR-001](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-001-monolito-modular). Drivers: DA04, DA06, DA09, DA10.

## 1. Definición

El backend es **una aplicación principal desplegable como unidad**, organizada internamente en **módulos con límites definidos**. No son microservicios: no se despliegan por separado ni se comunican por red entre sí; se llaman mediante interfaces públicas dentro del mismo proceso.

> **Vocabulario C4.** En el modelo C4, "contenedor" es una aplicación o almacén de datos ejecutable por separado (no necesariamente Docker). El backend es **un solo contenedor**; los módulos son **componentes** de ese contenedor ([Nivel 3](../04-modelo-c4/Nivel3-Diagrama-de-Componentes.md)).

## 2. Los seis módulos

Cinco módulos de negocio y un núcleo compartido. Se agrupó por **cohesión funcional** para que el equipo maneje pocas piezas; dentro de cada módulo hay **submódulos** (carpetas con sus cuatro capas) que conservan la separación fina y permiten, si el sistema crece, extraer uno sin rehacer el diseño.

| ID  | Módulo                             | Submódulos internos                     | Responsabilidad                                                                                                                                         | RF                    | Estado                                                     |
| --- | ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| M01 | Acceso y barberías                 | `identidad`, `barberias`, `clientes`    | Cuentas, autenticación, tokens, roles, administrador de la plataforma con segundo factor; alta y estado de la barbería; cuenta del cliente y consentimiento | RF01–RF06, RF33       | Implementado (001, 002, 003 y 004); RF32 planificado (007)  |
| M02 | Catálogo y citas                   | `catalogo`, `citas`                     | Servicios, barberos, horario de atención y disponibilidad; horarios libres, reserva, reprogramación, cancelación, estados, agenda, historial y acciones por enlace | RF07–RF17, RF34  | Implementado (002, 004 y 006)                               |
| M03 | Suscripciones y pagos              | `suscripciones`, `pagos`, `plataforma`  | Planes, prueba gratuita, estados y restricciones; pago con pasarela simulada, transferencia, notificación firmada y conciliación; operaciones del administrador | RF18–RF26             | Implementado (001 y 003), con pasarela simulada            |
| M04 | Asistente IA y reportes            | `asistente`, `reportes` (previstos)     | Asistente con herramientas cerradas; reportes por período                                                                                              | RF27–RF29             | Planificado (005)                                          |
| M05 | Notificaciones                     | —                                       | Correos y mensajes de WhatsApp al cliente, recordatorio y avisos de suscripción al propietario                                                          | RF30, RF33, RF34      | Implementado (004), con WhatsApp simulado                  |
| M06 | Núcleo compartido                  | carpetas de `shared/`                   | Tenant, transacción con RLS, auditoría, caché, límites, reloj y zona horaria, tareas programadas, resiliencia, bus de eventos y enlaces firmados        | RF31 (auditoría)      | Parcial: indicadores (007) planificados                    |
> **Por qué seis y no diez.** Un módulo por cada capacidad aislada aumenta las interfaces, las pruebas de frontera y la coordinación, algo que un equipo pequeño no necesita en el MVP (RC06, RC14). Las capacidades que cambian juntas (por ejemplo, catálogo y citas; suscripciones y pagos) se agrupan. La separación fina se mantiene dentro del módulo como submódulos con su propio puerto, de modo que el sistema sigue siendo escalable: un submódulo puede convertirse en módulo, o en servicio, sin cambiar su contrato.

### 2.1 Vista general: monolito modular y capas

El sistema es un monolito modular y cada módulo se organiza en cuatro capas con dependencias hacia el interior.

![Vista general: monolito modular y capas](../../img/monolito-capas-estilo.png)

_Figura 1. Vista general de la arquitectura: monolito modular con cuatro capas._

Fuente editable: img/monolito-capas-estilo.svg.

Leyenda: borde punteado = límite de módulo; borde discontinuo con relleno = planificado, sin código todavía (M04 y M05); flecha verde = uso entre módulos por su interfaz pública; flecha morada = la infraestructura implementa los puertos de la aplicación.

## 3. Dependencias permitidas

Un módulo **solo** puede depender de otro a través de su **interfaz pública** (ver [componentes](componentes-arquitectonicos.md)). Nunca accede a sus tablas ni a sus clases internas. La siguiente matriz indica con ✓ que la fila **puede llamar** a la columna.

| Desde \ Hacia               | M01 | M02 | M03 | M04 | M05 | M06 |
| --------------------------- | --- | --- | --- | --- | --- | --- |
| M01 Acceso y barberías      | —   |     | ✓   |     |     | ✓   |
| M02 Catálogo y citas        | ✓ ¹ | —   | ✓   |     |     | ✓   |
| M03 Suscripciones y pagos   |     |     | —   |     |     | ✓   |
| M04 Asistente IA y reportes |     | ✓   | ✓   | —   |     | ✓   |
| M05 Notificaciones          | ✓ ² |     |     |     | —   | ✓   |
| M06 Núcleo compartido       |     |     |     |     |     | —   |

¹ Agregado por [ADR-020](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-020-cuenta-de-cliente-con-membresía-y-sesión-por-barbería) (Aceptado el 2026-10-17, funcionalidad 002). M02 llama a M01 solo por su interfaz pública: `ClientesApi`, que identifica al cliente de la sesión y da nombre y teléfono para la agenda, `PersonalApi`, que comprueba que un usuario es personal activo para vincularlo a un barbero, y `BarberiasApi`, que da la zona horaria, la antelación de cancelación y los datos públicos de la barbería. M01 no llama a M02.

² Agregado por la revisión de [ADR-013](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-013-notificaciones-multicanal-al-cliente-correo-y-whatsapp) (Aceptada el 2026-11-04, funcionalidad 004; **implementado**). M05 llama a M01 **solo para leer**, por su interfaz pública, al momento de enviar un aviso: el canal, el número de WhatsApp y si el consentimiento está vigente (`ClientesApi.contactoParaAvisos`), el correo del personal (`PersonalApi.correoDe`) y el del propietario (`BarberiasApi.correoDelPropietario`). Así se respeta un retiro del consentimiento ocurrido entre la cita y su recordatorio, y la salida de eventos no guarda datos de contacto. M05 no escribe en M01, y M01 no llama a M05.

**Reglas.**

1. Todo lo que no tiene ✓ está **prohibido**.
2. No hay ciclos (se comprueba con la matriz: el grafo es acíclico).
3. M06 no depende de ningún módulo de negocio.
4. **Las llamadas entre módulos son síncronas**, por la interfaz pública. Dentro de M03, `pagos` actualiza la suscripción en la misma transacción que aprueba el pago (`aplicar-resultado.ts`). Los efectos hacia M05 (avisos de citas, recordatorio y avisos de suscripción) son **eventos asíncronos**, implementados en la funcionalidad 004 con la salida transaccional de M06 ([ADR-025](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-025-salida-transaccional-de-eventos-outbox-en-postgresql), Aceptado el 2026-11-04): M02 y M03 publican en su propia transacción, el host (`host/eventos.ts`) suscribe los manejadores de M05 y nadie llama directamente a M05.
5. El **identificador del tenant** (`TenantId`) es un valor compartido del núcleo (M06); por eso M03 no depende de M01. M02 depende de M01 solo para los datos del cliente y del personal (nota ¹), no para el tenant.
6. La **raíz de composición** (`host/`) es el único lugar autorizado para ensamblar módulos. Su `AuthGuard` valida el token con `ValidarSolicitud` de M01 (que también comprueba el estado de la barbería), `host/tareas.ts` registra las tareas programadas (de M02, M03, M05 y M06) y `host/eventos.ts` conecta cada tipo de evento con su manejador de M05. La política de suscripción la aplica cada caso de uso de escritura llamando a `SuscripcionesApi.exigirOperacion`.
7. Entre submódulos del **mismo** módulo se permite llamar a su interfaz interna; hacia otro módulo, solo a su interfaz pública (`index`).

Las dependencias que existen hoy son las de la matriz: M02 → M01 (nota ¹), M01 y M02 → M03 (`exigirOperacion`), los módulos de negocio → M06 y, desde 004, M02 y M03 → M05 **por eventos** del bus de M06 (regla 4) y **M05 → M01, implementada y solo de lectura** (nota ²). M04 es la única planificada. No hay dependencias hacia M02 desde M01 ni desde M03, ni llamadas de M01 a M05: el grafo no tiene ciclos.

Evidencia: importaciones entre `backend/src/modules/*/index.ts` (por ejemplo, `catalogo-citas/citas/application/reservar-cita.ts` importa `BarberiasApi`, `ClientesApi` y `SuscripcionesApi`); `host/auth.guard.ts`, `host/tareas.ts`; reglas en `backend/.dependency-cruiser.cjs`; prueba `backend/test/architecture/reglas.spec.ts` (PR14).

## 4. Organización del código

El código de la aplicación vive en `tecnologia/plataforma-barberias/` (`backend/` y `frontend/`). La estructura siguiente corresponde al backend, es decir, a `tecnologia/plataforma-barberias/backend/src/`.

```text
backend/src/
  modules/
    acceso-barberias/         (M01)
      identidad/              submódulo (incluye el ingreso del administrador de la plataforma)
      barberias/              submódulo
      clientes/               submódulo
      index.ts                interfaz pública del módulo (única entrada permitida)
    catalogo-citas/           (M02)
      catalogo/
      citas/
        presentation/         controladores REST, DTO, validación de formato
        application/          casos de uso, puertos, transacciones
        domain/               entidades, objetos de valor, reglas
        infrastructure/       repositorios PostgreSQL, adaptadores
      index.ts
    suscripciones-pagos/      (M03)  suscripciones/, pagos/ y plataforma/
    notificaciones/           (M05)  application/, domain/, infrastructure/ (sin rutas propias)
                              (M04: sin carpeta todavía; planificado)
  shared/                     núcleo compartido (M06): audit, cache, clock, config, enlaces,
                              eventos, http, limites, persistence, resiliencia, tareas, tenant,
                              tiempo
  host/                       raíz de composición, guardas, filtro de errores, salud, tareas y
                              suscripciones al bus de eventos
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
| Interfaz pública por módulo      | Solo `index` se importa desde afuera                                          | Regla de dependency-cruiser (PR14) |
| Pruebas de arquitectura          | Una prueba falla si un módulo importa algo prohibido por la matriz            | PR14 (en CI)                      |
| Esquemas de datos por módulo     | Cada módulo es dueño de sus tablas; las demás consultas pasan por su interfaz | Revisión de código                |
| Revisión de código               | Pull request con checklist de dependencias                                    | Proceso Scrum                     |
| Eventos para efectos secundarios | Las notificaciones no se llaman directamente: van por el bus de M06 (004)     | PR14 (`m05-sin-llamadas`, `eventos-solo-por-bus`) |

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
