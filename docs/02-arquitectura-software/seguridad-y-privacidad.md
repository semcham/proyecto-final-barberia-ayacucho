# Seguridad y privacidad

Decisión base: [ADR-010](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-010-autenticación-autorización-y-aislamiento-de-datos). Drivers: DA01 y DA11. Escenarios EQ-07 a EQ-13, EQ-18 y EQ-19.

## 1. Principios

1. **Defensa en profundidad:** ningún control es la única barrera (el aislamiento usa token + contexto + repositorios + RLS + pruebas).
2. **Mínimo privilegio:** cada rol y cada rol de base de datos recibe solo lo necesario.
3. **Confianza cero en el cliente:** la interfaz no decide permisos; el backend valida siempre.
4. **Privacidad por diseño:** datos mínimos, consentimiento y retención definida.

## 2. Matriz rol × operación (RBAC)

✓ permitido · ✓\* permitido solo sobre sus propios recursos · — denegado. PA = Administrador de la plataforma; PR = Propietario (administra todo en su barbería); BA = Barbero; CL = Cliente; AN = Anónimo.

| Operación                                                | AN  | CL              | BA            | PR                   | PA  |
| -------------------------------------------------------- | --- | --------------- | ------------- | -------------------- | --- |
| Registrar una barbería (alta con prueba gratuita)        | ✓   | ✓               | ✓             | ✓                    | ✓   |
| Activar / suspender / reactivar barbería                 | —   | —               | —             | —                    | ✓   |
| Configurar datos y horarios de la barbería               | —   | —               | —             | ✓                    | —   |
| Gestionar usuarios y roles de la barbería                | —   | —               | —             | ✓                    | —   |
| Gestionar servicios y barberos                           | —   | —               | —             | ✓                    | —   |
| Definir disponibilidad                                   | —   | —               | ✓\*           | ✓                    | —   |
| Ver catálogo público                                     | ✓   | ✓               | ✓             | ✓                    | —   |
| Consultar disponibilidad                                 | ✓   | ✓               | ✓             | ✓                    | —   |
| Reservar cita                                            | —   | ✓\*             | —             | ✓ (presencial)       | —   |
| Reprogramar / cancelar cita                              | —   | ✓\*             | —             | ✓                    | —   |
| Cambiar estado de cita (completada, no asistió)          | —   | —               | ✓\*           | ✓                    | —   |
| Ver agenda                                               | —   | ✓\* (historial) | ✓\*           | ✓ (toda la barbería) | —   |
| Ver estado de suscripción y pagar                        | —   | —               | —             | ✓                    | —   |
| Gestionar planes y estados de suscripción                | —   | —               | —             | —                    | ✓   |
| Ver reportes de la barbería                              | —   | —               | ✓\* (resumen) | ✓                    | —   |
| Indicadores agregados de la plataforma y auditoría       | —   | —               | —             | —                    | ✓   |
| Asistente de IA (consultas de catálogo y disponibilidad) | —   | ✓               | —             | ✓                    | —   |
| Asistente de IA (consultas administrativas)              | —   | —               | —             | ✓                    | —   |
| Solicitar acceso, rectificación o eliminación de datos   | —   | ✓\*             | —             | ✓\*                  | —   |

La matriz se convierte en una **prueba parametrizada** (PR08): cada celda es un caso. La matriz detallada de la funcionalidad 001 está en `specs/001-registro-acceso-barberia/contracts/rbac.md`.

## 3. Amenazas, controles y verificación

| Amenaza                                                 | Control                                                                                                                                                                                                         | Verificación              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Acceso a datos de otra barbería                         | `tenant_id` del token, contexto, filtro en repositorios, **RLS**, claves de caché con tenant                                                                                                                    | EQ-09 / PR09              |
| Suplantación (token falso o vencido)                    | Firma, vencimiento corto, rotación de claves                                                                                                                                                                    | EQ-07 / PR07              |
| Fuerza bruta de contraseñas                             | Limitación de intentos, hash lento con sal                                                                                                                                                                      | EQ-12 / PR12              |
| Escalada de privilegios                                 | RBAC en la capa de aplicación; rol no modificable por el cliente                                                                                                                                                | EQ-08 / PR08              |
| Inyección SQL / XSS                                     | Consultas parametrizadas, validación y codificación de salida                                                                                                                                                   | EQ-10 / PR10              |
| Webhook falso o repetido                                | Verificación de firma/autenticidad, idempotencia por identificador de evento, límite de tasa                                                                                                                    | EQ-17 / PR17              |
| Fuga de secretos                                        | Variables de entorno/gestor; escaneo del repositorio; sin secretos en logs ni prompts                                                                                                                           | EQ-11 / PR11              |
| Prompt injection / exceso de agencia de la IA           | Herramientas cerradas por rol, sin SQL libre, intención estructurada, confirmación para acciones sensibles                                                                                                      | EQ-19 / PR19              |
| Fuga de datos personales a la IA                        | Enviar solo datos mínimos del tenant autenticado; sin datos de pago; revisión de lo enviado                                                                                                                     | EQ-19 / PR19              |
| Enlace del recordatorio reenviado, robado o reutilizado | Enlace firmado de un solo uso (`jti` registrado), vence al iniciar la cita, alcance a una cita y un tenant, acción limitada (confirmar, reprogramar o cancelar), sin datos personales en la URL, límite de tasa | EQ-08, EQ-09 / PR28       |
| Datos de tarjeta expuestos                              | No se reciben ni almacenan; se usa el flujo alojado por el proveedor                                                                                                                                            | Revisión de diseño (RC12) |
| Denegación de servicio / abuso                          | Rate limiting, tiempos límite, balanceo                                                                                                                                                                         | EQ-12 / PR12              |
| Manipulación de acciones sensibles sin rastro           | Auditoría inmutable para el rol de aplicación                                                                                                                                                                   | EQ-13 / PR13              |
| Pérdida de datos                                        | Respaldos cifrados y probados                                                                                                                                                                                   | EQ-22 / PR22              |
| CSRF/CORS abusivo                                       | Lista de orígenes, `SameSite` si hay cookies, tokens en cabecera                                                                                                                                                | Revisión y prueba de CORS |

## 4. Autenticación y sesiones

- Contraseñas con algoritmo de hash lento y sal: Argon2id en la funcionalidad 001 (ver [tecnologías](tecnologias.md)).
- Token de acceso de vida corta (15 min) y token de refresco rotativo; cierre de sesión revoca el refresco. Si llega un token de refresco ya rotado, se trata como robo: la sesión se revoca y se audita `SESION_REUTILIZADA` (efecto secundario posible: R18 en la [matriz de riesgos](../05-gestion/05-riesgos.md)).
- El token contiene `sub`, `role` y `tenant_id`; no contiene datos personales innecesarios.
- Mensajes de error genéricos en el inicio de sesión.

### 4.1 Qué guarda el navegador

| Dato | Dónde | Características | Decisión |
| --- | --- | --- | --- |
| Token de acceso | Memoria de la página (nunca en `localStorage`, `sessionStorage` ni cookies) | Se pierde al recargar; se recupera con la renovación | ADR-010 |
| Token de renovación `rt` | Cookie | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth`, 7 días, rotativa; JavaScript no puede leerla | ADR-010 |
| Indicador `hay_sesion=1` | Cookie | No secreta ni da acceso; `SameSite=Strict`, `Secure` con HTTPS, 7 días; solo evita llamar a `/auth/refresh` sin sesión | ADR-017 |
| Preferencia de tema (`tema`) | `localStorage` | Solo `claro` u `oscuro`; sin datos personales; si no se puede guardar, se usa el tema del sistema | ADR-016 |

Las cookies `rt` y `hay_sesion` son técnicas (necesarias para mantener la sesión) y deben figurar en la política de privacidad y de cookies.

## 5. Privacidad y protección de datos personales (Ley N.° 29733)

> Verificar el texto vigente de la Ley N.° 29733 y del D. S. N.° 016-2024-JUS en _El Peruano_ antes de citarlos. Esto no es asesoría legal definitiva.

| Principio / obligación                                     | Medida de diseño                                                                                                                                                                                              | Estado      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Consentimiento previo, informado, expreso e inequívoco     | Registro `consent_record` (fecha, versión del texto) antes de crear el perfil (RF05)                                                                                                                          | Planificado |
| Finalidad y proporcionalidad                               | Solo nombre, correo, número de WhatsApp (opcional) y datos de la cita                                                                                                                                         | Planificado |
| Consentimiento para mensajes por WhatsApp                  | Casilla expresa y separada; se registra en `consent_record` antes de enviar; el cliente puede cambiar de canal o retirarlo (RF33)                                                                             | Planificado |
| Contenido de los mensajes                                  | Solo barbería, servicio, fecha y hora; sin datos sensibles ni enlaces de autenticación                                                                                                                        | Planificado |
| Derechos de acceso, rectificación, cancelación y oposición | Flujo `data_request` con seguimiento (RF32)                                                                                                                                                                   | Planificado |
| Seguridad del tratamiento                                  | Cifrado en tránsito, hash de contraseñas, RLS, auditoría                                                                                                                                                      | Planificado |
| Respaldos                                                  | Diarios (propuesta); la normativa menciona al menos semanales según fuente secundaria                                                                                                                         | Planificado |
| Trazabilidad de accesos                                    | Auditoría de acciones sensibles                                                                                                                                                                               | Planificado |
| Incidentes graves                                          | Procedimiento de notificación a la ANPD en 48 h (según fuente secundaria; verificar)                                                                                                                          | Por validar |
| Inscripción de bancos de datos (RNPDP)                     | Evaluar antes de operar                                                                                                                                                                                       | Por validar |
| Roles responsable / encargado                              | Barbería = responsable de los datos de sus clientes; plataforma = encargada. Para los datos de las barberías como clientes de la plataforma, la plataforma es responsable. **Por validar con asesoría legal** | Por validar |
| Oficial de Datos Personales                                | Evaluar si corresponde según tamaño de empresa; **no se afirma**                                                                                                                                              | Por validar |

### Privacidad en el asistente de IA

- Solo recibe datos del tenant y rol autenticados, el mínimo necesario.
- No recibe secretos, contraseñas ni datos de pago.
- Cada consulta queda registrada (intención, herramientas usadas, tenant, usuario), sin guardar más datos personales de los necesarios.
- Se informa al usuario que usa un asistente automatizado.
- Se revisan los términos del proveedor de IA sobre retención y uso de datos antes de contratarlo.

## 6. Auditoría

Se registran: alta, suspensión y reactivación de barberías; cambios de rol; cambios de plan; inicios de sesión fallidos repetidos; acciones de IA con herramientas sensibles; solicitudes de datos personales; confirmaciones de pago. Cada registro tiene actor, acción, recurso, tenant, fecha y origen. Sin datos sensibles innecesarios.
