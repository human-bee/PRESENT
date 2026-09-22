/** Bind model references to the scene IDs actually present in this room. */
export function bindSceneIds(schema: object, ids: string[]): object {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key !== 'sceneId') return [key, visit(child)];
      const encoded = JSON.stringify(child), nullable = encoded.includes('"null"');
      return [key, nullable ? { anyOf: [{ type: 'string', enum: ids.length ? ids : ['unavailable'] }, { type: 'null' }] } : { type: 'string', enum: ids.length ? ids : ['unavailable'] }];
    }));
  };
  return visit(schema) as object;
}
