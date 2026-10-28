import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// T055 · PR14: cada caso de uso de escritura de contracts/restricciones-estado.md §2 consulta la política de
// la suscripción (`exigirOperacion`) con su acción. Análisis del texto fuente: una clase listada que no la
// llama, o que la llama con otra acción, hace fallar la prueba; una clase listada que no existe, también.

const RAIZ = join(__dirname, '..', '..');
const MODULOS = join(RAIZ, 'src', 'modules');
const CONTRATO = join(
  RAIZ,
  '..',
  '..',
  '..',
  'specs',
  '003-suscripciones-pagos',
  'contracts',
  'restricciones-estado.md',
);

/** §2 del contrato: caso de uso → acción. */
function casosDeUso(): Map<string, string> {
  const texto = readFileSync(CONTRATO, 'utf8');
  const seccion = texto.slice(texto.indexOf('## 2. Casos de uso'));
  const casos = new Map<string, string>();
  for (const linea of seccion.split(/\r?\n/).filter((l) => l.startsWith('|'))) {
    const [nombres, , accion] = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (!accion?.startsWith('`')) continue;
    for (const m of nombres.matchAll(/`(\w+)`/g)) casos.set(m[1], accion.replace(/`/g, ''));
  }
  return casos;
}

function archivosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivosTs(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

/** Cuerpo de `class Nombre` en el texto, por llaves balanceadas; null si no está. */
export function cuerpoDeClase(fuente: string, nombre: string): string | null {
  const inicio = fuente.search(new RegExp(`\\bclass ${nombre}\\b`));
  if (inicio < 0) return null;
  const apertura = fuente.indexOf('{', inicio);
  let profundidad = 0;
  for (let i = apertura; i < fuente.length; i += 1) {
    if (fuente[i] === '{') profundidad += 1;
    if (fuente[i] === '}' && --profundidad === 0) return fuente.slice(apertura, i + 1);
  }
  return null;
}

/** Problema de la clase con la política, o null si la consulta con la acción del contrato. */
export function problemaDe(cuerpo: string | null, accion: string): string | null {
  if (cuerpo === null) return 'no existe en src/modules';
  // Los argumentos pueden tener paréntesis (`TenantId.de(actor.tenantId)`): se toma hasta el fin de la sentencia.
  const llamadas = [...cuerpo.matchAll(/exigirOperacion\(([^;]*)/g)].map((m) => m[1]);
  if (llamadas.length === 0) return 'no llama a exigirOperacion';
  if (!llamadas.every((args) => args.includes(`'${accion}'`))) return `no la llama con '${accion}'`;
  return null;
}

describe('Operaciones con la política de la suscripción (PR14, T055)', () => {
  const casos = casosDeUso();
  const fuentes = archivosTs(MODULOS).map((ruta) => readFileSync(ruta, 'utf8'));
  const cuerpo = (nombre: string) =>
    fuentes.map((f) => cuerpoDeClase(f, nombre)).find((c) => c !== null) ?? null;

  it('el contrato lista los casos de uso de M01 y M02', () => {
    expect(casos.size).toBe(14);
    expect(casos.get('ReservarCita')).toBe('RESERVAR');
    expect(casos.get('RegenerarActivacion')).toBe('GESTIONAR_USUARIOS');
  });

  it('cada caso de uso de §2 llama a exigirOperacion con su acción', () => {
    const problemas = [...casos]
      .map(([nombre, accion]) => [nombre, problemaDe(cuerpo(nombre), accion)])
      .filter(([, problema]) => problema !== null)
      .map(([nombre, problema]) => `${nombre}: ${problema}`);
    expect(problemas).toEqual([]);
  });

  it('detecta una clase sin la llamada, con otra acción o inexistente', () => {
    const sin = 'class A { ejecutar() { return this.uow.ejecutar(t, () => 1); } }';
    const otra = "class B { ejecutar() { await this.s.exigirOperacion(t, 'PAGAR'); } }";
    const bien =
      "class C { ejecutar() { if (x) { await this.s.exigirOperacion(TenantId.de(a.t), 'RESERVAR'); } } }";
    expect(problemaDe(cuerpoDeClase(sin, 'A'), 'RESERVAR')).toBe('no llama a exigirOperacion');
    expect(problemaDe(cuerpoDeClase(otra, 'B'), 'RESERVAR')).toBe("no la llama con 'RESERVAR'");
    expect(problemaDe(cuerpoDeClase(bien, 'C'), 'RESERVAR')).toBeNull();
    expect(problemaDe(cuerpoDeClase(bien, 'Z'), 'RESERVAR')).toBe('no existe en src/modules');
  });
});
