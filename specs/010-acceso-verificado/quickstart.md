# Quickstart: validar el acceso verificado (010)

Guía para comprobar que la funcionalidad funciona de extremo a extremo. No contiene código: los detalles están en
[data-model.md](data-model.md) y en [contracts/](contracts/).

## Requisitos

- Docker y el Compose del proyecto (`tecnologia/plataforma-barberias/`), con el proveedor de IA **falso** y Mailpit.
- **Los recorridos manuales se hacen en una copia aparte** (`barberias-verificacion`, subred `172.29.0.0/24`, como T025 de
  009), nunca contra el volumen ni la demo del responsable. El guardián de `scripts/lib/proyecto` debe aceptar ese nombre
  de proyecto.
- **Paso del responsable** (research R10): en su `.env` local, `TERMS_VERSION` y `PRIVACY_POLICY_VERSION` pasan a la
  versión nueva de los textos (provisionalmente `2026-12`). El agente no lee ni cambia ese archivo.
- La migración `0036_acceso_verificado` aplicada (las réplicas la aplican al arrancar).
- `CUENTA_RESPUESTA_MINIMA_MS` con su valor por defecto (400) salvo que se indique otro; está en `.env.example`.

## 1. Pruebas automáticas

| Suite | Comando (en `backend/` o `frontend/`) | Qué demuestra |
| --- | --- | --- |
| Unitarias | `npm test` | Reglas del enlace (un solo uso, vencimiento, anulación), límites, plantillas de los avisos nuevos |
| Integración | `npm run test:int` | Registro → correo en el buzón de pruebas → verificar → reservar; recuperación con cierre de sesiones en dos barberías; respuestas neutras; guard en las tres rutas; permisos exactos de las funciones de sistema; aislamiento PR09; ningún token en eventos, avisos ni registros |
| Arquitectura | `npm run test:arch` | La matriz de dependencias se mantiene (el guard en el host; M03 y M04 sin llamar a M01) |
| Frontend | `npm test` | Pantallas nuevas, aviso de verificación, "¿Olvidaste tu contraseña?", pantallas del cliente sin sesión |
| Semilla | `node --test "semilla/test/*.test.mjs"` | La semilla verifica a sus clientes antes de reservar |

Todas con `IA_PROVEEDOR=falso`. Las que usan correo lo leen de Mailpit (Testcontainers o el servicio de Compose).

### 1.1 Medición de las respuestas neutras (SC-005, local y estricta)

- `npm run test:medicion` en `backend/`, en la máquina del responsable o del agente, sin otras cargas pesadas.
- **Criterio** (bloqueante aquí):
  - 100 solicitudes por serie (con cuenta y sin cuenta) en recuperación, reenvío y verificación;
  - diferencia de medianas menor de 30 ms;
  - percentil 90 de ambas series dentro de `CUENTA_RESPUESTA_MINIMA_MS` (400 por defecto) más 50 ms.
- Anotar aquí las medianas y los percentiles 90 medidos, con la fecha y el commit.
- En la CI esta misma medición corre en un paso **no bloqueante** (research R07). Su resultado se lee en el registro de la
  corrida.

## 2. Recorridos manuales (en la copia `barberias-verificacion`)

### 2.1 Verificación del correo (US1)

1. Abrir `/b/barberia-demo-centro`, elegir una hora y "Crear cuenta y reservar" con un correo nuevo.
2. **Esperado**: la cuenta se crea y la sesión queda abierta; al confirmar la reserva aparece "Verifica tu correo para
   reservar", con el correo parcialmente oculto y "Reenviar correo de verificación". La hora elegida no se pierde.
3. Abrir Mailpit (`http://localhost:8025`): hay un correo con el enlace `…/verificar#…`.
4. Abrir el enlace en **otro** navegador sin sesión y pulsar "Verificar mi correo". **Esperado**: mensaje de éxito y paso a
   `/b/barberia-demo-centro`.
5. Volver al primer navegador y reservar. **Esperado**: la reserva se confirma.
6. Abrir otra vez el mismo enlace. **Esperado**: "Este enlace ya no es válido", sin más detalles.
7. Pulsar "Reenviar" cuatro veces en una hora con otra cuenta nueva. **Esperado**: los tres primeros envían un correo; el
   cuarto pide esperar.
8. Ingresar con una cuenta de la semilla (anterior a 010). **Esperado**: reserva sin pasos nuevos.

### 2.2 Recuperación de contraseña (US2)

1. En `/ingresar`, "¿Olvidaste tu contraseña?", con el correo del propietario de ejemplo y, después, con un correo
   inventado. **Esperado**: el mismo mensaje las dos veces; solo el primero recibe un correo.
2. Con un cliente de ejemplo de Centro, unirse antes a Huamanga (ingreso desde su enlace, con el consentimiento), e
   ingresar en ambas en dos navegadores; pedir la recuperación
   desde `/b/barberia-demo-huamanga/ingresar`, abrir el enlace y elegir una contraseña nueva.
3. **Esperado**: mensaje "Tu contraseña cambió"; en los dos navegadores la sesión se cierra en la siguiente acción; llega
   el aviso "Tu contraseña cambió"; la contraseña anterior ya no sirve y la nueva sí.
4. Abrir el enlace otra vez o esperar más de una hora con otro enlace. **Esperado**: "Este enlace ya no es válido" y el
   camino para pedir otro.

### 2.3 Textos legales (US3)

1. Abrir "Términos y condiciones" y "Política de privacidad" desde la portada, el pie, `/registro`,
   `/b/<slug>/registro`, el formulario de unión y las pantallas de ingreso. **Esperado**: las dos páginas se abren, con su
   versión, su fecha y la marca de borrador; desde un formulario se abren en otra pestaña y lo escrito se conserva.
2. Registrar un cliente y comprobar que su consentimiento guarda la versión publicada (consulta de prueba en la copia).

### 2.4 Cliente sin sesión (US4)

1. Sin sesión, abrir `/asistente`, `/mis-avisos`, `/mis-datos` y `/mis-citas/<id>/adelanto`. **Esperado**: nunca el ingreso
   del personal; "Ingresar" en la última barbería visitada o la explicación; tras ingresar, la pantalla pedida.
2. Activar el adelanto en una barbería de ejemplo, reservar con un cliente verificado y abrir el enlace del correo
   "Paga el adelanto de tu cita" en un navegador sin sesión. **Esperado**: "Ingresar" y luego la pantalla de pago de esa
   cita.
3. Abrir un enlace de recordatorio ya usado (`/e#…`) y pulsar "Iniciar sesión". **Esperado**: la pantalla "Ingresar" del
   cliente, no el ingreso del personal.

### 2.5 Tiempo de llegada del correo (SC-004)

1. En la copia aparte, pedir 20 correos (10 de verificación con cuentas nuevas y 10 de recuperación, respetando los
   límites: varias cuentas y, si hace falta, esperar entre series).
2. Para cada uno, anotar el momento de la solicitud y el de llegada al buzón (la API de Mailpit da la fecha de
   recepción).
3. **Esperado**: al menos 19 de 20 (95 %) llegan en menos de 1 minuto. Anotar la latencia mediana y la máxima.

## 3. Accesibilidad y diseño

- Capturas en claro y oscuro, a 1440 y 360 px, de `/verificar`, `/recuperar`, `/restablecer`, `/terminos`, `/privacidad`
  y del aviso de verificación, con el build de producción. axe (WCAG 2.2 A y AA) sin incumplimientos; sin desbordes
  horizontales.

## 4. Al terminar

- Bajar la copia con `docker compose -p barberias-verificacion down -v`, solo después de que el guardián confirme el
  nombre del proyecto.
