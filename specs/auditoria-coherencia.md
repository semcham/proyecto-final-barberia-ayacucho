# Auditoría de coherencia: documentación frente a código

- **Fecha:** 2026-11-19
- **Rama:** `main`, último commit `9bc3a6b`, con cambios locales de 009 sin commit.
- **Tipo:** solo lectura. No se cambió código, specs ni documentos; este informe es el único archivo creado.
- **Objetivo:** comprobar que lo que la documentación da por construido existe en el código y tiene una prueba que lo respalde, pensando en una plataforma para clientes reales.

## Cómo se hizo

- **Rutas:** las rutas de código son relativas a `tecnologia/plataforma-barberias/`.
  - `b/` = `backend/src/modules/`
  - `f/` = `frontend/src/`
  - `ti/` = `backend/test/integration/`
  - `tu/` = `backend/test/unit/`
  - `tc/` = `backend/test/contract/`
  - `ft/` = `frontend/test/pages/`
- **Origen de cada afirmación:** viene de leer el código (controladores, casos de uso, rutas de la interfaz y migraciones) y de comprobar que la prueba citada existe.
- **Tareas de las specs:** se revisaron con un script de solo lectura. Para cada tarea marcada `[X]` en `specs/00N/tasks.md`, el script comprueba que existan los archivos que la tarea nombra.
- **Pruebas ejecutadas en esta auditoría:**
  - las unitarias del backend (`npm test`), las de arquitectura (`npm run test:arch`) y las del frontend (`vitest run`), con `IA_PROVEEDOR=falso`;
  - el resultado está en el apartado "Pruebas ejecutadas".
- **Pruebas no ejecutadas:**
  - **Integración** (`npm run test:int`, unas 150 suites con Testcontainers): no se corrieron, porque necesitan Docker y mucho tiempo. Cuando una fila dice "prueba de integración", la prueba **existe** y cubre el caso por su nombre y contenido, pero **no se verificó que hoy pase**.
  - **De extremo a extremo y manuales:** no se hicieron recorridos en el navegador. La alcanzabilidad de las pantallas se comprobó leyendo las rutas y los enlaces del código.
- **Estados usados:**
  - **CONSTRUIDO:** hay código y una prueba que lo cubre.
  - **PARCIAL:** falta una parte, o solo funciona con un simulador o un proveedor falso.
  - **NO CONSTRUIDO:** no hay código.
  - **DOC INCORRECTA:** el documento dice algo distinto de lo que hay.

---

## 1. Requisitos funcionales (RF) y no funcionales (escenarios EQ)

Fuente: `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`. Ese documento dice "34 implementados, 1 parcial (RF32)".

### 1.1 Requisitos funcionales

| Elemento | Qué dice la documentación (archivo) | Evidencia (archivo:línea y prueba) | Estado | Observación |
| --- | --- | --- | --- | --- |
| RF01 Registrar barbería y propietario | Implementado (001), 03-requisitos | `b/acceso-barberias/barberias/application/registrar-barberia.ts:39`; `barberias.controller.ts:17`. Pruebas: `ti/barberias/registrar-barberia.spec.ts`, `tc/registro-barberia.contract.spec.ts`, `ft/registro.spec.tsx` | CONSTRUIDO | |
| RF02 Activar, suspender y reactivar barberías (administrador) | Implementado (003) | `b/acceso-barberias/barberias/presentation/barberias-plataforma.controller.ts:62` (suspender) y `:72` (reactivar). Interfaz: `f/api/plataforma.ts:152-154`. Pruebas: `ti/plataforma/barberias-plataforma.spec.ts`, `ft/plataforma-barberias.spec.tsx` | CONSTRUIDO | No existe un "activar" aparte: la barbería queda activa al registrarse (actores dice "se registran solas"). El texto del RF dice "activar"; conviene aclararlo |
| RF03 Datos comerciales y horario de atención | Implementado (002) | `b/acceso-barberias/barberias/application/actualizar-barberia.ts:41`; `b/catalogo-citas/catalogo/application/horarios.ts:47`. Interfaz: `f/pages/panel/Barberia.tsx:76,243`. Pruebas: `ti/catalogo/barberia.spec.ts`, `ti/catalogo/horarios.spec.ts` | CONSTRUIDO | |
| RF04 Inicio y cierre de sesión con token de rol y barbería | Implementado (001) | `b/acceso-barberias/identidad/application/iniciar-sesion.ts:44`, `cerrar-sesion.ts:11`, `emitir-sesion.ts:23`; `auth.controller.ts:39,91`. Pruebas: `ti/identidad/autenticacion.spec.ts`, `tc/auth.contract.spec.ts`, `ti/host/auth-guard.spec.ts` | CONSTRUIDO | **No hay recuperación de contraseña** (excluida en `specs/001/spec.md:191` y en 002; ningún documento posterior la retoma) |
| RF05 Registrar clientes con consentimiento y su evidencia | Implementado (002) | `b/acceso-barberias/clientes/application/registrar-cliente.ts:35` (consentimiento en `:51-55` y `:78`). Interfaz: `f/pages/publico/RegistroCliente.tsx`. Pruebas: `ti/clientes/cuenta-cliente.spec.ts`, `tc/clientes.contract.spec.ts` | PARCIAL | Se guarda la evidencia del consentimiento, pero **el texto de la política no se publica en ninguna parte**: la casilla dice "Acepto la política… (versión 2026-10)", sin enlace ni página (`f/pages/publico/Union.tsx:57`). **El correo no se verifica** (ver 7) |
| RF06 Crear usuarios de la barbería con rol | Implementado (001) | `b/acceso-barberias/identidad/application/crear-usuario.ts:31`; `usuarios.controller.ts:48,72`. Interfaz: `f/pages/Usuarios.tsx:147-164`. Pruebas: `ti/identidad/usuarios.spec.ts`, `tc/rbac.spec.ts`, `ft/usuarios.spec.tsx` | CONSTRUIDO | **El enlace de activación no se envía por correo**: la API lo devuelve al propietario para que lo entregue a mano (`enlace-activacion.ts:14-16`), aunque M05 ya envía correos |
| RF07 Catálogo de servicios | Implementado (002) | `b/catalogo-citas/catalogo/application/servicios.ts:37,66`. Interfaz: `f/pages/panel/Servicios.tsx`. Pruebas: `ti/catalogo/servicios.spec.ts`, `ft/panel-catalogo.spec.tsx` | CONSTRUIDO | |
| RF08 Barberos y sus servicios | Implementado (002) | `b/catalogo-citas/catalogo/application/barberos.ts:77,114`. Interfaz: `f/pages/panel/Barberos.tsx`. Prueba: `ti/catalogo/barberos.spec.ts` | CONSTRUIDO | |
| RF09 Disponibilidad semanal y bloqueos | Implementado (002) | `horarios.ts:111`, `bloqueos.ts:60,100`. Interfaz: `f/pages/panel/Disponibilidad.tsx`. Prueba: `ti/catalogo/disponibilidad.spec.ts` | CONSTRUIDO | |
| RF10 Catálogo público sin sesión | Implementado (002) | `b/catalogo-citas/catalogo/application/obtener-catalogo-publico.ts:14`; `publico.controller.ts:36`. Interfaz: `f/pages/publico/CatalogoPublico.tsx`. Pruebas: `tc/publico.contract.spec.ts`, `ti/aislamiento/lectura-publica.spec.ts`, `ft/catalogo-publico.spec.tsx` | CONSTRUIDO | |
| RF11 Horarios libres por servicio, barbero y fecha | Implementado (002) | `consultar-horarios.ts:32`; `publico.controller.ts:43`. Pruebas: `tu/catalogo/calculadora-horarios.spec.ts`, `ti/catalogo/horarios.spec.ts` | CONSTRUIDO | |
| RF12 Cita sin solapamiento del barbero | Implementado (002) | `b/catalogo-citas/citas/application/reservar-cita.ts:71`; `backend/migrations/0011_citas.ts:51` (`EXCLUDE USING gist`). Pruebas: `ti/citas/reservar.spec.ts`, `ti/citas/concurrencia-reservas.spec.ts` | CONSTRUIDO | |
| RF13 Reprogramar | Implementado (004) | `reprogramar-cita.ts:54`; `citas.controller.ts:30`. Interfaz: `f/components/app/ReprogramarCita.tsx`. Pruebas: `ti/citas/reprogramar*.spec.ts` (5), `ft/reprogramar.spec.tsx` | CONSTRUIDO | |
| RF14 Cancelar y marcar la cancelación tardía | Implementado (002) | `cancelar-cita.ts:21`. Pruebas: `ti/citas/cancelar.spec.ts`, `tu/citas/cancelar.spec.ts`, `ft/cancelar.spec.tsx` | CONSTRUIDO | |
| RF15 Transiciones válidas del estado de la cita | Implementado (002) | `cambiar-estado-cita.ts:23`. Pruebas: `tu/citas/transiciones.spec.ts`, `ti/citas/agenda-estados.spec.ts` | CONSTRUIDO | |
| RF16 Agenda por barbero, barbería y fecha | Implementado (002) | `consultar-agenda.ts:35`; `agenda.controller.ts:26-27`. Interfaz: `f/pages/panel/Agenda.tsx`. Pruebas: `tc/agenda.contract.spec.ts`, `ft/agenda.spec.tsx` | CONSTRUIDO | Solo por día, sin rango de fechas |
| RF17 Historial del cliente | Implementado (002) | `consultar-historial.ts:24`; `historial.controller.ts:30`. Interfaz: `f/pages/cliente/MisCitas.tsx`. Pruebas: `ti/citas/historial.spec.ts`, `ft/mis-citas.spec.tsx` | CONSTRUIDO | Llegar a `/mis-citas` es difícil (ver 5) |
| RF18 Prueba gratuita automática | Implementado (001) | `b/suscripciones-pagos/suscripciones/application/iniciar-prueba-gratuita.ts:21`. Prueba: `ti/barberias/registrar-barberia.spec.ts` | CONSTRUIDO | |
| RF19 Consultar la suscripción | Implementado (003) | `suscripciones/application/consultas.ts:46`. Interfaz: `f/pages/panel/Suscripcion.tsx`. Pruebas: `tc/suscripcion.contract.spec.ts`, `ft/suscripcion.spec.tsx` | CONSTRUIDO | |
| RF20 Contratar o cambiar de plan | Implementado (003) | `b/suscripciones-pagos/pagos/application/iniciar-pago.ts:62` (plan en `:103-104`). Pruebas: `ti/pagos/iniciar-pago.spec.ts`, `ti/suscripciones/plan-menor.spec.ts` | PARCIAL | Funciona solo con la pasarela simulada (ver RF23). Los precios (S/ 49 y S/ 89) están fijos en `backend/migrations/0014_planes_y_suscripcion.ts:40-41`; no se verificó que estén validados con el negocio |
| RF21 Restringir según el plan y el estado | Implementado (003) | `exigir-operacion.ts:23`. Pruebas: `ti/suscripciones/restricciones-estado.spec.ts`, `exigir-operacion.spec.ts` | CONSTRUIDO | |
| RF22 Suspender, reactivar y vencer automáticamente | Implementado (003) | `vencer-suscripciones.ts:22`; `b/suscripciones-pagos/plataforma/application/suscripciones-plataforma.ts:37,74`. Pruebas: `ti/tareas/vencimiento.spec.ts`, `vencimiento-dos-replicas.spec.ts` | CONSTRUIDO | |
| RF23 Iniciar el pago con el proveedor | Implementado (003) "con pasarela simulada" | `iniciar-pago.ts:62`; `pasarela-simulada.adapter.ts`; `b/suscripciones-pagos/pagos/infrastructure/fabrica-pasarela.ts:15-18`: con `culqi` **lanza un error**, porque el adaptador no existe. Pruebas: `ti/pagos/gateway-simulado.spec.ts`, `iniciar-pago.spec.ts` | PARCIAL | **No existe un proveedor de pagos real.** La documentación lo dice; para clientes reales es una brecha |
| RF24 Confirmación del pago firmada e idempotente | Implementado (003), simulada | `recibir-notificacion.ts:23`, `aplicar-resultado.ts:38`. Prueba: `ti/pagos/notificaciones.spec.ts` | PARCIAL | Solo contra el simulador |
| RF25 Historial de pagos | Implementado (003) | `historial-de-pagos.ts:30`. Pruebas: `ti/pagos/historial.spec.ts`, `ft/historial-pagos.spec.tsx` | CONSTRUIDO | |
| RF26 Conciliar pagos pendientes | Implementado (003), simulada | `conciliar-pagos.ts:25`. Prueba: `ti/pagos/conciliacion.spec.ts` | PARCIAL | Solo contra el simulador |
| RF27 Asistente de IA del cliente | Implementado (005) "con el proveedor falso; OpenRouter solo en desarrollo" | `b/asistente-reportes/asistente/application/preguntar-al-asistente.ts:72`; `asistente.controller.ts:29`. Interfaz: `f/pages/cliente/Asistente.tsx`. Pruebas: `ti/asistente/asistente-cliente.spec.ts`, `pr19-adversarial.spec.ts`, `ft/asistente.spec.tsx` | PARCIAL | En producción no hay IA real: `backend/src/shared/config/configuracion.ts:240` impide OpenRouter con `NODE_ENV=production`, y el valor por defecto es `ninguno` (`:230`) |
| RF28 Asistente del propietario | Implementado (005), solo lectura | Mismo caso de uso; prueba `ti/asistente/asistente-propietario.spec.ts`. Interfaz: pestaña "Preguntar" de `f/pages/panel/Reportes.tsx` (`ft/reportes-preguntar.spec.tsx`) | PARCIAL | Mismo motivo que RF27 |
| RF29 Reportes por período | Implementado (005) | `consultar-reportes.ts:23`; `reportes.controller.ts:32`. Pruebas: `ti/reportes/reportes.spec.ts`, `ft/reportes.spec.tsx` | CONSTRUIDO | |
| RF30 Avisos de la cita por correo y WhatsApp | Implementado (004) | `b/notificaciones/application/manejadores-de-cita.ts:19`, `enviar-avisos.ts:81`, `infrastructure/canal-correo-smtp.ts`, `canal-whatsapp-simulado.ts`. Pruebas: `ti/notificaciones/avisos-cita.spec.ts`, `respaldo-whatsapp.spec.ts`, `correo-caido.spec.ts` | PARCIAL | El correo por SMTP es real, pero solo se probó con Mailpit. **WhatsApp solo está simulado**; sin proveedor, `WHATSAPP_PROVEEDOR=ninguno` (`configuracion.ts:392`) |
| RF31 Auditoría e indicadores de la plataforma | Implementado; la vista de auditoría "no construida" | `backend/src/shared/audit/audit-log.ts`; `b/acceso-barberias/identidad/presentation/indicadores-plataforma.controller.ts:16`. Interfaz: `/plataforma/indicadores`. Pruebas: `ti/auditoria.spec.ts`, `ti/plataforma/indicadores-plataforma.spec.ts`, `ft/plataforma-indicadores.spec.tsx` | CONSTRUIDO | Coincide con lo documentado |
| RF32 Solicitudes de acceso, rectificación y eliminación | Parcial (007) | `b/acceso-barberias/solicitudes-datos/presentation/solicitudes-datos.controller.ts:36-84`. Interfaz: `f/pages/cliente/MisDatos.tsx`, `panel/MisDatos.tsx`, `panel/SolicitudesDatos.tsx`. Pruebas: `ti/solicitudes-datos/solicitudes-datos.spec.ts`, `ft/solicitudes-datos.spec.tsx`, `ft/mis-datos.spec.tsx` | PARCIAL | Coincide con lo documentado: sin oposición, sin avisos, sin las solicitudes del propietario y sin anonimización |
| RF33 Elegir el canal y el consentimiento de WhatsApp | Implementado (004) | `b/acceso-barberias/clientes/application/canal-de-aviso.ts:39`; `aviso.controller.ts:17-36`. Interfaz: `f/pages/cliente/CanalAviso.tsx`. Pruebas: `ti/clientes/canal-aviso.spec.ts`, `ft/canal-aviso.spec.tsx` | CONSTRUIDO | WhatsApp simulado (RF30) |
| RF34 Recordatorio con enlaces de un solo uso | Implementado (004) | `b/notificaciones/application/manejador-recordatorio.ts:15`; `b/catalogo-citas/citas/application/accion-por-enlace.ts:63`; `enlaces.controller.ts:29-55`. Interfaz: `f/pages/publico/Enlace.tsx`. Pruebas: `ti/enlaces/*.spec.ts` (6), `ft/enlace.spec.tsx` | CONSTRUIDO | |
| RF35 Adelanto de reserva por QR | Implementado (008) | `b/suscripciones-pagos/adelantos/application/configurar-adelanto.ts:54`, `registrar-pago.ts:34`; `b/catalogo-citas/citas/application/confirmar-adelanto.ts:24`, `vencer-adelantos.ts:35`. Interfaz: `/app/adelanto`, `/app/adelantos`, `/mis-citas/:id/adelanto`. Pruebas: `ti/adelantos/*.spec.ts` (15), `ft/adelanto.spec.tsx`, `ft/pagar-adelanto.spec.tsx` | CONSTRUIDO | |

### 1.2 Requisitos no funcionales (escenarios EQ-01 a EQ-24)

Fuente: `docs/01-analisis-de-sistema/04-atributos-de-calidad.md` y `08-escenarios-atributos-calidad.md`.

| Elemento | Qué dice la documentación | Evidencia | Estado | Observación |
| --- | --- | --- | --- | --- |
| EQ-01 Horarios en hora pico | Medido en local (006) | `backend/scripts/medir-horarios.ts`; resultados en `specs/006-…/quickstart.md` | PARCIAL | Medición preliminar sin k6; coincide con lo documentado |
| EQ-02 Reserva bajo carga | Por medir | No existe `tecnologia/plataforma-barberias/carga/` | NO CONSTRUIDO | Coincide (009, US1, pendiente) |
| EQ-03 Agregar una instancia | Por medir | — | NO CONSTRUIDO | Coincide |
| EQ-04 Caída de una réplica | Medido (006) | `backend/scripts/demo-caida.ts`; `ti/escalado/balanceador.spec.ts` | CONSTRUIDO | |
| EQ-05 Caída de Redis | Medido (006) | `ti/escalado/redis-caido.spec.ts` | CONSTRUIDO | |
| EQ-06 Fallo de IA, pagos o mensajería | Parcial | `ti/pagos/proveedor-caido.spec.ts`, `ti/notificaciones/correo-caido.spec.ts`, `ti/asistente/degradacion-asistente.spec.ts` | PARCIAL | Solo contra simuladores; coincide |
| EQ-07 Autenticación | En verde (PR07) | `ti/identidad/autenticacion.spec.ts`, `ti/host/auth-guard.spec.ts` | CONSTRUIDO | |
| EQ-08 Autorización por rol | En verde (PR08) | `tc/rbac*.spec.ts` (7 archivos) | CONSTRUIDO | |
| EQ-09 Aislamiento entre barberías | En verde (PR09) | `ti/aislamiento/*.spec.ts` (17 archivos); T025 de 009 con Docker real (14/14) | CONSTRUIDO | |
| EQ-10 Validación de entradas | En verde (PR10) | `ti/host/entradas.spec.ts` | CONSTRUIDO | El registro del cliente no valida el formato del correo en el DTO (`clientes.dto.ts:26-28`); lo hace el dominio (`correo.ts:4-16`). Funciona igual |
| EQ-11 Secretos | Por medir | `evidencia/scripts/revisar-secretos.mjs` en la CI (`.github/workflows/plataforma-barberias.yml:76`, de 009) | PARCIAL | La documentación dice "gitleaks: Planificada"; desde 009 hay un revisor propio en la CI que la documentación aún no menciona |
| EQ-12 Límite de solicitudes | En verde (PR12) | `ti/identidad/limite-intentos.spec.ts`, `ti/escalado/limite-compartido.spec.ts` | CONSTRUIDO | |
| EQ-13 Auditoría | En verde (PR13) | `ti/auditoria.spec.ts` y las suites `*-auditoria.spec.ts` | CONSTRUIDO | |
| EQ-14 Cambiar de proveedor sin tocar el núcleo | Parcial | `npm run test:arch` (ver "Pruebas ejecutadas") | PARCIAL | Coincide: el cambio al proveedor real no se ha hecho |
| EQ-15 Reserva simple desde el celular | Por medir | — | NO CONSTRUIDO (sin medir) | Coincide |
| EQ-16 Reservas simultáneas | En verde (PR16) | `ti/citas/concurrencia-reservas.spec.ts` | CONSTRUIDO | |
| EQ-17 Notificación de pago repetida | En verde (PR17) | `ti/pagos/notificaciones.spec.ts` | CONSTRUIDO | |
| EQ-18 Consentimiento y derechos | Parcial | Ver RF05 y RF32 | PARCIAL | Además, el texto de la política no está publicado (ver 7) |
| EQ-19 Privacidad en el asistente | En verde con el proveedor falso | `ti/asistente/pr19-adversarial.spec.ts` | PARCIAL | Sin proveedor real, la resistencia a la inyección no se probó con un modelo real |
| EQ-20 Puertos y adaptadores | Parcial | `tc/payment-gateway.contract.ts`, `tc/notification-channel.contract.ts`, `tc/ai-provider.contract.ts` | PARCIAL | Coincide |
| EQ-21 Diagnóstico de extremo a extremo | Por medir | `ti/host/registros.spec.ts` (identificador de correlación) | PARCIAL | Sin métricas ni alertas; coincide |
| EQ-22 Respaldo y restauración | Por medir | — | NO CONSTRUIDO | Coincide (009, US5, pendiente) |
| EQ-23 Comprobantes privados del adelanto | Medido (008) | `ti/adelantos/aislamiento-adelantos.spec.ts`, `registro-pago-adelanto.spec.ts` | CONSTRUIDO | |
| EQ-24 El adelanto confirma una sola vez | Medido (008) | `ti/adelantos/confirmacion-adelanto-concurrencia.spec.ts` | CONSTRUIDO | |

**Errores en `04-atributos-de-calidad.md` encontrados en este grupo:**
- **Línea 77:** dice "`npm audit` en la CI (Planificado… aún no está en el workflow)". La CI ya lo ejecuta (`.github/workflows/plataforma-barberias.yml:28` en el backend, `audit-ci` en `:52` en el frontend). **DOC INCORRECTA.**
- **Línea 80:** dice "19 reglas"; `08-escenarios-atributos-calidad.md:383` dice "24/24". Según la línea 80, 24/24 son las *pruebas* y 19 las *reglas*. Es ambiguo, pero no es un error.

---

## 2. Actores y capacidades (ACT-01 a ACT-04, EXT-01 a EXT-04)

Fuente: `docs/01-analisis-de-sistema/01-actores.md`. Para cada capacidad: si existe en el backend y si hay una pantalla alcanzable desde un menú o un enlace.

| Elemento | Qué dice la documentación | Evidencia (backend · pantalla y cómo se llega) | Estado | Observación |
| --- | --- | --- | --- | --- |
| ACT-01 Ingresar con contraseña y segundo factor | Funciona | `plataforma-auth.controller.ts:38,46` · `/plataforma/ingresar` (`ft/plataforma-ingreso.spec.tsx`) | CONSTRUIDO | La cuenta se crea solo por consola (`npm run plataforma:crear-admin`) |
| ACT-01 Lista de barberías; suspender y reactivar | Funciona | `barberias-plataforma.controller.ts:54-79` · menú `/plataforma/barberias` | CONSTRUIDO | |
| ACT-01 Suspender y reactivar la suscripción; activar un plan a mano | Funciona | `suscripciones-plataforma.controller.ts:53,63,72` · `f/api/plataforma.ts:156-164` desde `/plataforma/barberias` | CONSTRUIDO | |
| ACT-01 Comprobantes y pagos por revisar | Funciona | `comprobantes-plataforma.controller.ts:62-86`, `pagos-plataforma.controller.ts:30,35` · menús `/plataforma/comprobantes` y `/plataforma/pagos-por-revisar` | CONSTRUIDO | |
| ACT-01 Indicadores agregados | Funciona (007) | `indicadores-plataforma.controller.ts:16` · menú `/plataforma/indicadores` | CONSTRUIDO | |
| ACT-01 Ver la auditoría | "no construido" | No hay ruta | NO CONSTRUIDO | Coincide |
| ACT-02 Registrar su barbería | Funciona | `barberias.controller.ts:17` · botón "Registra tu barbería gratis" en `/` | CONSTRUIDO | |
| ACT-02 Datos, horario, servicios, barberos y usuarios | Funciona | Ver RF03 y RF06–RF09 · menús `/app/barberia`, `/app/servicios`, `/app/barberos`, `/app/usuarios` (`f/components/app/DisenoApp.tsx:22-39`) | CONSTRUIDO | |
| ACT-02 Registrar citas presenciales | Funciona | `citas.controller.ts:65` · botón "Cita presencial" en `/app/agenda` (`f/pages/panel/Agenda.tsx:137`) | CONSTRUIDO | |
| ACT-02 Ver la agenda | Funciona | Ver RF16 · menú `/app/agenda` | CONSTRUIDO | |
| ACT-02 Contratar y pagar la suscripción | Funciona | Ver RF20 y RF23 · menú `/app/suscripcion` | PARCIAL | Pasarela simulada; la transferencia con comprobante sí es real |
| ACT-02 Reportes y asistente | Funciona (005) | Ver RF28 y RF29 · menú `/app/reportes` | PARCIAL | El asistente solo funciona con el proveedor falso |
| ACT-02 Atender solicitudes de datos | Funciona (007) | Ver RF32 · menú `/app/solicitudes-datos` | CONSTRUIDO | |
| ACT-02 Sus propias solicitudes de datos | "no construido" | — | NO CONSTRUIDO | Coincide |
| ACT-02 Configurar el adelanto y revisar los pagos | Funciona (008) | Ver RF35 · menús `/app/adelanto` y `/app/adelantos` | CONSTRUIDO | |
| ACT-03 Agenda, disponibilidad y bloqueos | Funciona | Menús `/app/agenda` y `/app/disponibilidad` | CONSTRUIDO | |
| ACT-03 Marcar citas completadas o no asistidas | Funciona | `citas.controller.ts:54` · botones en `Agenda.tsx:289,297` | CONSTRUIDO | |
| ACT-03 Solicitudes sobre sus datos | Funciona (007) | Menú `/app/mis-datos` | CONSTRUIDO | |
| ACT-03 Activar su cuenta | Implícito | `auth.controller.ts:100` · `/activar?token=` | PARCIAL | El enlace lo entrega el propietario a mano; no llega por correo |
| ACT-04 Ver servicios y barberos por el enlace | Funciona | Ver RF10 · `/b/<slug>` | CONSTRUIDO | |
| ACT-04 Horarios libres | Funciona | Ver RF11 | CONSTRUIDO | |
| ACT-04 Crear su cuenta con consentimiento | Funciona | Ver RF05 · `/b/<slug>/registro` | PARCIAL | Sin verificación del correo y sin el texto de la política |
| ACT-04 Reservar, reprogramar y cancelar | Funciona | Ver RF12–RF14 | CONSTRUIDO | |
| ACT-04 Ver su historial | Funciona | Ver RF17 | CONSTRUIDO | Llegar a la pantalla es difícil (ver 5) |
| ACT-04 Recibir la fecha y hora por correo o WhatsApp | Funciona (004; WhatsApp simulado) | Ver RF30 | PARCIAL | |
| ACT-04 Responder al recordatorio | Funciona | Ver RF34 · `/e#<token>` | CONSTRUIDO | |
| ACT-04 Consultar al asistente | Funciona (005) | Ver RF27 · `/asistente` | PARCIAL | Solo el proveedor falso |
| ACT-04 Solicitudes sobre sus datos | Funciona (007) | Ver RF32 · `/mis-datos` | CONSTRUIDO | |
| ACT-04 Oposición y avisos de la solicitud | "no construido" | — | NO CONSTRUIDO | Coincide |
| EXT-01 Proveedor de pagos | "Simulado" | `fabrica-pasarela.ts:15-18` | PARCIAL | Coincide |
| EXT-02 Proveedor de IA | "Planificado" | Hay un adaptador de OpenRouter (`ti/…`, `tc/ai-provider-openrouter*.contract.spec.ts`) y un proveedor falso; OpenRouter está prohibido en producción | DOC INCORRECTA | La tabla dice "Planificado" y "sin elegir", pero ADR-027 eligió OpenRouter para desarrollo y está implementado. Debería decir "solo desarrollo (OpenRouter) y falso; sin proveedor de producción" |
| EXT-03 Servicio de correo | "Planificado" | `canal-correo-smtp.ts` (SMTP real, probado con Mailpit) | DOC INCORRECTA | El adaptador SMTP está construido (ADR-026). Falta contratar un proveedor SMTP real, pero el estado "Planificado" es engañoso |
| EXT-04 WhatsApp | "Planificado" | `canal-whatsapp-simulado.ts` y `backend/simulador-whatsapp/` | PARCIAL | Mejor decir "Simulado", como en EXT-01 |

---

## 3. Specs 001 a 008: tareas marcadas como hechas

Para cada `tasks.md`, se contaron las tareas `[X]` y `[ ]` y se comprobó que existan los archivos que nombra cada tarea hecha. Se resolvieron las abreviaturas `m01/`, `sd/` y `m04/`, y las rutas relativas al módulo.

| Spec | Hechas | Pendientes | Archivos citados que no existen | Estado | Observación |
| --- | --- | --- | --- | --- | --- |
| 001 Registro y acceso | 136 | 0 | 1: `frontend/src/components/BarraSuperior.tsx` (T089 y T112) | CONSTRUIDO | El botón "Cerrar sesión" está en `f/components/app/MenuUsuario.tsx:52`. **DOC INCORRECTA** (ruta vieja en `tasks.md`) |
| 002 Catálogo, citas y cliente | 133 | 2 | 0 | PARCIAL | Pendientes: **T130** (axe y Lighthouse de las pantallas de 002, nunca hecho) y **T134** (recorrer el quickstart) |
| 003 Suscripciones y pagos | 106 | 0 | 1: `backend/src/shared/cache/interruptor.ts` (T022) | CONSTRUIDO | Está en `backend/src/shared/resiliencia/interruptor.ts`. **DOC INCORRECTA** (ruta vieja) |
| 004 Notificaciones y reprogramación | 131 | 11 | 0 | PARCIAL | Pendientes: revisiones manuales (T056, T099, T121), cierres de fase con la CI en verde (T057, T075, T100, T122, T131, T142), el recorrido del quickstart (T132) y una imagen (T141). Los RF se dan por implementados sin las verificaciones de cierre marcadas |
| 005 Asistente y reportes | 54 | 10 | 4: `frontend/test/reportes.spec.tsx`, `asistente.spec.tsx`, `enlace-asistente.spec.tsx`, `reportes-preguntar.spec.tsx` | PARCIAL | Esas pruebas sí existen, en `frontend/test/pages/` (**DOC INCORRECTA**, ruta). Pendientes: todos los cierres de fase (T013, T025, T047, T056, T064), las revisiones del responsable (T024, T046, T055, T063) y el quickstart (T057) |
| 006 Escalado, caché y balanceo | 66 | 0 | 1: `shared/cache/interruptor.ts` (T011) | CONSTRUIDO | Misma ruta vieja que en 003 |
| 007 Indicadores y datos personales | 59 | 20 | 0 | PARCIAL | Pendientes: verificaciones de fase (T018, T025, T041, T055, T067, T078), revisiones y pasos manuales (T017, T040, T053, T054, T066, T068, T077), commits (T019, T026, T042, T056, T069, T079) y el quickstart (T070). **Ojo:** T053 y T066 son pasos manuales sobre el volumen y el `.env` del responsable (rol `barberias_conteos` e `INTENTOS_SAL_IP`) |
| 008 Adelanto por QR | 64 | 7 | 0 | PARCIAL | Pendientes: revisiones manuales (T019, T034, T046, T061), cronómetro (T062), quickstart (T064) y confirmación (T070) |

**Conclusión del grupo 3:**
- **Archivos:** de las 749 tareas marcadas como hechas, ninguna apunta a un archivo inexistente, salvo las 4 rutas viejas de la tabla (los archivos existen en otro lugar).
- **Pendientes:** las tareas sin marcar son, casi todas, verificaciones manuales, cierres de CI y recorridos del quickstart que el responsable no confirmó.
- **Estado de los RF:** la documentación da los RF por "implementados" aunque esas verificaciones de cierre (004, 005, 007 y 008) siguen abiertas. No es una mentira sobre el código, pero sí declara terminado algo que no se verificó del todo.
- **Límite de este método:** comprobar que un archivo existe no prueba que la tarea se hizo bien. El contenido se revisó por muestreo en los grupos 1, 2 y 5.

---

## 4. ADR: estado y si el código los respeta

Fuente: `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`.

| Elemento | Estado en el documento | Evidencia de que el código lo respeta | Estado | Observación |
| --- | --- | --- | --- | --- |
| ADR-001 Monolito modular | Propuesto | `backend/src/modules/` (6 módulos) y las reglas de `backend/.dependency-cruiser.cjs` | DOC INCORRECTA | Está implementado desde 001, pero sigue como "Propuesto" |
| ADR-002 Cuatro capas | Propuesto | `domain/`, `application/`, `infrastructure/` y `presentation/` en cada módulo; `test:arch` | DOC INCORRECTA | Igual |
| ADR-003 Multi-tenant con RLS | Propuesto | `FORCE ROW LEVEL SECURITY` en las migraciones (`0001`, `0003`, `0009`, `0010`, `0014` y el ayudante `sql-comun.ts`); `ti/aislamiento/rls.spec.ts` | DOC INCORRECTA | Igual |
| ADR-004 PostgreSQL | Propuesto | Kysely y migraciones 0001–0035 | DOC INCORRECTA | Igual |
| ADR-005 Redis como caché | Propuesto | `CacheCompartida`; `ti/escalado/cache-catalogo.spec.ts` | DOC INCORRECTA | Igual (ADR-029 lo concreta) |
| ADR-006 Balanceador | Propuesto | Nginx con 2 réplicas en `docker-compose.yml` (ADR-030) | DOC INCORRECTA | Igual |
| ADR-007 Pagos desacoplados | Propuesto | Puerto `PaymentGateway` con suite de contrato | DOC INCORRECTA | Igual |
| ADR-008 IA desacoplada | Aceptado en lo construido (005) | Puerto `AIProvider`; `tc/ai-provider.contract.ts` | CONSTRUIDO | |
| ADR-009 Sin reservas duplicadas | Propuesto | `0011_citas.ts:51` (`EXCLUDE`) e `Idempotency-Key` | DOC INCORRECTA | Implementado, sigue "Propuesto" |
| ADR-010 Autenticación, autorización y aislamiento | Propuesto | Token en memoria (`f/api/client.ts:80`) y cookie `HttpOnly`; RLS | DOC INCORRECTA | Igual |
| ADR-011 Clean Architecture | Propuesto | Igual que ADR-002 | DOC INCORRECTA | Igual |
| ADR-012 Resiliencia | Aceptado en lo construido (IA) | `backend/src/shared/resiliencia/interruptor.ts`; `tu/shared/interruptor.spec.ts` | CONSTRUIDO | Métricas por proveedor no construidas (coincide) |
| ADR-013 Notificaciones multicanal | Aceptado | Ver RF30 | CONSTRUIDO | WhatsApp simulado |
| ADR-014 React, Vite y TypeScript | Propuesto | `frontend/` | DOC INCORRECTA | Implementado |
| ADR-015 Autenticación antes del tenant | Propuesto | `iniciar-sesion.ts:69` (`ejecutarSinTenant`) | DOC INCORRECTA | Implementado |
| ADR-016 Sistema de diseño con Radix | Propuesto | `f/components/ui` | DOC INCORRECTA | Implementado |
| ADR-017 Indicador `hay_sesion` | Propuesto | `f/auth/indicadorSesion.ts` | DOC INCORRECTA | Implementado |
| ADR-018 Carga diferida de rutas | Propuesto | `f/routes.tsx:13-65` (`lazy`) | DOC INCORRECTA | Implementado |
| ADR-019 Gracia en la rotación del token | Propuesto | `renovar-sesion.ts:44-63` | DOC INCORRECTA | Implementado |
| ADR-020 Membresía y sesión por barbería | Aceptado | `iniciar-sesion.ts:122-145`; `ti/aislamiento/cliente-dos-barberias.spec.ts` | CONSTRUIDO | |
| ADR-021 Lecturas públicas por `slug` | Aceptado | `publico.controller.ts`; `ti/aislamiento/lectura-publica.spec.ts` | CONSTRUIDO | |
| ADR-022 Pasarela simulada y transferencia | Aceptado | Ver RF23 | CONSTRUIDO | El ADR acepta la simulación; para clientes reales falta el proveedor |
| ADR-023 Comprobantes privados | Aceptado | `ti/pagos/comprobantes.spec.ts` | CONSTRUIDO | |
| ADR-024 Tareas sin duplicados | Aceptado | `ti/tareas/ejecutor-postgres.spec.ts`, `vencimiento-dos-replicas.spec.ts` | CONSTRUIDO | |
| ADR-025 Outbox | Aceptado e implementado | `backend/src/shared/eventos/`; `ti/shared/salida-eventos*.spec.ts` | CONSTRUIDO | |
| ADR-026 Correo y WhatsApp tras `NotificationChannel` | Aceptado e implementado | `tc/canal-correo.contract.spec.ts`, `canal-whatsapp.contract.spec.ts` | CONSTRUIDO | |
| ADR-027 OpenRouter solo en desarrollo | Aceptado e implementado | `configuracion.ts:240-244` | CONSTRUIDO | |
| ADR-028 Contrato del asistente | Aceptado e implementado | `ti/asistente/cuotas-asistente.spec.ts`, `pr19-adversarial.spec.ts` | CONSTRUIDO | |
| ADR-029 Caché por barbería y límite compartido | Aceptado | `ti/escalado/limite-compartido.spec.ts`, `ti/aislamiento/aislamiento-cache.spec.ts` | CONSTRUIDO | |
| ADR-030 Nginx en local | Aceptado | `docker-compose.yml`, `nginx/` | CONSTRUIDO | |
| ADR-031 Operaciones de la plataforma | Aceptado; revisión de 007 implementada | `ti/aislamiento/lectura-plataforma.spec.ts`, `ti/host/token-plataforma.spec.ts` | CONSTRUIDO | |
| ADR-032 Acciones por enlace firmado | Aceptado e implementado | Ver RF34 | CONSTRUIDO | |
| ADR-033 Adelanto por QR | Aceptado e implementado | Ver RF35 | CONSTRUIDO | |
| ADR-034 k6 en contenedor (009) | Aprobado en `specs/009-…/borradores/adr-034-k6.md`; no está en `07-decisiones` | Sin `carga/` | NO CONSTRUIDO | Coincide: se aplica en T045 de 009 |
| ADR-035 Publicación por túnel (009) | Aprobado en un borrador; no está en `07-decisiones` | — | NO CONSTRUIDO | Coincide: T151 de 009 |

**Conclusión del grupo 4:**
- **Estados desactualizados:** 16 ADR (001–007, 009–011 y 014–019) siguen como "Propuesto" aunque el código los implementa. El código **respeta** las decisiones; lo que falla es su estado en el documento.
- **Cómo se comprobó:** `test:arch` se ejecutó en esta auditoría (resultado en "Pruebas ejecutadas").

---

## 5. Flujos de extremo a extremo

La alcanzabilidad se comprobó en `f/routes.tsx` y en los enlaces y botones de cada pantalla. No se hizo un recorrido en el navegador.

### 5.1 Cliente

| Paso | Qué dice la documentación | Pantalla y cómo se llega (evidencia) | Estado | Camino sin salida o botón que falta |
| --- | --- | --- | --- | --- |
| Encontrar la barbería | "por el enlace de la barbería" (ACT-04) | `/b/<slug>`, solo si alguien comparte el enlace (`f/routes.tsx:142`). La portada `/` es para propietarios | CONSTRUIDO | No hay buscador ni directorio de barberías. Es una decisión, pero un cliente sin el enlace no tiene cómo llegar |
| Registrarse | ACT-04 | El botón "Crear cuenta y reservar" **solo aparece después de elegir servicio, barbero, día y hora** (`CatalogoPublico.tsx:248-274`). La ruta `/b/<slug>/registro` existe | PARCIAL | **Falta un botón "Crear cuenta" e "Ingresar" en el encabezado de `/b/<slug>`.** Sin correo verificado ni texto de la política |
| Ingresar | ACT-04 | Lo mismo: "Ya tengo cuenta" solo aparece tras elegir una hora; `/b/<slug>/ingresar` existe (`IngresarBarberia.tsx`) | PARCIAL | Sin "¿Olvidaste tu contraseña?": **un cliente que la olvida no tiene salida** |
| Ingresar desde `/ingresar` o al abrir `/mis-citas` sin sesión | — | `RutaProtegida` envía a `/ingresar` (`f/auth/RutaProtegida.tsx:19,32`). Para un cliente, el backend responde `INGRESA_DESDE_TU_BARBERIA` ("Ingresa desde el enlace de tu barbería…", `errores.ts:79-83`) | PARCIAL | **Sin salida:** el mensaje no dice cuál es el enlace ni ofrece ir a él |
| Reservar | RF12 | Elegir la hora, "Reservar esta hora" y luego `/b/<slug>/reservar` (`Reservar.tsx`); al terminar, "Ver mis citas" (`Reservar.tsx:288`) | CONSTRUIDO | |
| Reprogramar | RF13 | `/mis-citas`, botón "Reprogramar" (`MisCitas.tsx:196`); también desde el recordatorio `/e` | CONSTRUIDO | |
| Cancelar | RF14 | `/mis-citas`, botón "Cancelar" (`MisCitas.tsx:205`) | CONSTRUIDO | |
| Ver su historial | RF17 | `/mis-citas` | PARCIAL | **Desde `/b/<slug>` con la sesión abierta no hay enlace a "Mis citas"**: solo aparece "Preguntar al asistente" (`CatalogoPublico.tsx:148-155`). Se llega tras reservar o escribiendo la URL |
| Cerrar sesión | RF04 | Botón en `/mis-citas`, `/mis-avisos` y `/mis-datos` (`MisCitas.tsx:103`, `CanalAviso.tsx:46`, `MisDatos.tsx:23`) | PARCIAL | No está en `/b/<slug>` ni en `/asistente` |
| Recibir el aviso | RF30 | Correo por SMTP (Mailpit en desarrollo); WhatsApp simulado | PARCIAL | Ver RF30 |
| Elegir el canal | RF33 | `/mis-avisos`, botón "Cómo recibo mis avisos" en `/mis-citas` (`MisCitas.tsx:118`) | CONSTRUIDO | |
| Consultar al asistente | RF27 | `/asistente`, botón en `/mis-citas` (`:122`) y en `/b/<slug>` con sesión (`CatalogoPublico.tsx:151`) | PARCIAL | Proveedor falso |
| Pedir sus datos (007) | RF32 | `/mis-datos`, botón en `/mis-citas` (`:126`) | PARCIAL | Sin avisos de respuesta: el cliente tiene que volver a mirar |
| Pagar el adelanto | RF35 | Se abre solo después de reservar (`Reservar.tsx:136`) y desde `/mis-citas` (`:180`) | CONSTRUIDO | |
| Unirse a otra barbería | ADR-020 | Formulario de unión en `IngresarBarberia.tsx:51-87` y `Reservar.tsx:58-83` | CONSTRUIDO | |

### 5.2 Propietario

| Paso | Pantalla y evidencia | Estado | Observación |
| --- | --- | --- | --- |
| Registrar la barbería | `/` → `/registro` (`Registro.tsx`) → `/app` | CONSTRUIDO | Los términos y la política se aceptan sin poder leerlos (`Registro.tsx:198,215`) |
| Configurar datos, horario, servicios, barberos y usuarios | Menú lateral (`DisenoApp.tsx:22-39`) | CONSTRUIDO | |
| Dar acceso a un barbero | `/app/usuarios` → enlace de activación (`Usuarios.tsx:164`) | PARCIAL | El enlace se copia y se envía a mano |
| Compartir su enlace | `/app/barberia`, "Copiar enlace" (`Barberia.tsx:163-168`) | CONSTRUIDO | |
| Agenda y citas presenciales | `/app/agenda` | CONSTRUIDO | |
| Suscripción y pago | `/app/suscripcion`; aviso con botón (`AvisoSuscripcion.tsx:86`) | PARCIAL | Pasarela simulada |
| Reportes y asistente | `/app/reportes` | PARCIAL | Proveedor falso |
| Adelantos | `/app/adelanto` y `/app/adelantos` | CONSTRUIDO | |
| Solicitudes de datos | `/app/solicitudes-datos` | CONSTRUIDO | |
| Recuperar la contraseña | — | NO CONSTRUIDO | Sin salida si la olvida |

### 5.3 Barbero

| Paso | Pantalla y evidencia | Estado | Observación |
| --- | --- | --- | --- |
| Activar la cuenta | `/activar?token=` (`Activar.tsx:81`), con el enlace que le da el propietario | PARCIAL | No lo recibe por correo |
| Ingresar | `/ingresar` → `/app` | CONSTRUIDO | |
| Agenda; marcar completada o no asistió | `/app/agenda` (`Agenda.tsx:289,297`) | CONSTRUIDO | |
| Disponibilidad y bloqueos | `/app/disponibilidad` | CONSTRUIDO | |
| Sus solicitudes de datos | `/app/mis-datos` | CONSTRUIDO | |

### 5.4 Administrador de la plataforma

| Paso | Pantalla y evidencia | Estado | Observación |
| --- | --- | --- | --- |
| Crear la cuenta | Solo por consola: `npm run plataforma:crear-admin` | CONSTRUIDO | Es intencional, pero no hay pantalla |
| Ingresar con segundo factor | `/plataforma/ingresar` | CONSTRUIDO | |
| Barberías, suscripciones y activación manual | `/plataforma/barberias` | CONSTRUIDO | |
| Comprobantes y pagos por revisar | `/plataforma/comprobantes` y `/plataforma/pagos-por-revisar` | CONSTRUIDO | |
| Indicadores | `/plataforma/indicadores` | CONSTRUIDO | |
| Auditoría | — | NO CONSTRUIDO | Coincide con la documentación |

---

## 6. Lo que la documentación promete y no está construido

Esta lista sale de los propios documentos, más lo que esta auditoría encontró que nadie promete pero un cliente real necesita.

**Declarado "no construido" o "planificado" en la documentación (coincide con el código):**
1. Oposición al tratamiento de datos (RF32 y ACT-04).
2. Avisos al solicitante sobre su solicitud de datos (RF32 y ACT-04).
3. Solicitudes del propietario sobre su propia cuenta (RF32 y ACT-02).
4. Anonimización (RF32 y la aclaración de 007).
5. Vista de la auditoría para el administrador (RF31 y HU26).
6. Proveedor de pagos real (Culqi): `fabrica-pasarela.ts:18` lanza un error (RF23 y EXT-01).
7. Proveedor de WhatsApp real (EXT-04).
8. Proveedor de IA de producción (ADR-027).
9. Métricas y alertas, táctica T10 (EQ-21).
10. Pruebas de carga con k6 (EQ-02 y EQ-03; `carga/` no existe; 009, US1).
11. Simulacro de respaldo y restauración (EQ-22; 009, US5).
12. Medición de usabilidad con personas (EQ-15) y Lighthouse y axe sobre las pantallas de 002 en adelante (T130 de 002).
13. Despliegue en la nube: AWS "documentado, no ejecutado" (`03-requisitos-funcionales.md:54`).

**No construido y no prometido en ningún documento vigente, pero necesario para clientes reales:**

14. Verificación del correo del cliente: aplazada en `specs/002-…/spec.md:311` ("mejora por evaluar") y nunca retomada.
15. Recuperación de contraseña: aplazada en `specs/001-…/spec.md:191` y `specs/002-…/spec.md:317` ("se tratará por separado") y nunca retomada.
16. Página con el texto de los términos de uso y de la política de tratamiento de datos. `seguridad-y-privacidad.md:139` dice que las cookies "deben figurar en la política de privacidad", pero esa política no existe en la interfaz.
17. Envío del enlace de activación del personal por correo (`enlace-activacion.ts:14-16`: "cuando exista M05, se enviará por correo"; M05 ya existe).

---

## 7. Seguridad y datos reales

| Elemento | Qué dice la documentación | Evidencia | Estado | Observación |
| --- | --- | --- | --- | --- |
| Correo del cliente sin verificar | `specs/002/spec.md:311`: "no se exige… mejora por evaluar" | `registrar-cliente.ts:64-93` abre la sesión al registrarse; no hay columna ni token de verificación | NO CONSTRUIDO | **Bloqueante para clientes reales:** cualquiera puede registrarse con un correo ajeno, y los avisos de citas le llegarían a esa persona |
| Enumeración de cuentas en el registro | No documentado como riesgo | Un correo existente responde 409 `CORREO_NO_DISPONIBLE` (`error.filter.ts:21`, `kysely-usuario-repository.ts:78`), y la interfaz dice "Ya tienes una cuenta con ese correo" (`RegistroCliente.tsx:74-75,150-152`) | PARCIAL | Revela qué correos tienen cuenta. Lo frena el límite `REGISTRO_LIMITE_POR_MINUTO` (`clientes.controller.ts:15,33`) |
| Enumeración en el inicio de sesión | FR-009 de 001 | `iniciar-sesion.ts:81-90`: mismo costo y mismo 401 exista o no la cuenta; los códigos especiales solo salen tras verificar la contraseña (`:99-100`) | CONSTRUIDO | Correcto |
| Límite de intentos de ingreso | EQ-12 | `iniciar-sesion.ts:71-77`; `ti/identidad/limite-intentos.spec.ts` | CONSTRUIDO | |
| Secretos obligatorios | EQ-11 | `configuracion.ts:116-122` (`secreto` con largo mínimo y sin mostrar el valor) | CONSTRUIDO | |
| Valores de desarrollo por defecto en Compose | `docker-compose.yml` lo comenta como desarrollo | `docker-compose.yml:58-61,83,177-179`: `PAGOS_LLAVE_SECRETA` usa `sk_simulador_dev`, `PAGOS_SECRETO_FIRMA` usa `whsec_simulador_dev_…`, `WHATSAPP_TOKEN` usa `whatsapp_simulado_dev`, etc. Y en `:105`, `NODE_ENV: production` | PARCIAL | Riesgo si este Compose se publica (ADR-035, túnel de 009): **el modo "producción" acepta secretos de desarrollo y una pasarela simulada sin avisar**. Ninguna guarda lo impide, salvo la de OpenRouter |
| Pasarela simulada por defecto | ADR-022 | `configuracion.ts:128` (`?? 'simulado'`) | PARCIAL | En una instalación real, olvidar `PAGOS_PROVEEDOR` deja los cobros simulados; no hay una guarda para `NODE_ENV=production` |
| Datos ficticios en la base | — | Las migraciones solo insertan roles y planes (`0001:22`, `0004:19`, `0014:38-41`). No hay barberías ni personas de ejemplo | CONSTRUIDO | Los planes son datos del negocio; sus precios no están validados (no verificado) |
| Semilla de ejemplo | 009, US3: comando explícito, solo desarrollo | `semilla/cargar-semilla.mjs:254`: `SEMILLA_API` acepta cualquier URL, sin guarda; correos `@ejemplo.test` y contraseñas `DemoLocal-2026-*` en `semilla/datos.json` | PARCIAL | Nada impide cargarla contra una instalación publicada. El dominio `.test` no recibe correo, lo cual está bien |
| Texto de la política y de los términos | `seguridad-y-privacidad.md:139` | No hay página ni enlace (`Union.tsx:57`, `Registro.tsx:198,215`) | NO CONSTRUIDO | **Bloqueante legal (Ley 29733):** se acepta una política que el usuario no puede leer |
| Token de acceso en memoria y cookie `HttpOnly` | ADR-010 | `f/api/client.ts:80`; `localStorage` solo guarda el tema (`f/tema.ts:13`) | CONSTRUIDO | |
| Recuperación de contraseña | Aplazada (001, 002) | — | NO CONSTRUIDO | Sin ella, dar de baja una cuenta comprometida o recuperar el acceso exige intervención manual en la base |
| Revisión de secretos en el repositorio | EQ-11 "Planificada" | `.github/workflows/plataforma-barberias.yml:76` (`revisar-secretos.mjs`, 009) | PARCIAL | Construido en 009 sin commit; la documentación de EQ-11 no lo menciona aún |

---

## Pruebas ejecutadas en esta auditoría

Se ejecutaron el 2026-11-19 en la copia de trabajo, con `IA_PROVEEDOR=falso`, sin Docker y sin tocar el `.env` ni el volumen del responsable.

| Suite | Comando | Resultado |
| --- | --- | --- |
| Unitarias del backend | `npx jest --config jest.config.ts` | **57 de 57 suites, 1148 de 1148 pruebas en verde** (213 s). Jest avisa de un proceso que no cerró limpio (un temporizador abierto); no falla nada |
| Arquitectura | `npm run test:arch` | **dependency-cruiser sin violaciones** (440 módulos, 2030 dependencias); **3 de 3 suites, 50 de 50 pruebas** |
| Frontend | `npx vitest run` | **35 de 35 archivos, 263 de 263 pruebas en verde** (192 s) |
| Integración del backend | `npm run test:int` | **No ejecutada** (necesita Docker y Testcontainers, unas 150 suites). Esas pruebas existen; que hoy pasen queda **no verificado** en esta auditoría |
| De extremo a extremo y manuales | — | **No ejecutadas.** No existen pruebas de extremo a extremo (009, US2, pendiente) |

---

## A) Resumen por estado

Cada fila de las tablas cuenta una vez. Un mismo hueco puede aparecer en varios grupos; por ejemplo, la verificación del correo aparece en RF05, ACT-04, el flujo del cliente y la seguridad.

| Grupo | CONSTRUIDO | PARCIAL | NO CONSTRUIDO | DOC INCORRECTA | Total |
| --- | --- | --- | --- | --- | --- |
| 1.1 Requisitos funcionales (RF01–RF35) | 26 | 9 | 0 | 0 | 35 |
| 1.2 Escenarios de calidad (EQ-01–EQ-24) | 12 | 8 | 4 | 0 | 24 |
| 2 Actores y sistemas externos | 20 | 8 | 3 | 2 | 33 |
| 3 Specs 001–008 | 3 | 5 | 0 | 0 | 8 |
| 4 ADR | 17 | 0 | 2 | 16 | 35 |
| 5 Flujos de extremo a extremo | 22 | 12 | 2 | 0 | 36 |
| 7 Seguridad y datos reales | 5 | 5 | 3 | 0 | 13 |
| **Total** | **105** | **47** | **14** | **18** | **184** |

Notas:
- La lista del grupo 6 tiene 17 elementos no construidos: 13 los reconoce la documentación y 4 no los menciona.
- El grupo 3 tiene además 4 rutas viejas en `tasks.md` y el grupo 1 tiene 2 errores en `04-atributos-de-calidad.md`; están en C.
- Los 9 RF parciales tienen dos causas:
  - funcionan solo con un **simulador o un proveedor falso** (pagos, IA y WhatsApp);
  - les falta una parte que la documentación ya reconoce (RF32), o RF05: sin verificación del correo y sin el texto de la política.

## B) Brechas ordenadas por gravedad

### Bloqueantes para un cliente real

1. **El correo del cliente no se verifica.** Cualquiera se registra con un correo ajeno y obtiene la sesión al instante, y los avisos de citas le llegan a esa persona (`registrar-cliente.ts:64-93`). Quedó como "mejora por evaluar" en `specs/002/spec.md:311` y ningún documento posterior la retomó. **Resuelta en 010 (2026-11-23):** el cliente verifica su correo con un enlace de un solo uso antes de reservar, usar el asistente o pagar un adelanto (RF36). Límite: el propietario que registra su barbería no verifica su correo (mejora anotada en ADR-036).
2. **No hay recuperación de contraseña**, para nadie: cliente, propietario ni barbero. Quien la olvida no tiene salida (`specs/001/spec.md:191`, "se tratará por separado"; no está en el backlog). **Resuelta en 010 (2026-11-24):** cualquier cuenta con contraseña recupera el acceso con un enlace de 1 hora, con respuestas neutras, límites y cierre de todas sus sesiones (RF37).
3. **No se publica el texto de los términos ni de la política de tratamiento de datos.** El usuario acepta "la política (versión 2026-10)" sin poder leerla (`Union.tsx:57`, `Registro.tsx:198,215`). Es un problema de consentimiento informado (Ley 29733). **Resuelta en 010 (2026-11-23):** `/terminos` y `/privacidad` publican los textos con versión y fecha, enlazados desde la portada, los registros, la unión y los ingresos (RF38). Límites: los textos siguen marcados como borrador pendiente de revisión, y una versión nueva no pide volver a aceptar.
4. **No hay despliegue real.** Solo existe el Compose local; la nube está "documentada, no ejecutada", y la publicación por túnel de 009 (ADR-035) está pendiente.
5. **El Compose arranca en `NODE_ENV=production` con secretos de desarrollo y la pasarela simulada, sin ninguna guarda** (`docker-compose.yml:58-61,83,105`; `configuracion.ts:128`). Si se publica tal cual, quien conozca los secretos de desarrollo del repositorio podría firmar notificaciones de pago falsas.

### Importantes

6. **Enumeración de cuentas en el registro:** responde 409 `CORREO_NO_DISPONIBLE` con el texto "Ya tienes una cuenta con ese correo". El límite por minuto lo frena, pero no lo evita. **Sigue abierta** (fuera de 010 por decisión del responsable, research R14); la recuperación y la verificación de 010 sí responden de forma neutra.
7. **El cliente queda sin salida en la navegación:**
   - en `/b/<slug>` no hay "Ingresar" ni "Crear cuenta" hasta elegir una hora;
   - con la sesión abierta no hay "Mis citas" ni "Cerrar sesión";
   - al abrir `/mis-citas` sin sesión llega a `/ingresar`, que solo responde "Ingresa desde el enlace de tu barbería", sin decir cuál es.

   **Resuelta en 010 (2026-11-23):** las pantallas del cliente sin sesión (`/mis-citas`, `/asistente`, `/mis-avisos`, `/mis-datos` y el pago del adelanto) muestran "Ingresar" en la última barbería visitada o cómo llegar a ella, y vuelven a la pantalla pedida; nunca llevan al ingreso del personal (US4 de 010).
8. **El enlace de activación del barbero se entrega a mano**, aunque el correo (M05) ya existe.
9. **Proveedores externos solo simulados o falsos:**
   - pagos: Culqi lanza un error, aunque la transferencia con comprobante sí funciona;
   - WhatsApp: simulado;
   - IA: en producción queda sin proveedor;
   - correo: SMTP listo, pero sin un proveedor contratado.
10. **La semilla no tiene guarda contra una URL publicada:** `SEMILLA_API` acepta cualquier dirección.
11. **Verificaciones de cierre abiertas:** CI en verde, quickstart y revisiones manuales de 004, 005, 007 y 008, más T130 de 002 (axe y Lighthouse). La integración no se ejecutó en esta auditoría.
12. **El respaldo y la restauración no están probados** (EQ-22); tampoco hay pruebas de carga (EQ-02 y EQ-03).

### Menores

13. No hay un directorio de barberías: solo se llega por el enlace.
14. La agenda solo se consulta por día.
15. Pendientes que la documentación ya reconoce:
    - oposición, avisos de las solicitudes, solicitudes del propietario y anonimización;
    - vista de la auditoría;
    - métricas y alertas.
16. Los precios de los planes (S/ 49 y S/ 89) están fijos en una migración; no se verificó que estén validados.
17. Hay un comentario de código desactualizado en `enlace-activacion.ts:14-16` ("Mientras no exista M05…").

## C) Documentación que debe corregirse

1. **`docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`:** 16 ADR siguen como "Propuesto" aunque están implementados: 001–007, 009–011 y 014–019. Hay que actualizar su estado o aclarar qué significa "Propuesto".
2. **`docs/01-analisis-de-sistema/01-actores.md`:**
   - **EXT-02** dice "Planificado, sin elegir"; debería decir "OpenRouter solo en desarrollo y proveedor falso; sin proveedor de producción" (ADR-027).
   - **EXT-03** dice "Planificado"; el adaptador SMTP está construido y falta contratar el servicio.
   - **EXT-04** debería decir "Simulado", como EXT-01.
3. **`docs/01-analisis-de-sistema/04-atributos-de-calidad.md`:**
   - **línea 77:** dice que `npm audit` está "Planificado… aún no está en el workflow", pero ya está (`plataforma-barberias.yml:28,52`);
   - **línea 80:** "292 módulos, 1334 dependencias" está desactualizado (hoy son 440 y 2030);
   - **EQ-11 y gitleaks:** falta mencionar `revisar-secretos.mjs` cuando se haga el commit de 009.
4. **`docs/01-analisis-de-sistema/03-requisitos-funcionales.md`:**
   - **RF05:** falta decir "sin verificación del correo y sin el texto de la política publicado"; **corregido en 010** (RF05 ampliado y RF36 y RF38 nuevos);
   - **RF04:** falta decir "sin recuperación de contraseña"; **corregido en 010** (RF04 ampliado y RF37 nuevo);
   - **RF30:** dice "Implementado (004)" sin aclarar que WhatsApp está simulado;
   - **RF02:** aclarar qué significa "activar";
   - **conteo:** "34 implementados" no distingue lo que solo funciona con un simulador (RF23, RF24, RF26, RF27, RF28 y RF30).
5. **`docs/02-arquitectura-software/seguridad-y-privacidad.md:139`:** pide declarar las cookies "en la política de privacidad", pero esa política no existe. Hay que dejarlo como pendiente. **Corregido en 010:** la política existe (`/privacidad`) y declara las cookies.
6. **Rutas viejas en `tasks.md`:**
   - 001 (T089 y T112): `BarraSuperior.tsx`; el botón está en `MenuUsuario.tsx`;
   - 003 (T022) y 006 (T011): `shared/cache/interruptor.ts`; está en `shared/resiliencia/`;
   - 005 (T020, T038, T039 y T051): `frontend/test/*.spec.tsx`; están en `frontend/test/pages/`.
7. **`docs/05-gestion/02-backlog-y-sprints.md`:** faltan la verificación del correo, la recuperación de contraseña y el texto de los términos y la política. Las specs 001 y 002 los dejaron "para después" y no figuran en ningún backlog.
8. **`docs/trazabilidad.md` y `03-requisitos-funcionales.md`:** dicen que 004, 005, 007 y 008 están implementados, sin señalar que siguen abiertas sus verificaciones de cierre (CI, quickstart y revisiones manuales). Conviene marcarlos como "implementado, verificación de cierre pendiente".
