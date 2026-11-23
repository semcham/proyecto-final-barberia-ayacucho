# Contrato: pantallas y rutas de la interfaz (010)

Todas con los tokens y componentes del sistema de diseño (`frontend/src/styles/tokens.css`), WCAG 2.2 AA y sin desbordes a
360 px (FR-032). Las rutas existentes no cambian; se agregan cinco.

## Rutas nuevas (públicas)

| Ruta | Pantalla | Comportamiento |
| --- | --- | --- |
| `/verificar#<token>` | Verificar el correo | Lee el token del fragmento y lo borra de la barra. Muestra "Verificar mi correo" (botón): abrir no gasta el enlace (FR-004). Éxito → mensaje y paso a `/b/<slug>` de la barbería de origen. 410 → mensaje neutro y cómo pedir otro (desde la barbería, con sesión) |
| `/recuperar` | Pedir la recuperación | Campo de correo (con icono, ejemplo y etiqueta). Recibe `state.barberia` si viene de `/b/<slug>/ingresar` y lo envía. Siempre el mismo mensaje tras enviar. 429 → tiempo de espera |
| `/restablecer#<token>` | Elegir la contraseña nueva | Contraseña nueva con el indicador de fortaleza existente y "Mostrar contraseña". Éxito → `/ingresar` (o `/b/<slug>/ingresar` si se conoce la última barbería) con el aviso "Tu contraseña cambió; ingresa con la nueva". 410 → mensaje neutro y enlace a `/recuperar` |
| `/terminos` | Términos y condiciones | Texto con versión, fecha de vigencia y la marca "Borrador pendiente de revisión" mientras lo sea; índice de secciones; legible a 360 px |
| `/privacidad` | Política de privacidad y datos personales | Igual que `/terminos`; incluye cómo ejercer los derechos (enlace a "Mis datos" para clientes) |

## Cambios en pantallas existentes

- **Enlace "¿Olvidaste tu contraseña?"** bajo el campo de contraseña en `/ingresar` y en `/b/<slug>/ingresar`
  (este último pasa `state.barberia`). No se agrega en `/plataforma/ingresar` (el administrador está fuera de alcance).
- **Casillas de aceptación** en `/registro`, `/b/<slug>/registro` y el formulario de unión (`Union.tsx`): el nombre del
  documento es un enlace que abre `/terminos` o `/privacidad` **en una pestaña nueva** (`target="_blank"` con
  `rel="noopener"` y el aviso "(se abre en otra pestaña)" para lectores de pantalla), así no se pierde lo escrito (FR-025).
- **Portada y pie**: "Términos de uso (en preparación)" y "Política de privacidad (en preparación)" pasan a ser enlaces a
  las nuevas páginas. El pie del marco de acceso (`MarcoAcceso`) agrega los mismos dos enlaces.
- **Aviso de verificación pendiente** (`AvisoVerificacion`, componente nuevo): se muestra en `/b/<slug>/reservar`, en
  `/asistente` y en `/mis-citas/:id/adelanto` cuando `usuario.correoVerificado` es false o llega un 403
  `CORREO_NO_VERIFICADO`. Texto: "Verifica tu correo para reservar", el correo con parte oculta (`l***@correo.com`), el
  botón "Reenviar correo de verificación" y, tras pulsarlo, "Te enviamos un correo nuevo" o el tiempo de espera. En la
  reserva no se pierde la hora elegida.
- **Pantallas del cliente sin sesión** (`RutaProtegida` con `sinSesion` y `ClienteSinSesion`): `/asistente`
  ("Asistente"), `/mis-avisos` ("Mis avisos"), `/mis-datos` ("Mis datos") y `/mis-citas/:citaId/adelanto` ("Pagar
  adelanto"), además de `/mis-citas`. Tras ingresar, vuelven a la dirección pedida (FR-029).
- **Recordatorio con enlace no válido** (`/e`, `pages/publico/Enlace.tsx:118`): hoy el botón "Iniciar sesión" lleva a
  `/ingresar`, el ingreso del personal. Pasa a llevar a `/mis-citas`, que sin sesión muestra la pantalla "Ingresar" de la
  última barbería (FR-030).

## Errores nuevos que la interfaz traduce

| Código | Mensaje |
| --- | --- |
| `CORREO_NO_VERIFICADO` | Aviso de verificación pendiente (arriba) |
| `ENLACE_NO_VALIDO` (en `/verificar` y `/restablecer`) | "Este enlace ya no es válido." más el camino para pedir otro |
| `DEMASIADOS_INTENTOS` | "Demasiados intentos. Vuelve a intentar en N minutos." |
