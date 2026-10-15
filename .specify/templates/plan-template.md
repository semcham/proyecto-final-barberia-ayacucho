# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from `.specify/memory/constitution.md` (v1.0.0). Mark each ✅ / ❌ (justify ❌ in
Complexity Tracking and record an ADR):

- [ ] **I. Six modules**: work fits in M01–M06 (no new module); cross-module calls only via
  public `index` and the allowed-dependency matrix; side effects via M06 events
- [ ] **II. Four layers / Clean Architecture**: presentation, application, domain,
  infrastructure per submodule; domain imports no framework/DB/Redis/provider SDK
- [ ] **III. Tenant isolation**: `tenant_id` from the signed token only (never from client
  input); RLS on every business table; repositories filter by tenant; cache keys/events include
  tenant
- [ ] **IV. No duplicate appointments**: PostgreSQL exclusion constraint + transaction;
  conflict mapped to "horario no disponible"
- [ ] **V. Payments**: subscriptions only; `PaymentGateway` port; no card data stored;
  signed + idempotent webhook; reconciliation
- [ ] **VI. AI**: `AIProvider` port; closed role-based tools calling use cases; no free SQL,
  no direct DB/repository access
- [ ] **VII. Notifications**: `NotificationChannel` port driven by events; WhatsApp consent
  recorded; async; failure never blocks the operation; email fallback
- [ ] **VIII. Redis**: cache only (TTL + invalidation); never source of truth; system works
  if Redis is down
- [ ] **IX. Web only**: responsive web UI over REST/HTTPS; no native mobile app
- [ ] **X. Mandatory tests**: tests planned for every story, including tenant-isolation
  (PR09), booking concurrency (PR16) and architecture (PR14) where touched
- [ ] **XI. ADR**: any architectural change recorded in
  `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`
- [ ] **XII. Code location**: all application code under `tecnologia/plataforma-barberias/`

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# Project default (constitution XII): all code under tecnologia/plataforma-barberias/
tecnologia/plataforma-barberias/
├── backend/
│   ├── src/
│   │   ├── host/                     # composition root, tenant + auth middleware
│   │   ├── modules/
│   │   │   ├── acceso-barberias/     # M01 (identidad, barberias)
│   │   │   ├── catalogo-citas/       # M02 (catalogo, citas)
│   │   │   ├── suscripciones-pagos/  # M03 (suscripciones, pagos)
│   │   │   ├── asistente-reportes/   # M04 (asistente, reportes)
│   │   │   └── notificaciones/       # M05
│   │   │   # each submodule: presentation/ application/ domain/ infrastructure/
│   │   └── shared/                   # M06
│   └── tests/
└── frontend/                         # responsive web app (no native mobile)

# [REMOVE IF UNUSED] Option 1: Single project
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
