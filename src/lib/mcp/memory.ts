export type MemoryEnvelope = {
  id: string;
  title: string;
  content: string;
  summary: string;
  highlights: string[];
  decisions: string[];
  actionItems: Array<{ task: string; owner?: string; due?: string }>;
  tags: string[];
  sourceDocumentId?: string;
  contextProfile?: string;
  contextKey?: string;
  messageId?: string;
  lastUpdated?: number;
};

export type MemoryTarget = {
  collection?: string;
  index?: string;
  namespace?: string;
};

const normalizeToolName = (toolName: string) => {
  const trimmed = toolName.trim().toLowerCase();
  const withoutPrefix = trimmed.startsWith('mcp_') ? trimmed.slice(4) : trimmed;
  return withoutPrefix.split('_').join('-');
};

export function buildMemoryPayload(
  toolName: string,
  envelope: MemoryEnvelope,
  target: MemoryTarget = {},
): Record<string, unknown> {
  const normalized = normalizeToolName(toolName);
  const baseMetadata = {
    title: envelope.title,
    tags: envelope.tags,
    highlights: envelope.highlights,
    decisions: envelope.decisions,
    actionItems: envelope.actionItems,
    sourceDocumentId: envelope.sourceDocumentId,
    contextProfile: envelope.contextProfile,
    contextKey: envelope.contextKey,
    messageId: envelope.messageId,
    lastUpdated: envelope.lastUpdated,
  };
  const text = envelope.content || envelope.summary;

  if (normalized === 'qdrant-store') {
    return {
      information: text,
      metadata: baseMetadata,
      ...(target.collection ? { collection_name: target.collection } : {}),
    };
  }

  if (normalized === 'upsert-records' || normalized === 'pinecone-upsert-records') {
    const record = {
      id: envelope.id,
      text,
      metadata: baseMetadata,
    };
    return {
      records: [record],
      ...(target.index ? { index: target.index } : {}),
      ...(target.namespace ? { namespace: target.namespace } : {}),
    };
  }

  return {
    ...baseMetadata,
    title: envelope.title,
    summary: envelope.summary,
    content: envelope.content,
  };
}

export function buildMemoryQueryPayload(
  toolName: string,
  query: string,
  target: MemoryTarget = {},
): Record<string, unknown> {
  const normalized = normalizeToolName(toolName);
  const trimmedQuery = query.trim();

  if (normalized === 'qdrant-find') {
    return {
      query: trimmedQuery,
      ...(target.collection ? { collection_name: target.collection } : {}),
    };
  }

  if (normalized === 'search-records' || normalized === 'pinecone-search-records') {
    return {
      query: trimmedQuery,
      ...(target.index ? { index: target.index } : {}),
      ...(target.namespace ? { namespace: target.namespace } : {}),
    };
  }

  return {
    query: trimmedQuery,
    ...(target.collection ? { collection: target.collection } : {}),
    ...(target.index ? { index: target.index } : {}),
    ...(target.namespace ? { namespace: target.namespace } : {}),
  };
}
