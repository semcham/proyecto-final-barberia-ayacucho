# Contrato: evidencia guardada y criterios de evaluación

## 1. Reglas (FR-004)

- Cada cifra citada en `docs/` o en el README enlaza su carpeta en `tecnologia/plataforma-barberias/evidencia/`
  (SC-002).
- `resumen.md` se genera a partir de `crudo.*`. Una cifra que no esté en `crudo.*` no puede aparecer.
- "No cumple" se guarda y se cita tal cual. Si una medición se repite, se citan todas las corridas.
- Nunca se guardan secretos, cookies, tokens, el contenido del `.env`, las contraseñas de la demo publicada, ni
  identificadores de cuenta, de zona o del túnel.
- **De Playwright solo se versiona el informe JSON filtrado** (título, archivo, estado, duración y error con tokens y
  correos enmascarados). Las trazas, las capturas, los videos y el informe HTML van a `evidencia/**/no-versionado/`,
  que ignora el `.gitignore`.
- **Planes sin parámetros:** `auto_explain` corre con `log_parameter_max_length=0`, y `extraer-planes` guarda solo el
  texto de la consulta con `$1`, `$2`…
- **Antes de cada commit** se ejecuta `node evidencia/scripts/revisar-secretos.mjs` (JWT, `otpauth://`, `Bearer`,
  `set-cookie`, `-----BEGIN`, tokens de GitHub, credenciales del túnel). También corre en el trabajo `herramientas` de
  la CI.
- `entorno.json` toma el SHA de `EVIDENCIA_GIT_SHA` en la copia de verificación, que no tiene `.git`.
- Los JSON de Lighthouse de más de 5 MB se guardan comprimidos con gzip (`.json.gz`).

## 2. Criterios de evaluación → evidencia en el repositorio

| Criterio | Evidencia que quedará | Historia |
| --- | --- | --- |
| **6. Pruebas End to End** | `e2e/recorridos/` (5 recorridos), `evidencia/e2e/` (5 corridas locales, 3 en el CI y `evaluacion.md`), el trabajo `e2e` del CI y el comando en el README | US2 |
| **8. Escalabilidad del frontend y backend** | `nginx/templates/web.conf.template` (caché inmutable y SPA), `evidencia/carga/*-escalado-pr03/` (throughput con 2 y 3 instancias y solicitudes perdidas), `evidencia/carga/*-reserva/` (PR02, la misma medición de US1), `evidencia/rendimiento-web/` (Lighthouse con `vite preview` y contra el 8080) y `cf-cache-status` en `evidencia/despliegue/` | US4, US1, US2, US7 |
| **9. Escalabilidad de base de datos** | `evidencia/base-de-datos/` (planes con índices y sin parámetros, cálculo del pool con 2 y 3 instancias, volúmenes de 52 000, 130 000 y 260 000 citas con la extrapolación marcada como estimación, acta del simulacro PR22 con tiempos frente al RPO y al RTO) y el texto de lo no construido en despliegue §8 | US5 |
| **10. Dominio, subdominio, DNS y CDN** | `publicacion/cloudflared/config.yml`, `nginx/templates/publicacion.conf.template`, `evidencia/despliegue/` (DNS, certificado y cabeceras con `cf-cache-status`), ADR-035 y, con US8, los subdominios por barbería con la prueba de sesión cruzada | US7, US8 |
| **12. CI/CD** | El flujo de CI (cobertura, `herramientas` con pruebas, Prettier, ESLint, auditoría y revisión de secretos, `e2e` y `artefacto-frontend`), la insignia en el README, `publicacion/actualizador/` y `evidencia/despliegue/publicaciones.jsonl` (tiempo de la CI verde a la publicación) | US6, US7 |
| **13. Pruebas de carga con k6** | `carga/escenarios/` (3 escenarios con umbrales), `evidencia/carga/` (resultados medidos, "cumple" o "no cumple") y ADR-034 | US1 |
| **14. Código fuente y base de datos en GitHub** | Migraciones 0001–0035 (ya existen), `semilla/` (versionada e idempotente), `scripts/preparar-entorno.*` y el README probado en bash y PowerShell (SC-001) | US3 |

Si una historia se recorta, su fila dice "no construido" con el motivo, en esta tabla y en
`docs/trazabilidad.md`.
