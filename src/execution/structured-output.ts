const schemaKeywords = new Set([
  'type', 'enum', 'const', 'anyOf', 'oneOf', 'allOf', 'not', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minProperties', 'maxProperties', 'title', 'description',
  'default', 'examples', '$id', '$schema',
]);

const maxSchemaDepth = 32;
const maxSchemaNodes = 1_000;

export function unsupportedSchemaKeywords(schema: unknown): string[] {
  return inspectSchema(schema, '$', 0, { nodes: 0 });
}

function inspectSchema(schema: unknown, path: string, depth: number, state: { nodes: number }): string[] {
  state.nodes += 1;
  if (depth > maxSchemaDepth) return [`${path}: schema exceeds maximum depth ${maxSchemaDepth}`];
  if (state.nodes > maxSchemaNodes) return [`${path}: schema exceeds maximum size ${maxSchemaNodes}`];
  if (typeof schema === 'boolean') return [];
  if (!isObject(schema)) return [`${path}: schema must be an object or boolean`];
  const issues: string[] = [];
  for (const key of Object.keys(schema)) if (!schemaKeywords.has(key)) issues.push(`${path}: unsupported keyword '${key}'`);
  const validTypes = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
  if ('type' in schema) {
    const types = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
    if (types.length === 0 || types.some((type) => typeof type !== 'string' || !validTypes.has(type))) issues.push(`${path}.type: invalid JSON Schema type`);
  }
  if ('enum' in schema && (!Array.isArray(schema.enum) || schema.enum.length === 0)) issues.push(`${path}.enum: must be a non-empty array`);
  if ('required' in schema && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))) issues.push(`${path}.required: must be an array of strings`);
  if ('properties' in schema && !isObject(schema.properties)) issues.push(`${path}.properties: must be an object`);
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean' && !isObject(schema.additionalProperties)) issues.push(`${path}.additionalProperties: must be a schema or boolean`);
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) if (keyword in schema && (!Array.isArray(schema[keyword]) || schema[keyword].length === 0)) issues.push(`${path}.${keyword}: must be a non-empty array`);
  for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minProperties', 'maxProperties'] as const) {
    if (keyword in schema && (typeof schema[keyword] !== 'number' || !Number.isFinite(schema[keyword]))) issues.push(`${path}.${keyword}: must be a finite number`);
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) branches.forEach((branch, index) => issues.push(...inspectSchema(branch, `${path}.${keyword}[${index}]`, depth + 1, state)));
  }
  if ('not' in schema) issues.push(...inspectSchema(schema.not, `${path}.not`, depth + 1, state));
  if (isObject(schema.properties)) for (const [key, child] of Object.entries(schema.properties)) issues.push(...inspectSchema(child, `${path}.properties.${key}`, depth + 1, state));
  if (isObject(schema.additionalProperties)) issues.push(...inspectSchema(schema.additionalProperties, `${path}.additionalProperties`, depth + 1, state));
  if ('items' in schema) issues.push(...inspectSchema(schema.items, `${path}.items`, depth + 1, state));
  return issues;
}

export function validateStructuredOutput(output: string, schema: Record<string, unknown>): string[] {
  let value: unknown;
  try { value = JSON.parse(output); } catch { return ['$: output is not valid JSON']; }
  return validateValue(value, schema, '$', { nodes: 0 }).slice(0, 100);
}

function validateValue(value: unknown, schema: unknown, path: string, state: { nodes: number }): string[] {
  state.nodes += 1;
  if (state.nodes > 10_000) return [`${path}: validation complexity limit exceeded`];
  if (schema === true) return [];
  if (schema === false) return [`${path}: value is forbidden by schema`];
  if (!isObject(schema)) return [`${path}: invalid schema`];
  const issues: string[] = [];
  if ('const' in schema && !deepEqual(value, schema.const)) issues.push(`${path}: does not match const`);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) issues.push(`${path}: is not an allowed enum value`);
  const allowedTypes = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  if (allowedTypes.length && !allowedTypes.some((type) => matchesType(value, String(type)))) return [...issues, `${path}: expected ${allowedTypes.join(' or ')}`];
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf) issues.push(...validateValue(value, branch, path, state));
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => validateValue(value, branch, path, state).length === 0)) issues.push(`${path}: does not match anyOf`);
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((branch) => validateValue(value, branch, path, state).length === 0).length !== 1) issues.push(`${path}: does not match exactly one oneOf branch`);
  if ('not' in schema && validateValue(value, schema.not, path, state).length === 0) issues.push(`${path}: matches forbidden schema`);
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) issues.push(`${path}: shorter than minLength`);
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) issues.push(`${path}: longer than maxLength`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push(`${path}: below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push(`${path}: above maximum`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) issues.push(`${path}: not above exclusiveMinimum`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) issues.push(`${path}: not below exclusiveMaximum`);
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0 && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-10) issues.push(`${path}: not a multipleOf value`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push(`${path}: has fewer than minItems`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push(`${path}: has more than maxItems`);
    if (schema.uniqueItems === true && value.some((item, index) => value.slice(0, index).some((prior) => deepEqual(item, prior)))) issues.push(`${path}: items are not unique`);
    if ('items' in schema) {
      for (const [index, item] of value.entries()) {
        issues.push(...validateValue(item, schema.items, `${path}[${index}]`, state));
        if (state.nodes > 10_000) break;
      }
    }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) issues.push(`${path}: has fewer than minProperties`);
    if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) issues.push(`${path}: has more than maxProperties`);
    if (Array.isArray(schema.required)) for (const key of schema.required) if (typeof key === 'string' && !(key in value)) issues.push(`${path}.${key}: is required`);
    for (const [key, child] of Object.entries(value)) {
      if (key in properties) issues.push(...validateValue(child, properties[key], `${path}.${key}`, state));
      else if (schema.additionalProperties === false) issues.push(`${path}.${key}: additional property is not allowed`);
      else if (isObject(schema.additionalProperties)) issues.push(...validateValue(child, schema.additionalProperties, `${path}.${key}`, state));
      if (state.nodes > 10_000) break;
    }
  }
  return issues;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
  }
  return false;
}
