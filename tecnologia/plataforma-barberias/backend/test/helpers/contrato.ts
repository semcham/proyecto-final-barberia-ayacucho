import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

// Validación de respuestas HTTP contra specs/001-registro-acceso-barberia/contracts/openapi.yaml.

const RUTA_CONTRATO = join(
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
);

interface Referencia {
  $ref?: string;
  content?: Record<string, { schema: object }>;
}

interface DocumentoOpenApi {
  paths: Record<string, Record<string, { responses: Record<string, Referencia> }>>;
  components: { responses: Record<string, Referencia>; schemas: Record<string, object> };
}

const documento = parse(readFileSync(RUTA_CONTRATO, 'utf8')) as DocumentoOpenApi;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: documento.components });

const validadores = new Map<string, ValidateFunction>();

function respuestaDelContrato(ruta: string, metodo: string, estado: number): Referencia {
  const operacion = documento.paths[ruta]?.[metodo.toLowerCase()];
  if (!operacion) throw new Error(`El contrato no define ${metodo.toUpperCase()} ${ruta}`);
  let respuesta = operacion.responses[String(estado)];
  if (!respuesta)
    throw new Error(`El contrato no define la respuesta ${estado} de ${metodo.toUpperCase()} ${ruta}`);
  if (respuesta.$ref) {
    respuesta = documento.components.responses[respuesta.$ref.split('/').pop() as string];
  }
  return respuesta;
}

/**
 * Errores de validación (vacío si cumple) del cuerpo de una respuesta frente al contrato.
 * Ejemplo: expect(erroresDeContrato('/barberias', 'post', 201, res.body)).toEqual([]).
 */
export function erroresDeContrato(ruta: string, metodo: string, estado: number, cuerpo: unknown): string[] {
  const clave = `${metodo} ${ruta} ${estado}`;
  let validar = validadores.get(clave);
  if (!validar) {
    const esquema = respuestaDelContrato(ruta, metodo, estado).content?.['application/json']?.schema;
    if (!esquema) throw new Error(`La respuesta ${clave} no tiene cuerpo JSON en el contrato`);
    // Las referencias internas del contrato se resuelven dentro del documento registrado como "openapi".
    const conReferencias = JSON.parse(
      JSON.stringify(esquema).replace(/"#\/components\//g, '"openapi#/components/'),
    );
    validar = ajv.compile(conReferencias);
    validadores.set(clave, validar);
  }
  return validar(cuerpo)
    ? []
    : (validar.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim());
}
