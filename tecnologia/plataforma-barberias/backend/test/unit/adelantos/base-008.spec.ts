import { ESTADO_POR_CODIGO } from '../../../src/host/error.filter';
import { rolPermiteOperacion } from '../../../src/host/roles.guard';
import { PermisosCatalogoCitas } from '../../../src/modules/catalogo-citas/catalogo/domain/permisos';
import {
  AVISO_POR_EVENTO_DE_ADELANTO,
  TIPOS_DE_AVISO,
} from '../../../src/modules/notificaciones/domain/aviso';
import * as errores from '../../../src/modules/suscripciones-pagos/adelantos/domain/errores';
import { PermisosSuscripciones } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/permisos';
import type { AccionAuditada } from '../../../src/shared';
import { TIPOS_DE_AVISO as TIPOS_0024 } from '../../../migrations/0024_avisos';
import { TIPOS_DE_AVISO_ADELANTO } from '../../../migrations/0030_avisos_adelanto';

// T008 a T010 de 008 · Constantes de la base del adelanto: errores con su estado HTTP (contracts/openapi.yaml),
// operaciones de las matrices de permisos (contracts/rbac.md) y los cinco tipos de aviso (contracts/eventos.md §3).

describe('Errores del adelanto y su estado HTTP (contracts/openapi.yaml de 008)', () => {
  const ESPERADOS: [keyof typeof errores, string, number][] = [
    ['SinTiempoParaAdelanto', 'SIN_TIEMPO_PARA_ADELANTO', 422],
    ['NumeroOperacionRepetido', 'NUMERO_OPERACION_REPETIDO', 409],
    ['PagoYaRegistrado', 'PAGO_YA_REGISTRADO', 409],
    ['AdelantoResuelto', 'ADELANTO_RESUELTO', 409],
    ['AdelantoVencido', 'ADELANTO_VENCIDO', 422],
    ['SinPagoRegistrado', 'SIN_PAGO_REGISTRADO', 409],
    ['AdelantoNoPorDevolver', 'ADELANTO_NO_POR_DEVOLVER', 409],
    ['QrRequerido', 'QR_REQUERIDO', 422],
    ['AdelantoPendiente', 'ADELANTO_PENDIENTE', 409],
  ];

  it.each(ESPERADOS)('%s: código %s → %i', (clase, codigo, estado) => {
    const Error = errores[clase] as unknown as new () => { codigo: string; message: string };
    const error = new Error();
    expect(error.codigo).toBe(codigo);
    expect(error.message.length).toBeGreaterThan(0);
    expect(ESTADO_POR_CODIGO[codigo]).toBe(estado);
  });

  it('el módulo de errores declara exactamente esos nueve', () => {
    expect(Object.keys(errores).sort()).toEqual(ESPERADOS.map(([clase]) => clase).sort());
  });
});

describe('Operaciones del adelanto en las matrices de permisos (contracts/rbac.md de 008)', () => {
  it.each([
    ['CONFIGURAR_ADELANTO', { PROPIETARIO: true, BARBERO: false, CLIENTE: false }],
    ['REVISAR_ADELANTO', { PROPIETARIO: true, BARBERO: false, CLIENTE: false }],
    ['PAGAR_ADELANTO', { PROPIETARIO: false, BARBERO: false, CLIENTE: true }],
  ] as const)('M03 · %s', (operacion, esperado) => {
    for (const rol of ['PROPIETARIO', 'BARBERO', 'CLIENTE'] as const) {
      expect({ rol, permite: PermisosSuscripciones.permite(rol, operacion) }).toEqual({
        rol,
        permite: esperado[rol],
      });
    }
  });

  it('M02 · REVISAR_ADELANTO (confirmar y bandeja) solo PROPIETARIO, sobre cualquier cita de su barbería', () => {
    expect(PermisosCatalogoCitas.rolesPermitidos('REVISAR_ADELANTO')).toEqual(['PROPIETARIO']);
    expect(PermisosCatalogoCitas.alcance('PROPIETARIO', 'REVISAR_ADELANTO')).toBe('TODOS');
  });

  it('el guard HTTP conoce las tres operaciones', () => {
    expect(rolPermiteOperacion('PROPIETARIO', 'CONFIGURAR_ADELANTO')).toBe(true);
    expect(rolPermiteOperacion('BARBERO', 'REVISAR_ADELANTO')).toBe(false);
    expect(rolPermiteOperacion('CLIENTE', 'PAGAR_ADELANTO')).toBe(true);
    expect(rolPermiteOperacion('PROPIETARIO', 'PAGAR_ADELANTO')).toBe(false);
  });
});

describe('Acciones de auditoría del adelanto (research R13)', () => {
  it('existen las siete y caben en audit_log.action varchar(48)', () => {
    // Si alguna no está en AccionAuditada, este archivo no compila.
    const acciones: AccionAuditada[] = [
      'ADELANTO_CONFIGURADO',
      'ADELANTO_PAGO_REGISTRADO',
      'ADELANTO_CONFIRMADO',
      'ADELANTO_PAGO_RECHAZADO',
      'ADELANTO_VENCIDO',
      'ADELANTO_DEVUELTO',
      'ADELANTO_RESUELTO',
    ];
    expect(new Set(acciones).size).toBe(7);
    for (const accion of acciones) expect(accion.length).toBeLessThanOrEqual(48);
  });
});

describe('Tipos de aviso del adelanto (contracts/eventos.md §3, migración 0030)', () => {
  const NUEVOS = [
    'ADELANTO_SOLICITADO',
    'PAGO_ADELANTO_REGISTRADO',
    'ADELANTO_CONFIRMADO',
    'PAGO_ADELANTO_RECHAZADO',
    'ADELANTO_VENCIDO',
  ];

  it('M05 conoce los cinco tipos nuevos, además de los de 004', () => {
    expect([...TIPOS_DE_AVISO].sort()).toEqual([...TIPOS_0024, ...NUEVOS].sort());
  });

  it('el CHECK de notification.kind (0024 + 0030) admite exactamente los tipos de M05', () => {
    expect([...TIPOS_0024, ...TIPOS_DE_AVISO_ADELANTO].sort()).toEqual([...TIPOS_DE_AVISO].sort());
  });

  it('cada tipo cabe en notification.kind varchar(32)', () => {
    for (const tipo of NUEVOS) expect(tipo.length).toBeLessThanOrEqual(32);
  });

  it('cada evento del adelanto tiene su tipo de aviso', () => {
    expect(AVISO_POR_EVENTO_DE_ADELANTO).toEqual({
      AdelantoSolicitado: 'ADELANTO_SOLICITADO',
      PagoDeAdelantoRegistrado: 'PAGO_ADELANTO_REGISTRADO',
      AdelantoConfirmado: 'ADELANTO_CONFIRMADO',
      PagoDeAdelantoRechazado: 'PAGO_ADELANTO_RECHAZADO',
      AdelantoVencido: 'ADELANTO_VENCIDO',
    });
  });
});
