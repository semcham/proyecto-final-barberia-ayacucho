import { type DocumentoLegal, lista, parrafo } from './documento';

// T011 de 010 · Política de privacidad y datos personales, según la Ley N.° 29733 y su reglamento: BORRADOR BASE para
// la revisión del responsable humano (FR-027). Solo describe lo que la plataforma hace hoy (funcionalidades 001 a
// 009). Lo que no se conoce (titular, RUC, domicilio, correo de contacto, banco de datos inscrito, plazos exactos de
// conservación, proveedores) queda como "[por completar: …]" a la vista, sin inventarlo. Una versión nueva se publica
// cambiando `version` aquí y en PRIVACY_POLICY_VERSION del backend.

export const PRIVACIDAD: DocumentoLegal = {
  titulo: 'Política de privacidad y datos personales',
  version: '2026-11',
  vigenteDesde: '2026-11-23',
  borrador: true,
  resumen:
    'Qué datos personales se tratan en Barberías Ayacucho, para qué, quién los ve, cuánto tiempo se guardan y cómo ejercer tus derechos según la Ley N.° 29733, Ley de Protección de Datos Personales, y su reglamento.',
  secciones: [
    {
      id: 'responsables',
      titulo: 'Quién trata tus datos',
      bloques: [
        parrafo(
          'Cada barbería es responsable de los datos de sus clientes y de su personal: decide para qué los usa dentro de la plataforma. La plataforma Barberías Ayacucho, operada por [por completar: razón social, RUC y domicilio], trata esos datos por encargo de cada barbería y es responsable de los datos de las cuentas y de las suscripciones.',
        ),
        parrafo(
          '[por completar: código de inscripción del banco de datos personales ante la Autoridad Nacional de Protección de Datos Personales, si corresponde].',
        ),
      ],
    },
    {
      id: 'datos-que-tratamos',
      titulo: 'Qué datos tratamos',
      bloques: [
        lista(
          'De tu cuenta: nombre, correo y un resumen cifrado de tu contraseña (nunca la contraseña en claro).',
          'Como cliente de una barbería: nombre, correo, teléfono, tus citas (servicio, barbero, fecha, hora y estado) y la versión de esta política que aceptaste, con la fecha.',
          'Como personal de una barbería: nombre, correo, rol y la agenda de las citas que atiendes.',
          'Si la barbería pide un adelanto: el número de operación que registras y, si la subes, la captura del pago. Se guardan de forma privada.',
          'Datos técnicos de seguridad: los intentos de ingreso fallidos se guardan con el origen solo como un resumen cifrado, nunca la dirección IP en claro.',
        ),
      ],
    },
    {
      id: 'finalidades',
      titulo: 'Para qué los usamos',
      bloques: [
        lista(
          'Gestionar tus reservas y la agenda de la barbería.',
          'Avisarte de tus citas: confirmación, recordatorio, reprogramación y cancelación. Por WhatsApp solo si lo aceptas expresamente; puedes retirar ese permiso cuando quieras desde "Cómo recibo mis avisos".',
          'Mantener tu cuenta segura y evitar abusos.',
          'Que el asistente automático responda tus consultas: solo usa los servicios, los barberos y los horarios libres de la barbería; no consulta tus datos de contacto.',
          'Cobrar la suscripción de las barberías. La plataforma no guarda datos de tarjetas.',
        ),
        parrafo('No usamos tus datos para publicidad ni los vendemos.'),
      ],
    },
    {
      id: 'quien-los-ve',
      titulo: 'Quién puede verlos',
      bloques: [
        lista(
          'La barbería donde reservas: su propietario y el barbero que te atiende. Otra barbería no ve tus datos aunque uses la misma cuenta allí.',
          'El administrador de la plataforma no ve citas, clientes ni usuarios de las barberías; solo ve números agregados de uso, sin datos de personas.',
          'Proveedores que prestan servicios a la plataforma (alojamiento, envío de correos y, si se contratan, mensajería y pagos): [por completar: nombre de cada proveedor y país donde trata los datos, para informar del flujo transfronterizo si lo hay].',
        ),
      ],
    },
    {
      id: 'conservacion',
      titulo: 'Cuánto tiempo los guardamos',
      bloques: [
        parrafo(
          'Tus datos se guardan mientras tengas una relación con la barbería o una cuenta activa, y después el tiempo que exijan las obligaciones legales. Los intentos de ingreso fallidos se borran a las 24 horas. [por completar: plazos concretos de conservación de citas, consentimientos, comprobantes y registros de auditoría].',
        ),
      ],
    },
    {
      id: 'tus-derechos',
      titulo: 'Tus derechos y cómo ejercerlos',
      bloques: [
        parrafo(
          'Tienes derecho a acceder a tus datos, a pedir que se rectifiquen y a pedir que se eliminen. Como cliente puedes registrar y seguir tus solicitudes en [Mis datos](/mis-datos); como barbero, en "Mis datos" de tu panel. La barbería responde en un plazo de 10 días hábiles.',
        ),
        parrafo(
          'Para oponerte a un tratamiento o para cualquier otra consulta sobre tus datos, escribe a [por completar: correo de contacto]. Si no estás conforme con la respuesta, puedes acudir a la Autoridad Nacional de Protección de Datos Personales.',
        ),
      ],
    },
    {
      id: 'cookies',
      titulo: 'Cookies y almacenamiento del navegador',
      bloques: [
        parrafo(
          'Usamos solo cookies técnicas, necesarias para mantener tu sesión. No usamos cookies de publicidad ni de seguimiento.',
        ),
        lista(
          '`rt` y `rtp`: renuevan tu sesión de forma segura (no las puede leer el código de la página).',
          '`hay_sesion`: indica que vale la pena intentar renovar la sesión; no contiene datos tuyos.',
          'En el almacenamiento del navegador se guardan, solo en tu equipo, `tema` (tema claro u oscuro) y `barberias.ultimaBarberia` (el enlace y el nombre públicos de la última barbería que visitaste, para ofrecerte "Ingresar" allí).',
        ),
      ],
    },
    {
      id: 'seguridad',
      titulo: 'Seguridad',
      bloques: [
        parrafo(
          'Los datos de cada barbería están separados por la base de datos misma, las contraseñas se guardan cifradas, las capturas y comprobantes son privados y las acciones sensibles quedan registradas.',
        ),
      ],
    },
    {
      id: 'cambios',
      titulo: 'Cambios en esta política',
      bloques: [
        parrafo(
          'Cuando esta política cambie se publicará una versión nueva con su fecha. Quien aceptó una versión anterior conserva el registro de esa aceptación.',
        ),
      ],
    },
  ],
};
