# Specification Quality Checklist: Suscripciones y pagos de las barberías

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Aclaraciones resueltas (2026-10-24, sección Clarifications de spec.md):**
  - FR-005, cambio de plan: rige al empezar el período pagado, sin prorrateo (P1: A).
  - FR-004, pago en período de gracia: el período nuevo empieza al terminar el vencido; los días de gracia cuentan dentro del período pagado (P2: A).
  - FR-005a, plan con límites menores que lo usado: nada se desactiva solo; no se crean ni reactivan usuarios o barberos hasta quedar por debajo, con aviso antes de pagar y en el panel (P3: A).
  - FR-006, barbería vencida: se gestionan las citas existentes; catálogo, horarios, disponibilidad, bloqueos y usuarios de solo lectura (P4: A).
- **Corregido en la revisión de calidad** (contradicciones y huecos sin decisión de negocio):
  - US5 y FR-035: la reactivación recalcula el estado por las fechas, en lugar de volver al estado anterior.
  - FR-009 y FR-004: las fechas del período se fijan al aprobarse el pago, no al iniciarlo.
  - FR-017: un pago anulado o expirado por la plataforma cede ante una aprobación del proveedor (FR-012a: el dinero recibido nunca se ignora).
  - FR-012: un solo pago abierto por suscripción, también ante intentos simultáneos.
  - Agregados: importe fijado al iniciar (FR-005b), devoluciones y contracargos (FR-017a), límites y datos mínimos de las notificaciones (FR-013a, FR-013b), número de operación y comprobante reutilizado (FR-020, FR-022b), importe exacto (FR-022a), revisión única (FR-022c), lista de pagos por revisar (FR-025a), tiempos de la conciliación y la expiración (FR-026, FR-027), duración del período y pago por adelantado (FR-004), US2 escenarios 8 y 9, y SC-011.
- Los nombres "Yape", "pasarela", "webhook" y "réplicas" vienen del pedido y de los acuerdos de alcance (backlog §3.1); se usan como conceptos de negocio, no como elección de tecnología. El proveedor, el almacenamiento de comprobantes y el mecanismo de tareas sin duplicados quedan para ADR-022, ADR-023 y ADR-024 en `/speckit-plan`.
- **Resuelto en `/speckit-plan` (2026-10-24):** ADR-031 y la enmienda 1.3.0 de la constitución (aprobados), TOTP obligatorio para el administrador y `SuscripcionesApi.exigirOperacion` en los casos de uso de 002 y M01. Puntos originales:
  - el administrador de la plataforma no pertenece a ninguna barbería; su acceso debe hacerse compatible con el principio III de la constitución (tenant tomado del token), con revisión de la constitución antes de implementar;
  - evaluar el segundo factor para la cuenta del administrador;
  - integrar las restricciones de FR-006 en las operaciones existentes de 002 (reserva, catálogo, bloqueos, usuarios).
- Inconsistencia detectada fuera de esta carpeta, **corregida en `/speckit-plan`**: `docs/05-gestion/06-mvp-y-evolucion.md` decía que el adaptador de `PaymentGateway` "ya existe (ADR-022)".
- Estado: **planificada** (ADR-022, ADR-023, ADR-024 y ADR-031 Aceptados; constitución 1.3.0). Lista para `/speckit-tasks`.
