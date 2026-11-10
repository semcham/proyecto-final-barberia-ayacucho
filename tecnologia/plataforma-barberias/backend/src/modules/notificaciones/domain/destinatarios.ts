import type { Destinatario } from './aviso';

// T069 de 004 · Quién recibe qué (contracts/eventos.md §4; FR-008, FR-009). Regla pura:
// - el cliente, siempre (por su canal; si no tiene ninguno, el aviso se descarta al enviar);
// - el propietario y el barbero con usuario vinculado, por correo, solo si canceló o reprogramó el CLIENTE.

const texto = (valor: unknown): string | null => (typeof valor === 'string' && valor !== '' ? valor : null);

export function destinatariosDe(
  tipoEvento: string,
  payload: Record<string, unknown>,
  tenantId: string,
): Destinatario[] {
  const clienteId = texto(payload.clienteId);
  if (!clienteId) return [];
  const cliente: Destinatario = { tipo: 'CLIENTE', ref: clienteId };

  let porElCliente: boolean;
  if (tipoEvento === 'CitaCreada') porElCliente = false;
  else if (tipoEvento === 'CitaCancelada') porElCliente = payload.canceladaPor === 'CLIENTE';
  else if (tipoEvento === 'CitaReprogramada') porElCliente = payload.reprogramadaPor === 'CLIENTE';
  else return [];

  if (!porElCliente) return [cliente];
  const destinatarios: Destinatario[] = [cliente, { tipo: 'PROPIETARIO', ref: tenantId }];
  const barberoUsuarioId = texto(payload.barberoUsuarioId);
  if (barberoUsuarioId) destinatarios.push({ tipo: 'BARBERO', ref: barberoUsuarioId });
  return destinatarios;
}
