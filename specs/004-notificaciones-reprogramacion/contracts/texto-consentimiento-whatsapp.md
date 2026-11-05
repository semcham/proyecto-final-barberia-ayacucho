# Texto del consentimiento para recibir avisos por WhatsApp

> **Texto base, por validar con asesoría legal.** Está redactado en español simple con el mismo criterio que la política de tratamiento de datos de 002. **No se afirma que cumpla la Ley N.° 29733 ni su reglamento**: eso lo debe confirmar una revisión legal antes de usarlo con clientes reales.

- **Documento:** `WHATSAPP`
- **Versión:** `2026-11`
- **Se guarda con cada aceptación:** cliente, barbería, número, versión del texto, fecha y hora (`whatsapp_consent`, [data-model](../data-model.md) §2.2).
- **Dónde se muestra:** en la pantalla del canal de aviso del cliente, junto a la casilla que debe marcar para elegir WhatsApp (FR-017). La API lo entrega en `GET /clientes/yo/aviso` (`textoConsentimiento`) para que la interfaz muestre siempre la versión vigente.
- **Cambio de versión:** un texto nuevo lleva una versión nueva. Los consentimientos anteriores se conservan con su versión, y quien aceptó una versión antigua sigue con ella hasta que vuelva a elegir su canal.

## Texto (versión 2026-11)

> **Avisos por WhatsApp**
>
> Acepto que **{nombre de la barbería}** me envíe por WhatsApp, al número **{número}**, los avisos de mis citas:
>
> - la confirmación cuando reservo;
> - el aviso si mi cita cambia de hora o se cancela;
> - el recordatorio el día de la cita, con enlaces para confirmar, reprogramar o cancelar.
>
> Los mensajes solo dirán el nombre de la barbería, el servicio, el barbero, la fecha y la hora. No recibiré publicidad por este medio.
>
> Puedo retirar este permiso cuando quiera desde mi cuenta. Desde ese momento, los avisos me llegarán por correo.
>
> Si un mensaje por WhatsApp no se puede enviar, el mismo aviso me llegará por correo.

## Notas para la revisión legal

- El texto no menciona al proveedor de WhatsApp porque todavía no está contratado (R17). Al contratarlo, la revisión debe decidir si hay que nombrarlo y si sus condiciones (plantillas, transferencia de datos al extranjero) exigen cambiar el texto y su versión.
- El consentimiento es por barbería, como el de la política de datos: cada barbería es responsable de sus avisos.
- El plazo y la forma de atender una solicitud de retiro por otra vía (por ejemplo, pedido a la barbería) quedan para la funcionalidad 007 (RF32).
