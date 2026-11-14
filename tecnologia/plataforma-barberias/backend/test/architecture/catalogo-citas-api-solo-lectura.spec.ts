import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

// T004 de 005 · FR-005, research R01: la interfaz pública que M02 ofrece a M04 es SOLO de lectura. Su lista de
// miembros es exactamente la de research R01 (agregar un método obliga a cambiar esta prueba y el research), su
// implementación no expone nada más, y ni la implementación ni la lectura de agregados escriben en la base ni usan
// casos de uso de escritura de M02.

const RAIZ = join(__dirname, '..', '..');
const M02 = join(RAIZ, 'src', 'modules', 'catalogo-citas');

const METODOS_R01 = [
  'contextoDeLaBarberia',
  'serviciosActivos',
  'barberosQueOfrecen',
  'horariosLibres',
  'conteosDeCitas',
  'serviciosMasSolicitados',
  'actividad',
];

function fuente(ruta: string): ts.SourceFile {
  return ts.createSourceFile(ruta, readFileSync(ruta, 'utf8'), ts.ScriptTarget.Latest, true);
}

function clase(archivo: ts.SourceFile, nombre: string): ts.ClassDeclaration {
  const encontrada = archivo.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === nombre,
  );
  if (!encontrada) throw new Error(`No se encontró la clase ${nombre} en ${archivo.fileName}`);
  return encontrada;
}

const esPrivado = (miembro: ts.ClassElement) =>
  ts.canHaveModifiers(miembro) &&
  (ts.getModifiers(miembro) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
  );

/** Nombres de los miembros públicos (métodos, propiedades y accesores), sin el constructor. */
function miembrosPublicos(declaracion: ts.ClassDeclaration): string[] {
  return declaracion.members
    .filter((m) => !ts.isConstructorDeclaration(m) && !esPrivado(m))
    .map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : m.getText()))
    .sort();
}

describe('CatalogoCitasApi es solo de lectura (T004 de 005, FR-005)', () => {
  const interfaz = fuente(join(M02, 'catalogo-citas-api.ts'));
  const implementacion = fuente(join(M02, 'catalogo', 'application', 'catalogo-citas-api-impl.ts'));
  const agregados = join(M02, 'citas', 'infrastructure', 'reportes-de-citas-query.ts');

  it('la clase abstracta tiene exactamente los siete métodos de research R01', () => {
    const api = clase(interfaz, 'CatalogoCitasApi');
    expect(miembrosPublicos(api)).toEqual([...METODOS_R01].sort());
    // Todos abstractos: la interfaz no trae lógica propia.
    for (const miembro of api.members) {
      expect(
        ts
          .getModifiers(miembro as ts.MethodDeclaration)
          ?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword),
      ).toBe(true);
    }
  });

  it('la implementación no expone ningún miembro público más que esos siete', () => {
    expect(miembrosPublicos(clase(implementacion, 'CatalogoCitasApiImpl'))).toEqual([...METODOS_R01].sort());
  });

  it('M02 la exporta en su index.ts', () => {
    expect(readFileSync(join(M02, 'index.ts'), 'utf8')).toMatch(
      /export \{[^}]*CatalogoCitasApi[^}]*\} from '\.\/catalogo-citas-api'/s,
    );
  });

  it.each([
    ['la implementación', join(M02, 'catalogo', 'application', 'catalogo-citas-api-impl.ts')],
    ['la lectura de agregados', agregados],
  ])('%s no escribe en la base', (_nombre, ruta) => {
    const texto = readFileSync(ruta, 'utf8');
    expect(texto).not.toMatch(/\b(insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\b/);
    expect(texto).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i);
  });

  it('la implementación no usa casos de uso de escritura de M02', () => {
    const importaciones = implementacion.statements
      .filter(ts.isImportDeclaration)
      .map((i) => (i.moduleSpecifier as ts.StringLiteral).text);
    // Los casos de uso de escritura de citas, y los archivos del catálogo que crean o cambian servicios, barberos,
    // bloqueos u horarios (consultar-horarios, que solo lee, sí se permite).
    const escritura =
      /(reservar|cancelar|reprogramar|cambiar-estado|confirmar|vencer|purgar|accion-por-enlace|\/(servicios|barberos|bloqueos|horarios)$)/;
    expect(importaciones.filter((ruta) => escritura.test(ruta))).toEqual([]);
  });
});
