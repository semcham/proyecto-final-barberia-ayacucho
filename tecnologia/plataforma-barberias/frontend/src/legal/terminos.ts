import { type DocumentoLegal, lista, parrafo } from './documento';

// T010 de 010 · Términos y condiciones: BORRADOR BASE para la revisión del responsable humano (FR-027). Solo describe
// lo que la plataforma hace hoy. Lo que no se conoce (razón social, RUC, domicilio, correo de contacto) queda como
// "[por completar: …]" a la vista, sin inventarlo. Una versión nueva se publica cambiando `version` aquí y en
// TERMS_VERSION del backend; quien aceptó una anterior conserva su registro (decisión del 2026-11-23).

export const TERMINOS: DocumentoLegal = {
  titulo: 'Términos y condiciones',
  version: '2026-11',
  vigenteDesde: '2026-11-23',
  borrador: true,
  resumen:
    'Las reglas para usar Barberías Ayacucho: qué ofrece la plataforma a las barberías y a sus clientes, qué se espera de cada persona y qué pasa con las cuentas y las suscripciones.',
  secciones: [
    {
      id: 'quienes-somos',
      titulo: 'Quiénes somos y a quién se aplican',
      bloques: [
        parrafo(
          'Barberías Ayacucho es una plataforma web para que las barberías gestionen su agenda, su equipo y sus clientes, y para que los clientes reserven citas por el enlace de cada barbería. La opera [por completar: razón social, RUC y domicilio del titular de la plataforma].',
        ),
        parrafo(
          'Estos términos se aplican a los propietarios que registran una barbería, a los barberos y demás personal que reciben acceso, y a los clientes que crean una cuenta para reservar.',
        ),
      ],
    },
    {
      id: 'cuentas',
      titulo: 'Cuentas y roles',
      bloques: [
        lista(
          'Cada persona usa su propio correo y su propia contraseña. No compartas tu contraseña: lo que se haga con tu cuenta se considera hecho por ti.',
          'El propietario administra su barbería: datos, horario, servicios, barberos, usuarios y suscripción. Crea las cuentas de su personal y les entrega su enlace de activación.',
          'El barbero ve su agenda, marca sus citas y define su disponibilidad.',
          'El cliente reserva, reprograma y cancela sus citas desde el enlace de la barbería. Una misma cuenta de cliente puede usarse en varias barberías; cada barbería ve solo los datos que el cliente le da al unirse.',
        ),
      ],
    },
    {
      id: 'prueba-y-planes',
      titulo: 'Prueba gratuita, planes y pagos de la suscripción',
      bloques: [
        parrafo(
          'Al registrar una barbería empieza una prueba gratuita de 14 días, sin tarjeta y sin cargos automáticos al terminar. Para seguir recibiendo reservas nuevas, el propietario elige un plan. Cada plan tiene un precio mensual en soles y un límite de usuarios y de barberos, que se muestran antes de contratar.',
        ),
        parrafo(
          'Si la suscripción vence o se suspende, la barbería deja de recibir reservas nuevas; sus datos se conservan. La plataforma no guarda datos de tarjetas: los pagos de la suscripción los procesa un proveedor de pagos o se registran por transferencia con su comprobante.',
        ),
      ],
    },
    {
      id: 'reservas-y-adelantos',
      titulo: 'Reservas, cancelaciones y adelantos',
      bloques: [
        lista(
          'Cada barbería fija sus servicios, precios, horarios y la antelación mínima para cancelar. Si un cliente cancela con menos tiempo, la cita queda marcada como cancelación tardía.',
          'Si una barbería pide un adelanto, el cliente lo paga directamente a la barbería con su QR de Yape o Plin. La plataforma no recibe, no retiene ni transfiere ese dinero, y no cobra comisión: solo registra el número de operación que declara el cliente y la confirmación del propietario.',
          'Las devoluciones de un adelanto las hace la barbería por su cuenta, según sus propias reglas.',
        ),
      ],
    },
    {
      id: 'uso-aceptable',
      titulo: 'Uso aceptable',
      bloques: [
        lista(
          'Usa datos verdaderos y que te pertenezcan. No registres a otra persona sin su permiso.',
          'No intentes acceder a datos de otra barbería ni de otra persona, ni sobrecargar o alterar la plataforma.',
          'El asistente automático responde con la información de la barbería; no lo uses para fines ajenos a reservar o administrar la barbería.',
        ),
      ],
    },
    {
      id: 'datos-de-la-barberia',
      titulo: 'Los datos de cada barbería',
      bloques: [
        parrafo(
          'Los datos de cada barbería están separados de los de las demás. Cada barbería es responsable de los datos de sus clientes que trata en la plataforma; el tratamiento de los datos personales se explica en la [política de privacidad](/privacidad).',
        ),
      ],
    },
    {
      id: 'suspension',
      titulo: 'Suspensión y cierre de cuentas',
      bloques: [
        parrafo(
          'La plataforma puede suspender una barbería o una cuenta que incumpla estos términos o ponga en riesgo a otras personas. El propietario puede pedir el cierre de su barbería [por completar: canal y plazo para pedir el cierre y la entrega de datos].',
        ),
      ],
    },
    {
      id: 'responsabilidad',
      titulo: 'Disponibilidad y responsabilidad',
      bloques: [
        parrafo(
          'La plataforma se esfuerza por estar disponible, pero puede tener interrupciones. Los avisos por correo o por WhatsApp pueden demorar o no llegar por causas ajenas; la agenda de la plataforma es la referencia de cada cita. [por completar: límites de responsabilidad revisados por un profesional del derecho].',
        ),
      ],
    },
    {
      id: 'cambios-y-contacto',
      titulo: 'Cambios y contacto',
      bloques: [
        parrafo(
          'Cuando estos términos cambien se publicará una versión nueva con su fecha. Quien aceptó una versión anterior conserva el registro de esa aceptación.',
        ),
        parrafo('Contacto: [por completar: correo de contacto de la plataforma].'),
      ],
    },
  ],
};
