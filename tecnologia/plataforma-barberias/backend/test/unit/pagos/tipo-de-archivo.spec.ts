import {
  detectarTipoComprobante,
  extensionDe,
} from '../../../src/modules/suscripciones-pagos/pagos/domain/tipo-de-archivo';

// T072 · Tipo de un comprobante por sus bytes (R05, FR-020): JPEG, PNG y PDF válidos; un texto renombrado,
// un archivo vacío y una cabecera truncada se rechazan; un PNG con extensión .pdf es un PNG.

const bytes = (...valores: number[]) => Uint8Array.from(valores);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48);
const PDF = Uint8Array.from(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj', 'latin1'));

describe('Tipo de comprobante por sus bytes (T072)', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg', 'jpg'],
    ['PNG', PNG, 'image/png', 'png'],
    ['PDF', PDF, 'application/pdf', 'pdf'],
  ] as const)('reconoce un %s válido', (_nombre, contenido, tipo, extension) => {
    const detectado = detectarTipoComprobante(contenido);
    expect(detectado).toBe(tipo);
    expect(extensionDe(tipo)).toBe(extension);
  });

  it('rechaza un texto renombrado a .png, .jpg o .pdf (el nombre no cuenta)', () => {
    expect(detectarTipoComprobante(Buffer.from('Comprobante de pago: S/ 49.00\n'))).toBeNull();
    expect(detectarTipoComprobante(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    // Un PDF escrito con minúsculas o sin el guion no es un PDF.
    expect(detectarTipoComprobante(Buffer.from('%pdf-1.7 contenido'))).toBeNull();
    expect(detectarTipoComprobante(Buffer.from('%PDF1.7 contenido'))).toBeNull();
  });

  it('rechaza un archivo vacío', () => {
    expect(detectarTipoComprobante(new Uint8Array(0))).toBeNull();
  });

  it('rechaza una cabecera truncada o una firma sin contenido', () => {
    expect(detectarTipoComprobante(bytes(0xff, 0xd8))).toBeNull();
    expect(detectarTipoComprobante(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBeNull();
    expect(detectarTipoComprobante(Buffer.from('%PDF'))).toBeNull();
    // La firma exacta, sin un solo byte más, tampoco es un archivo.
    expect(detectarTipoComprobante(bytes(0xff, 0xd8, 0xff))).toBeNull();
    expect(detectarTipoComprobante(Buffer.from('%PDF-'))).toBeNull();
  });

  it('un PNG con extensión .pdf se detecta como PNG: lo que manda es el contenido', () => {
    // El nombre "comprobante.pdf" no llega a la función: solo los bytes.
    expect(detectarTipoComprobante(PNG)).toBe('image/png');
  });

  it('rechaza otros formatos de imagen y ejecutables', () => {
    expect(detectarTipoComprobante(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'))).toBeNull();
    expect(detectarTipoComprobante(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBeNull();
    expect(detectarTipoComprobante(Buffer.from('MZ\x90\x00\x03\x00', 'latin1'))).toBeNull();
    expect(detectarTipoComprobante(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBeNull();
  });
});
