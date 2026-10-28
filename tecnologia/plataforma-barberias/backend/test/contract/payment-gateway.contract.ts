import {
  FirmaInvalida,
  PagoDesconocido,
  type PaymentGateway,
  ProveedorNoDisponible,
} from '../../src/modules/suscripciones-pagos/pagos/application/ports/payment-gateway';

// T013 · PR20: suite de contrato del puerto PaymentGateway (contracts/pasarela-simulada.md §1). La MISMA
// suite corre contra cada adaptador: el simulador (siempre, gateway-simulado.spec.ts) y el ambiente de
// pruebas del proveedor (solo con PAGOS_SANDBOX_*, gateway-sandbox.spec.ts). Así, pasar a producción es
// cambiar la configuración y no el comportamiento (FR-011, SC-009).

/** Lo que cada adaptador aporta para que la suite pueda probarlo. */
export interface EntornoDePasarela {
  pasarela: PaymentGateway;
  /** Tiempo límite configurado en el adaptador. */
  tiempoLimiteMs: number;
  /** Decide una sesión como lo haría el pagador (aprobar o rechazar). */
  decidir(referencia: string, accion: 'aprobar' | 'rechazar'): Promise<void>;
  /** Una notificación del adaptador firmada con su secreto y la marca de tiempo indicada. */
  notificacionFirmada(datos: { referencia: string; estado: string; importeCentimos: number; t: number }): {
    cuerpo: Buffer;
    encabezados: Record<string, string>;
  };
  /** Hace que el proveedor acepte conexiones y no responda (para el tiempo límite). */
  colgar(): Promise<void>;
  /** Vuelve al comportamiento normal. */
  restaurar(): Promise<void>;
  cerrar(): Promise<void>;
}

const SOLICITUD = {
  importeCentimos: 4900,
  moneda: 'PEN',
  descripcion: 'Plan Básico · contrato PR20',
  metodo: 'YAPE' as const,
  urlRetorno: 'http://localhost:5173/app/suscripcion',
};

export function probarContratoDePasarela(nombre: string, fabrica: () => Promise<EntornoDePasarela>): void {
  describe(`PR20 · Contrato de PaymentGateway: ${nombre}`, () => {
    let entorno: EntornoDePasarela;
    let secuencia = 0;
    const crear = (importeCentimos = SOLICITUD.importeCentimos) =>
      entorno.pasarela.crearSesionDePago({
        ...SOLICITUD,
        importeCentimos,
        pagoId: `pago-pr20-${++secuencia}`,
      });

    beforeAll(async () => {
      entorno = await fabrica();
    });

    afterEach(async () => {
      await entorno.restaurar();
    });

    afterAll(async () => {
      await entorno.cerrar();
    });

    it('crea una sesión alojada y la consulta pendiente, con el mismo importe', async () => {
      const sesion = await crear();
      expect(sesion.referenciaProveedor).toEqual(expect.any(String));
      expect(new URL(sesion.urlPago).protocol).toMatch(/^https?:$/);
      expect(sesion.expiraEn.getTime()).toBeGreaterThan(Date.now());
      await expect(entorno.pasarela.consultarPago(sesion.referenciaProveedor)).resolves.toEqual({
        estado: 'PENDIENTE',
        importeCentimos: 4900,
        moneda: 'PEN',
      });
    });

    it.each([
      ['aprobar', 'APROBADO'],
      ['rechazar', 'RECHAZADO'],
    ] as const)('al %s, la consulta devuelve %s con el importe enviado', async (accion, estado) => {
      const sesion = await crear(8900);
      await entorno.decidir(sesion.referenciaProveedor, accion);
      await expect(entorno.pasarela.consultarPago(sesion.referenciaProveedor)).resolves.toEqual({
        estado,
        importeCentimos: 8900,
        moneda: 'PEN',
      });
    });

    it('cancela una sesión pendiente: deja de estar pendiente y no se cancela dos veces', async () => {
      const sesion = await crear();
      await expect(entorno.pasarela.cancelarSesion(sesion.referenciaProveedor)).resolves.toBe(true);
      const consulta = await entorno.pasarela.consultarPago(sesion.referenciaProveedor);
      expect(consulta.estado).not.toBe('PENDIENTE');
      expect(consulta.estado).not.toBe('APROBADO');
      await expect(entorno.pasarela.cancelarSesion(sesion.referenciaProveedor)).resolves.toBe(false);
    });

    it('una sesión aprobada no se cancela', async () => {
      const sesion = await crear();
      await entorno.decidir(sesion.referenciaProveedor, 'aprobar');
      await expect(entorno.pasarela.cancelarSesion(sesion.referenciaProveedor)).resolves.toBe(false);
    });

    it('una referencia desconocida responde PagoDesconocido', async () => {
      await expect(entorno.pasarela.consultarPago('ses_no_existe_pr20')).rejects.toBeInstanceOf(
        PagoDesconocido,
      );
    });

    describe('notificaciones firmadas', () => {
      const ahora = () => Math.floor(Date.now() / 1000);
      const datos = (t: number) => ({ referencia: 'ses_pr20', estado: 'APROBADO', importeCentimos: 4900, t });

      it('una firma válida se acepta y devuelve solo los campos del contrato', () => {
        const { cuerpo, encabezados } = entorno.notificacionFirmada(datos(ahora()));
        const verificada = entorno.pasarela.verificarNotificacion(cuerpo, encabezados);
        expect(verificada).toEqual({
          eventoId: expect.any(String),
          tipo: expect.any(String),
          referencia: 'ses_pr20',
          estado: 'APROBADO',
          importeCentimos: 4900,
          moneda: 'PEN',
          emitidoEn: expect.any(Date),
        });
      });

      it('un cuerpo alterado (otro importe) invalida la firma', () => {
        const { cuerpo, encabezados } = entorno.notificacionFirmada(datos(ahora()));
        const alterado = Buffer.from(cuerpo.toString('utf8').replace('4900', '100'));
        expect(() => entorno.pasarela.verificarNotificacion(alterado, encabezados)).toThrow(FirmaInvalida);
      });

      it('sin el encabezado de la firma se rechaza', () => {
        const { cuerpo } = entorno.notificacionFirmada(datos(ahora()));
        expect(() => entorno.pasarela.verificarNotificacion(cuerpo, {})).toThrow(FirmaInvalida);
      });

      it.each([
        ['vencida (hace 6 minutos)', -360],
        ['del futuro (en 6 minutos)', 360],
      ])('una firma %s se rechaza', (_caso, desfase) => {
        const { cuerpo, encabezados } = entorno.notificacionFirmada(datos(ahora() + desfase));
        expect(() => entorno.pasarela.verificarNotificacion(cuerpo, encabezados)).toThrow(FirmaInvalida);
      });

      it('una firma dentro de los ±5 minutos se acepta', () => {
        const { cuerpo, encabezados } = entorno.notificacionFirmada(datos(ahora() - 240));
        expect(() => entorno.pasarela.verificarNotificacion(cuerpo, encabezados)).not.toThrow();
      });
    });

    it('un proveedor que no responde se traduce en ProveedorNoDisponible dentro del tiempo límite', async () => {
      await entorno.colgar();
      const inicio = Date.now();
      await expect(crear()).rejects.toBeInstanceOf(ProveedorNoDisponible);
      expect(Date.now() - inicio).toBeLessThan(entorno.tiempoLimiteMs + 1000);
    });
  });
}
