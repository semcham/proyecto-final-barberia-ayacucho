# ADR-026 Correo y WhatsApp detrás de `NotificationChannel`

- **Estado:** **Aceptado** (decisión del responsable, 2026-11-04), con la librería (g) `nodemailer`. Registrado en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` el mismo día. Este archivo conserva el detalle completo.
- **Contexto:**
  - ADR-013 decide un puerto `NotificationChannel` con correo y WhatsApp.
  - El backlog (§3.1) acordó que el correo es el canal real, con un buzón de pruebas en desarrollo, y que WhatsApp existe como canal simulado hasta que se contrate un proveedor.
  - Las condiciones de la WhatsApp Business Platform (consentimiento, plantillas aprobadas, costos) están **por verificar** (R17, RC16).
  - No hay proveedor de correo de producción elegido.
  - El simulador de pagos de 003 (ADR-022) permitió medir PR06 y PR20 sin proveedor real.
- **Problema:** ¿cómo enviar correo y WhatsApp de forma verificable en desarrollo y en las pruebas, sin depender de proveedores no contratados y sin cambiar las reglas de los avisos el día que se contraten?
- **Alternativas:**
  - **Correo:**
    - (a) API HTTP de un proveedor concreto: ata el adaptador a una elección que no está hecha.
    - (b) Volcar los correos a un archivo o a la consola: no prueba el protocolo ni los errores de red.
    - (c) **SMTP contra Mailpit en desarrollo y pruebas**, y contra cualquier SMTP con TLS en producción.
  - **WhatsApp:**
    - (d) Contratar ya un proveedor: fuera del alcance (R17) y con costo.
    - (e) Doble en memoria dentro del monolito: no prueba el tiempo límite, el circuito ni la red, y mezcla código de prueba con el de producción.
    - (f) **Simulador en proceso aparte**, como el de pagos, con modos de falla.
  - **Librería SMTP:**
    - (g) **`nodemailer`** (elegida por el responsable el 2026-11-04);
    - (h) cliente SMTP mínimo propio sobre `node:net` y `node:tls`.
- **Decisión:** (c), (f) y (g). `nodemailer` va con **versión exacta fija** en `package.json`, como el resto del proyecto. Su licencia y la versión se verifican al instalarla, en la fase 1.
  1. **Puerto** `NotificationChannel.enviar(mensaje)` con dos errores: `CanalNoDisponible` (temporal) y `DestinatarioInvalido` (permanente). Contrato en `specs/004-notificaciones-reprogramacion/contracts/notification-channel.md`.
  2. **Correo:**
     - adaptador SMTP con texto simple, `Message-ID` estable por aviso y tiempo límite de 5 s;
     - **Mailpit** como servicio de Compose (`mailpit`, imagen pequeña, SMTP 1025 y web 8025), sin entregar a internet;
     - en las pruebas, Mailpit en Testcontainers, cuya API HTTP permite verificar cada mensaje;
     - el proveedor de producción queda **por verificar**: cualquiera con SMTP y TLS sirve cambiando solo `SMTP_*`.
  3. **WhatsApp:**
     - adaptador HTTP contra `backend/simulador-whatsapp/`, un proceso aparte con `node:http`, servicio de Compose de 64 MB e IP fija;
     - deduplica por `Idempotency-Key`;
     - modos: `normal`, `lento`, `caido`, `colgado`, `rechazar`, `limite` y `fallar_n`;
     - **nunca se despliega en producción**, y PR14 impide que `src/` lo importe;
     - el proveedor real será un adaptador nuevo, elegido por `WHATSAPP_PROVEEDOR`, sin cambiar M05.
  4. **Suite de contrato** `notification-channel.contract.ts`, la misma batería para cada adaptador (envío, tiempo límite, caída, circuito, destinatario inválido, 429, idempotencia y nada sensible en los registros). Corre contra Mailpit y el simulador en CI; la variante de un proveedor real se omite sin credenciales. Todo adaptador futuro debe pasarla.
- **Justificación:**
  - reproduce lo que funcionó en 003;
  - permite medir PR06 y PR27 en local;
  - cambiar de proveedor es configuración más un adaptador que pasa la suite (EQ-14).
- **Ventajas:** sin costos ni cuentas; pruebas deterministas; las fallas se provocan a voluntad.
- **Desventajas:**
  - nada de esto demuestra la entrega real (entregabilidad, spam, plantillas de WhatsApp);
  - suma dos servicios a Compose (menos de 100 MB);
  - (g) es una dependencia nueva.
- **Riesgos:**
  - R17: las reglas de WhatsApp pueden exigir plantillas aprobadas y una ventana de 24 h, que el simulador no impone. **Mitigación:** quedan "por verificar" y se documentan como diferencia conocida del simulador.
  - Entregabilidad del correo en producción (SPF, DKIM): por verificar al elegir el proveedor.
  - **Dependencia nueva sin escaneo:** la CI actual (`.github/workflows/plataforma-barberias.yml`) no tiene escaneo de dependencias: no hay `npm audit`, Dependabot ni CodeQL. Que `nodemailer` "se revise con el escaneo de dependencias de CI" exige agregar ese paso: queda como tarea de la fase 1 de 004. Hasta entonces no se afirma que esté escaneada.
- **Lo que no se afirma:** que exista un proveedor real de WhatsApp o de correo, ni que los mensajes lleguen a buzones reales.
- **Drivers:** DA05, DA09, DA11.
- **Consecuencias:**
  - `docker-compose.yml` suma `mailpit` en la fase 1 y `whatsapp-simulado` en la fase 5, junto con el simulador y su adaptador (la imagen de Mailpit la descarga el responsable, después de verificar que Docker guarda las imágenes en D:);
  - `backend/package.json` suma `nodemailer` y `@types/nodemailer` (devDependency), los dos con versión exacta fija;
  - la suite de contrato está escrita para cualquier canal: corre con Mailpit desde la fase 1, y en la fase 5 se le agrega el simulador de WhatsApp;
  - `.env.example` suma `SMTP_*`, `CORREO_REMITENTE`, `WHATSAPP_*` y `URL_PUBLICA`;
  - PR14 suma reglas: simulador fuera del monolito y adaptadores solo por el puerto;
  - `tecnologias.md` lista Mailpit y `nodemailer` (con su versión exacta) al implementar.
