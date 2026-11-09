import { Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  CanalNoDisponible,
  DestinatarioInvalido,
  type NotificationChannel,
} from '../../src/modules/notificaciones/application/ports/notification-channel';

// T018 de 004 · Suite de contrato del puerto NotificationChannel (ADR-026, contracts/notification-channel.md
// §4). Es independiente del canal: cada adaptador aporta su entorno y la MISMA batería corre contra el correo
// (canal-correo.contract.spec.ts, con Mailpit), contra el simulador de WhatsApp (fase 5) y, con credenciales,
// contra un proveedor real (canal-sandbox.contract.spec.ts).

/** Situación del canal en la que se prueba el adaptador. */
export type Situacion =
  | 'normal'
  /** Acepta la conexión y no responde: debe cortar en el tiempo límite. */
  | 'colgado'
  /** No acepta o corta la conexión. */
  | 'caido'
  /** Rechaza el destinatario de forma permanente. */
  | 'rechaza-destinatario'
  /** Rechazo temporal por límite de envíos (429 en HTTP; 451 en SMTP). */
  | 'limite';

export interface CanalEnPrueba {
  /** Un adaptador nuevo, con su propio interruptor, apuntando al canal en la situación pedida. */
  canal: NotificationChannel;
  /**
   * Cuántas veces el adaptador llegó a contactar al canal (conexiones o solicitudes). La suite solo lo lee en
   * las situaciones `caido`; en las demás puede devolver 0.
   */
  llamadas(): number;
}

export interface MensajeRecibido {
  texto: string;
  claveIdempotencia: string;
  charsetUtf8: boolean;
}

export interface EntornoDeCanal {
  /** Tiempo límite configurado en los adaptadores que crea `canalEn`. */
  tiempoLimiteMs: number;
  /** Destino válido, propio de esta ejecución (para leer solo lo enviado aquí). */
  destino: string;
  canalEn(situacion: Situacion): Promise<CanalEnPrueba>;
  recibidos(destino: string): Promise<MensajeRecibido[]>;
  /**
   * true si el canal descarta un segundo envío con la misma clave (WhatsApp, por `Idempotency-Key`); false si
   * lo entrega otra vez con el mismo identificador (SMTP, por `Message-ID`: límite del protocolo).
   */
  idempotenciaDescarta: boolean;
  cerrar(): Promise<void>;
}

/** Texto con tildes, eñe y signos, para comprobar el UTF-8 de punta a punta. */
const TEXTO = 'Hola, Ñusta: tu cita en Barbería Peñaloza es el sábado a las 10:30. ¿Vienes? ¡Gracias!';

function mensaje(destino: string, clave = uuidv7()) {
  return { destino, asunto: 'Confirmación de tu cita', texto: TEXTO, claveIdempotencia: clave };
}

export function probarContratoDeCanal(nombre: string, fabrica: () => Promise<EntornoDeCanal>): void {
  describe(`Contrato de NotificationChannel: ${nombre}`, () => {
    let entorno: EntornoDeCanal;

    beforeAll(async () => {
      entorno = await fabrica();
    });

    afterAll(async () => {
      await entorno?.cerrar();
    });

    it('envío normal: EnvioAceptado y el destino recibe exactamente el texto, en UTF-8', async () => {
      const { canal } = await entorno.canalEn('normal');
      const clave = uuidv7();
      const aceptado = await canal.enviar(mensaje(entorno.destino, clave));
      expect(typeof aceptado.referencia).toBe('string');
      expect(aceptado.referencia.length).toBeGreaterThan(0);
      const recibidos = (await entorno.recibidos(entorno.destino)).filter(
        (m) => m.claveIdempotencia === clave,
      );
      expect(recibidos).toHaveLength(1);
      expect(recibidos[0].texto.trim()).toBe(TEXTO);
      expect(recibidos[0].charsetUtf8).toBe(true);
    });

    it('misma claveIdempotencia dos veces: un solo mensaje o el mismo identificador', async () => {
      const { canal } = await entorno.canalEn('normal');
      const clave = uuidv7();
      const primero = await canal.enviar(mensaje(entorno.destino, clave));
      const segundo = await canal.enviar(mensaje(entorno.destino, clave));
      const recibidos = (await entorno.recibidos(entorno.destino)).filter(
        (m) => m.claveIdempotencia === clave,
      );
      if (entorno.idempotenciaDescarta) {
        expect(recibidos).toHaveLength(1);
        expect(segundo.referencia).toBe(primero.referencia);
      } else {
        // SMTP no deduplica: los dos llevan el mismo Message-ID para que el buzón los agrupe.
        expect(recibidos).toHaveLength(2);
        expect(new Set(recibidos.map((m) => m.claveIdempotencia))).toEqual(new Set([clave]));
      }
    });

    it('canal colgado: CanalNoDisponible en ≤ tiempo límite + 200 ms', async () => {
      const { canal } = await entorno.canalEn('colgado');
      const inicio = Date.now();
      await expect(canal.enviar(mensaje(entorno.destino))).rejects.toBeInstanceOf(CanalNoDisponible);
      expect(Date.now() - inicio).toBeLessThanOrEqual(entorno.tiempoLimiteMs + 200);
    });

    it('canal caído: CanalNoDisponible', async () => {
      const { canal } = await entorno.canalEn('caido');
      await expect(canal.enviar(mensaje(entorno.destino))).rejects.toBeInstanceOf(CanalNoDisponible);
    });

    it('5 fallos en 60 s abren el circuito: el sexto falla al instante, sin llamar al canal', async () => {
      const { canal, llamadas } = await entorno.canalEn('caido');
      for (let i = 0; i < 5; i += 1) {
        await expect(canal.enviar(mensaje(entorno.destino))).rejects.toBeInstanceOf(CanalNoDisponible);
      }
      const antes = llamadas();
      expect(antes).toBe(5);
      const inicio = Date.now();
      await expect(canal.enviar(mensaje(entorno.destino))).rejects.toBeInstanceOf(CanalNoDisponible);
      expect(Date.now() - inicio).toBeLessThan(100);
      expect(llamadas()).toBe(antes);
    });

    it('destinatario inválido: DestinatarioInvalido, que no abre el circuito', async () => {
      const { canal } = await entorno.canalEn('rechaza-destinatario');
      for (let i = 0; i < 6; i += 1) {
        await expect(canal.enviar(mensaje(entorno.destino))).rejects.toBeInstanceOf(DestinatarioInvalido);
      }
    });

    // Con el canal caído: si el adaptador llamara, fallaría con CanalNoDisponible y la cuenta subiría.
    it('un destino mal formado es DestinatarioInvalido sin llamar al canal', async () => {
      const { canal, llamadas } = await entorno.canalEn('caido');
      const antes = llamadas();
      await expect(canal.enviar(mensaje('no es un destino'))).rejects.toBeInstanceOf(DestinatarioInvalido);
      expect(llamadas()).toBe(antes);
    });

    it('límite de envíos (rechazo temporal): CanalNoDisponible', async () => {
      const { canal } = await entorno.canalEn('limite');
      await expect(canal.enviar(mensaje(entorno.destino))).rejects.toBeInstanceOf(CanalNoDisponible);
    });

    it('ningún registro contiene el texto ni el destino', async () => {
      const capturado: string[] = [];
      const capturar = (...partes: unknown[]) => {
        capturado.push(partes.map(String).join(' '));
      };
      const espias = [
        ...(['log', 'warn', 'error', 'debug', 'verbose'] as const).map((metodo) =>
          jest.spyOn(Logger.prototype, metodo).mockImplementation(capturar),
        ),
        ...(['log', 'warn', 'error', 'info', 'debug'] as const).map((metodo) =>
          jest.spyOn(console, metodo).mockImplementation(capturar),
        ),
      ];
      try {
        const normal = await entorno.canalEn('normal');
        await normal.canal.enviar(mensaje(entorno.destino));
        const caido = await entorno.canalEn('caido');
        for (let i = 0; i < 6; i += 1)
          await caido.canal.enviar(mensaje(entorno.destino)).catch(() => undefined);
        const rechazo = await entorno.canalEn('rechaza-destinatario');
        await rechazo.canal.enviar(mensaje(entorno.destino)).catch(() => undefined);
      } finally {
        for (const espia of espias) espia.mockRestore();
      }
      const todo = capturado.join('\n');
      expect(todo).not.toContain(entorno.destino);
      expect(todo).not.toContain('Ñusta');
      expect(todo).not.toContain('Peñaloza');
    });
  });
}
