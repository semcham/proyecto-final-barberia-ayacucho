import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

// T017 de 004 · Buzón de correo de las pruebas (ADR-026, research R16): Mailpit en Testcontainers, con los
// mensajes leídos por su API HTTP. La imagen la descarga el responsable: MAILPIT_IMAGEN permite usar la
// etiqueta exacta que tenga en el equipo (Testcontainers solo descarga si no la encuentra).
//
// Para los casos que Mailpit no reproduce (servidor colgado, conexión cortada, rechazos 550 y 451), un
// servidor SMTP falso en el propio proceso, que además cuenta las conexiones recibidas.

const IMAGEN = process.env.MAILPIT_IMAGEN ?? 'axllent/mailpit:latest';

export interface MensajeEnMailpit {
  id: string;
  messageId: string;
  para: string[];
  asunto: string;
  texto: string;
  contentType: string;
}

export interface Mailpit {
  host: string;
  puertoSmtp: number;
  /** Mensajes recibidos para un destino, del más antiguo al más reciente. */
  mensajesPara(destino: string): Promise<MensajeEnMailpit[]>;
  borrarTodo(): Promise<void>;
  detener(): Promise<void>;
}

interface ResumenApi {
  ID: string;
  MessageID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

export async function iniciarMailpit(): Promise<Mailpit> {
  const contenedor: StartedTestContainer = await new GenericContainer(IMAGEN)
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/readyz', 8025).forStatusCode(200))
    .start();
  const host = contenedor.getHost();
  const api = `http://${host}:${contenedor.getMappedPort(8025)}/api/v1`;

  async function json<T>(ruta: string): Promise<T> {
    const respuesta = await fetch(`${api}${ruta}`);
    if (!respuesta.ok) throw new Error(`Mailpit respondió ${respuesta.status} en ${ruta}`);
    return (await respuesta.json()) as T;
  }

  return {
    host,
    puertoSmtp: contenedor.getMappedPort(1025),
    async mensajesPara(destino) {
      const { messages } = await json<{ messages: ResumenApi[] }>('/messages?limit=500');
      const propios = messages
        .filter((m) => m.To.some((t) => t.Address.toLowerCase() === destino.toLowerCase()))
        .sort((x, y) => x.Created.localeCompare(y.Created));
      return Promise.all(
        propios.map(async (m) => {
          const detalle = await json<{ Text: string }>(`/message/${m.ID}`);
          const encabezados = await json<Record<string, string[]>>(`/message/${m.ID}/headers`);
          return {
            id: m.ID,
            messageId: m.MessageID,
            para: m.To.map((t) => t.Address),
            asunto: m.Subject,
            texto: detalle.Text,
            contentType: (encabezados['Content-Type'] ?? [''])[0],
          };
        }),
      );
    },
    async borrarTodo() {
      await fetch(`${api}/messages`, { method: 'DELETE' });
    },
    async detener() {
      await contenedor.stop();
    },
  };
}

/** Cómo responde el servidor SMTP falso. */
export type ModoSmtpFalso =
  /** Acepta la conexión y nunca saluda (tiempo límite). */
  | 'colgado'
  /** Cierra la conexión apenas la recibe (caído). */
  | 'cierra'
  /** Rechaza el destinatario con 550 (permanente). */
  | 'rechaza-destinatario'
  /** Rechaza el destinatario con 451 (temporal, como un límite de envíos). */
  | 'limite';

export interface SmtpFalso {
  puerto: number;
  modo: ModoSmtpFalso;
  /** Conexiones recibidas desde que se creó o desde el último `reiniciarConteo`. */
  conexiones(): number;
  reiniciarConteo(): void;
  cerrar(): Promise<void>;
}

export async function iniciarSmtpFalso(modoInicial: ModoSmtpFalso): Promise<SmtpFalso> {
  let conexiones = 0;
  const sockets = new Set<Socket>();
  const estado = { modo: modoInicial };
  const servidor: Server = createServer((socket) => {
    conexiones += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    if (estado.modo === 'colgado') return;
    if (estado.modo === 'cierra') {
      socket.destroy();
      return;
    }
    const responder = (linea: string) => socket.write(`${linea}\r\n`);
    responder('220 smtp-falso listo');
    let pendiente = '';
    socket.on('data', (datos) => {
      pendiente += datos.toString('latin1');
      let fin = pendiente.indexOf('\r\n');
      while (fin >= 0) {
        const comando = pendiente.slice(0, fin).toUpperCase();
        pendiente = pendiente.slice(fin + 2);
        if (comando.startsWith('EHLO')) responder('250 smtp-falso');
        else if (comando.startsWith('HELO')) responder('250 smtp-falso');
        else if (comando.startsWith('MAIL FROM')) responder('250 OK');
        else if (comando.startsWith('RCPT TO')) {
          responder(
            estado.modo === 'limite' ? '451 4.7.1 Demasiados envios' : '550 5.1.1 Destinatario inexistente',
          );
        } else if (comando.startsWith('RSET')) responder('250 OK');
        else if (comando.startsWith('QUIT')) {
          responder('221 Adios');
          socket.end();
        } else responder('502 No implementado');
        fin = pendiente.indexOf('\r\n');
      }
    });
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return {
    puerto: (servidor.address() as AddressInfo).port,
    get modo() {
      return estado.modo;
    },
    set modo(valor: ModoSmtpFalso) {
      estado.modo = valor;
    },
    conexiones: () => conexiones,
    reiniciarConteo: () => {
      conexiones = 0;
    },
    cerrar: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
    },
  };
}
