import type { LoadPhase, LinearTeam, LinearProject, LinearStatus, LinearIssue } from './types';

export function humanizeLoadStep(step: LoadPhase): string {
  switch (step) {
    case 'idle':
      return 'Idle';
    case 'starting':
      return 'Starting';
    case 'fetchingTeams':
      return 'Fetching Teams';
    case 'fetchingIssues':
      return 'Fetching Issues';
    case 'normalizing':
      return 'Normalizing Data';
    case 'hydrating':
      return 'Hydrating UI';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Unknown Step';
  }
}

export function normalizeTeams(payload: unknown): LinearTeam[] {
  if (Array.isArray(payload)) {
    return payload.map((t) => {
      const item = t as Record<string, unknown>;
      return { id: item.id as string, name: item.name as string, key: item.key as string | undefined };
    });
  }
  const p = payload as Record<string, unknown>;
  const list = (p?.teams || p?.data || []) as unknown[];
  return list.map((t) => {
    const item = t as Record<string, unknown>;
    return { id: item.id as string, name: item.name as string, key: item.key as string | undefined };
  });
}

export function normalizeProjects(payload: unknown): LinearProject[] {
  const p = payload as Record<string, unknown>;
  const list = (Array.isArray(payload) ? payload : p?.projects || []) as unknown[];
  return list.map((item) => {
    const proj = item as Record<string, unknown>;
    return { id: proj.id as string, name: proj.name as string, teamId: (proj.team as Record<string, unknown>)?.id as string | undefined };
  });
}

export function normalizeStatuses(payload: unknown): LinearStatus[] {
  const p = payload as Record<string, unknown>;
  if (p?.error || p?.isError) {
    return [];
  }

  let list: unknown[] = [];

  if (Array.isArray(payload)) {
    list = payload;
  } else if (p?.states) {
    list = p.states as unknown[];
  } else if (p?.workflowStates) {
    list = p.workflowStates as unknown[];
  } else if (p?.nodes) {
    list = p.nodes as unknown[];
  } else if (p?.content) {
    try {
      const content = p.content as Array<{ type: string; text?: string }>;
      const textContent = content.find((c) => c.type === 'text');
      if (textContent?.text) {
        const parsed = JSON.parse(textContent.text);
        if (Array.isArray(parsed)) {
          list = parsed;
        } else if (parsed?.nodes || parsed?.states || parsed?.workflowStates) {
          list = parsed.nodes || parsed.states || parsed.workflowStates;
        }
      }
    } catch {
      // Failed to parse content
    }
  } else if (typeof payload === 'object' && payload !== null) {
    const possibleArrays = Object.values(payload).filter(v => Array.isArray(v));
    if (possibleArrays.length === 1) {
      list = possibleArrays[0] as unknown[];
    }
  }

  return list
    .map((item) => {
      const s = item as Record<string, unknown>;
      return { id: s.id as string, name: s.name as string, type: s.type as string | undefined, color: s.color as string | undefined };
    })
    .filter(s => s.id && s.name);
}

export function isRateLimitError(payload: unknown): boolean {
  const errorStrings = [
    'rate limit exceeded',
    'Rate limit exceeded',
    '1500 requests',
    'too many requests',
  ];
  const str = JSON.stringify(payload).toLowerCase();
  return errorStrings.some((e) => str.includes(e.toLowerCase()));
}

export function normalizeIssues(
  payload: unknown,
  statuses: LinearStatus[],
  stateUuidMapping?: Map<string, string>
): LinearIssue[] | 'RATE_LIMITED' {
  if (isRateLimitError(payload)) {
    return 'RATE_LIMITED';
  }

  const p = payload as Record<string, unknown>;
  if (p?.error || p?.isError) {
    return [];
  }

  let list: unknown[] = [];

  if (Array.isArray(payload)) {
    list = payload;
  } else if (p?.issues) {
    list = p.issues as unknown[];
  } else if (p?.nodes) {
    list = p.nodes as unknown[];
  } else if (p?.content) {
    try {
      const content = p.content as Array<{ type: string; text?: string }>;
      const textContent = content.find((c) => c.type === 'text');
      if (textContent?.text) {
        const parsed = JSON.parse(textContent.text);
        if (Array.isArray(parsed)) {
          list = parsed;
        } else if (parsed?.issues || parsed?.nodes) {
          list = parsed.issues || parsed.nodes;
        }
      }
    } catch {
      // Failed to parse content
    }
  }

  return list.map((item) => {
    const i = item as Record<string, unknown>;
    const rawStatus = i.state || i.status;
    let statusName = 'Unknown';
    let statusId: string | undefined = undefined;

    if (i.stateId && typeof i.stateId === 'string' && (i.stateId as string).includes('-')) {
      statusId = i.stateId as string;
      statusName = (i.status as string) || (i.state as Record<string, unknown>)?.name as string || 'Unknown';
    } else if (typeof rawStatus === 'string') {
      statusName = rawStatus;
      if (stateUuidMapping?.has(rawStatus)) {
        statusId = stateUuidMapping.get(rawStatus);
      } else {
        const matchingStatus = statuses.find(s => s.name === rawStatus);
        statusId = matchingStatus?.id || rawStatus;
      }
    } else if (typeof rawStatus === 'object' && rawStatus !== null) {
      const rs = rawStatus as Record<string, unknown>;
      statusName = (rs.name as string) || (i.statusName as string) || 'Unknown';
      statusId = rs.id as string;
      if (statusId && statusId.includes('-') && stateUuidMapping && statusName !== 'Unknown') {
        stateUuidMapping.set(statusName, statusId);
      }
    }

    const priority = i.priority;
    const labels = (i.labels || []) as Array<unknown>;

    return {
      id: i.id as string,
      identifier: i.identifier as string,
      title: i.title as string,
      status: statusName,
      statusId: statusId,
      updatedAt: i.updatedAt as string,
      priority: typeof priority === 'number' ? { value: priority, name: `P${priority}` } : priority as { value: number; name: string } | undefined,
      labels: labels.map((l) => typeof l === 'string' ? l : (l as Record<string, unknown>).name as string),
      project: (i.project as Record<string, unknown>)?.name as string | undefined,
      assignee: (i.assignee as Record<string, unknown>)?.name as string | undefined,
    };
  });
}


