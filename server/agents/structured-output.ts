type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[];
  oneOf?: Schema[]; anyOf?: Schema[]; items?: Schema; [key: string]: unknown };

/** Encode optional arguments as required nullable values for the provider grammar.
 * The original runtime schema still validates every decoded command and target. */
export function strictOutputSchema(schema: object): object {
  const visit = (input: Schema): Schema => {
    const { $schema: _dialect, default: _default, oneOf, anyOf, properties, items, ...rest } = input;
    const output: Schema = { ...rest };
    if (oneOf || anyOf) output.anyOf = (oneOf ?? anyOf ?? []).map(visit);
    if (items) output.items = visit(items);
    if (properties) {
      const required = new Set(input.required ?? []);
      const discriminator = ['kind', 'type', 'shapeType'].find(key => properties[key]?.const !== undefined);
      const entries = Object.entries(properties).sort(([a], [b]) => Number(b === discriminator) - Number(a === discriminator));
      output.properties = Object.fromEntries(entries.map(([key, property]) => [key,
        required.has(key) ? visit(property) : { anyOf: [visit(property), { type: 'null' }] }]));
      output.required = Object.keys(output.properties); output.additionalProperties = false;
    }
    return output;
  };
  return visit(schema as Schema);
}

/** Null means absent only where the source contract explicitly permits omission. */
export function decodeStrictOutput(value: unknown, input: object): unknown {
  const schema = input as Schema;
  let result = value;
  for (const branch of schema.oneOf ?? schema.anyOf ?? []) result = decodeStrictOutput(result, branch);
  const items = schema.items;
  if (Array.isArray(result) && items) return result.map(item => decodeStrictOutput(item, items));
  if (!result || typeof result !== 'object' || Array.isArray(result) || !schema.properties) return result;
  const properties = schema.properties, required = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(result).flatMap(([key, field]) => {
    const property = properties[key];
    if (!property) return [[key, field]];
    if (field === null && !required.has(key)) return [];
    return [[key, decodeStrictOutput(field, property)]];
  }));
}
