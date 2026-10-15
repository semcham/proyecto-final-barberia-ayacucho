# Scrum adaptado al contexto universitario

**Scrum** es el **marco de trabajo** del equipo (cómo se organiza), no un estilo arquitectónico. El estilo es monolito modular y el enfoque es Clean Architecture ([enfoque](../02-arquitectura-software/enfoque-arquitectonico.md#1-no-confundir-los-conceptos)).

## 1. Roles

| Rol Scrum | Responsabilidad | Asignación |
|---|---|---|
| Product Owner | Prioriza el backlog y define el valor; representa al negocio y valida con los interesados | *Por asignar (integrante del equipo)* |
| Scrum Master | Facilita el proceso, quita impedimentos, cuida el Definition of Done | *Por asignar* |
| Developers | Analizan, diseñan, documentan, implementan y prueban | *Resto del equipo; nombres por completar* |
| Interesado principal | Evaluadores del curso; propietarios de barberías entrevistados | — |

No se inventan integrantes: la tabla se completa cuando el equipo esté definido (ver preguntas pendientes en el README).

## 2. Artefactos

| Artefacto | Contenido | Dónde vive |
|---|---|---|
| Product Backlog | HU ordenadas por prioridad MoSCoW | [02-backlog-y-sprints.md](02-backlog-y-sprints.md) y tablero de GitHub Projects |
| Sprint Backlog | HU y tareas comprometidas por sprint | Tablero y [02-backlog-y-sprints.md](02-backlog-y-sprints.md) |
| Incremento | Documentación o software verificable al cierre del sprint | Repositorio, rama principal etiquetada por sprint |

## 3. Eventos

| Evento | Duración propuesta | Adaptación universitaria |
|---|---|---|
| Sprint (2 semanas) | 2 semanas | Ajustable al calendario real del curso |
| Planning | 1 h | Se elige la meta y las HU del sprint |
| Daily | 10–15 min o asincrónico | Puede ser por mensajería si no coinciden horarios |
| Review | 30 min | Presentar el incremento a los interesados |
| Retrospective | 30 min | Mejoras de proceso y equipo |
| Refinamiento | 30 min semanales | Detallar HU y criterios |

## 4. Definition of Done (DoD)

Un elemento está **terminado** cuando:

1. Cumple los criterios de aceptación de su HU.
2. Las pruebas planificadas para él se ejecutaron y pasan (o, para documentación, se revisó la consistencia y los enlaces).
3. Fue revisado por al menos otro integrante (pull request aprobado).
4. Los controles de seguridad aplicables se verificaron (autorización, aislamiento, validación).
5. La documentación se actualizó (HU, RF, ADR, diagramas, trazabilidad).
6. No quedan defectos críticos abiertos.
7. Hay evidencia guardada (resultados de pruebas, capturas, enlaces).
8. Los commits siguen la convención (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`).

## 5. Flujo de ramas y revisión

- Rama principal protegida; trabajo en ramas `feat/...`, `docs/...`, `fix/...`.
- Pull request con plantilla: requisito relacionado, ADR afectado, lista de verificación de dependencias y de seguridad.
- La integración continua ejecuta pruebas y la verificación de dependencias entre módulos (PR14).
