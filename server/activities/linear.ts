import type { MemberProfile } from '../../shared/meeting';
import { AgentError } from '../agents/contract';

export async function fetchLinearProfile(actor: string, userId: string, signal: AbortSignal): Promise<MemberProfile> {
  const token = process.env.LINEAR_API_KEY;
  if (!token)
    throw new AgentError(
      'Linear is not connected on this server. Add a read-only Linear key in server settings, then retry.',
      503,
    );
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      query:
        (userId === 'viewer' ? 'query { user: viewer' : 'query Member($id: String!) { user(id: $id)') +
        ' { id name url avatarUrl teams(first: 8) { nodes { name } } assignedIssues(first: 20) { nodes { title url project { name } labels(first: 8) { nodes { name } } } } } }',
      variables: userId === 'viewer' ? {} : { id: userId },
    }),
  });
  if (!response.ok) throw new AgentError('Linear could not be read. Check access for this account.', 502);
  const raw = await response.json();
  if (raw.errors?.length || !raw.data?.user)
    throw new AgentError(
      'This member is not visible to the connected Linear account. Ask the workspace administrator to review membership.',
      403,
    );
  const user = raw.data.user as {
    id: string;
    name: string;
    url: string;
    avatarUrl?: string;
    teams: { nodes: { name: string }[] };
    assignedIssues: {
      nodes: {
        title: string;
        project?: { name: string };
        labels: { nodes: { name: string }[] };
      }[];
    };
  };
  return {
    actor,
    avatarUrl: user.avatarUrl ?? '',
    personalStrengths: [],
    about: '',
    name: user.name.slice(0, 80),
    team: user.teams.nodes
      .map((t) => t.name)
      .join(', ')
      .slice(0, 160),
    projects: [
      ...new Set(user.assignedIssues.nodes.flatMap((i) => (i.project ? [i.project.name.slice(0, 160)] : []))),
    ].slice(0, 8),
    strengths: [
      ...new Set(user.assignedIssues.nodes.flatMap((i) => i.labels.nodes.map((l) => l.name.slice(0, 160)))),
    ].slice(0, 8),
    source: 'linear',
    sourceUrl: user.url,
    fetchedAt: Date.now(),
    linearId: user.id,
    status: 'ready',
    error: null,
  };
}
