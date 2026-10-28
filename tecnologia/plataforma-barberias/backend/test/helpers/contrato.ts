import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

// Validación de respuestas HTTP contra los contratos OpenAPI de las funcionalidades:
// specs/001-registro-acceso-barberia, specs/002-catalogo-citas-cliente y specs/003-suscripciones-pagos\n// (contracts/openapi.yaml de cada una).

const CONTRATOS = {
  '001': join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'specs',
    '001-registro-acceso-barberia',
    'contracts',
    'openapi.yaml',
  ),
  '002': join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'specs',
    '002-catalogo-citas-cliente',
    'contracts',
    'openapi.yaml',
  ),
  '003': join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'specs',
    '003-suscripciones-pagos',
    'contracts',
    'openapi.yaml',
  ),
} as const;

type Contrato = keyof typeof CONTRATOS;

interface Referencia {
  $ref?: string;
  content?: Record<string, { schema: object }>;
}

interface DocumentoOpenApi {
  paths: Record<string, Record<string, { responses: Record<string, Referencia> }>>;
  components: { responses?: Record<string, Referencia>; schemas: Record<string, object> };
}

interface Validador {
  documento: DocumentoOpenApi;
  ajv: Ajv2020;
  compilados: Map<string, ValidateFunction>;
}

const validadores = new Map<Contrato, Validador>();

function validadorDe(contrato: Contrato): Validador {
  let validador = validadores.get(contrato);
  if (!validador) {
    const documento = parse(readFileSync(CONTRATOS[contrato], 'utf8')) as DocumentoOpenApi;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema({ $id: 'openapi', components: documento.components });
    validador = { documento, ajv, compilados: new Map() };
    validadores.set(contrato, validador);
  }
  return validador;
}

function respuestaDelContrato(
  documento: DocumentoOpenApi,
  ruta: string,
  metodo: string,
  estado: number,
): Referencia {
  const operacion = documento.paths[ruta]?.[metodo.toLowerCase()];
  if (!operacion) throw new Error(`El contrato no define ${metodo.toUpperCase()} ${ruta}`);
  let respuesta = operacion.responses[String(estado)];
  if (!respuesta)
    throw new Error(`El contrato no define la respuesta ${estado} de ${metodo.toUpperCase()} ${ruta}`);
  if (respuesta.$ref) {
    respuesta = (documento.components.responses ?? {})[respuesta.$ref.split('/').pop() as string];
  }
  return respuesta;
}

/**
 * Errores de validación (vacío si cumple) del cuerpo de una respuesta frente al contrato (001 por defecto).
 * Ejemplo: expect(erroresDeContrato('/barberias', 'post', 201, res.body)).toEqual([]).
 */
export function erroresDeContrato(
  ruta: string,
  metodo: string,
  estado: number,
  cuerpo: unknown,
  contrato: Contrato = '001',
): string[] {
  const { documento, ajv, compilados } = validadorDe(contrato);
  const clave = `${metodo} ${ruta} ${estado}`;
  let validar = compilados.get(clave);
  if (!validar) {
    const esquema = respuestaDelContrato(documento, ruta, metodo, estado).content?.['application/json']
      ?.schema;
    if (!esquema) throw new Error(`La respuesta ${clave} no tiene cuerpo JSON en el contrato ${contrato}`);
    // Las referencias internas del contrato se resuelven dentro del documento registrado como "openapi".
    const conReferencias = JSON.parse(
      JSON.stringify(esquema).replace(/"#\/components\//g, '"openapi#/components/'),
    );
    validar = ajv.compile(conReferencias);
    compilados.set(clave, validar);
  }
  return validar(cuerpo)
    ? []
    : (validar.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim());
}

/** Igual que `erroresDeContrato`, contra el contrato de la funcionalidad 002. */
export function erroresDeContrato002(
  ruta: string,
  metodo: string,
  estado: number,
  cuerpo: unknown,
): string[] {
  return erroresDeContrato(ruta, metodo, estado, cuerpo, '002');
}

/** Igual que `erroresDeContrato`, contra el contrato de la funcionalidad 003. */
export function erroresDeContrato003(
  ruta: string,
  metodo: string,
  estado: number,
  cuerpo: unknown,
): string[] {
  return erroresDeContrato(ruta, metodo, estado, cuerpo, '003');
}
