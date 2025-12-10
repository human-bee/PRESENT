export async function fetchWorkflowStatesViaGraphQL(
  apiKey: string,
  teamId: string
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey, // Linear GraphQL API uses key directly, not Bearer
      },
      body: JSON.stringify({
        query: `
          query WorkflowStates($teamId: String!) {
            team(id: $teamId) {
              states {
                nodes {
                  id
                  name
                  type
                }
              }
            }
          }
        `,
        variables: { teamId },
      }),
    });

    if (!response.ok) {
      console.warn('[LinearKanban] GraphQL API error:', response.status, response.statusText);
      return mapping;
    }

    const data = await response.json();
    const states = data?.data?.team?.states?.nodes || [];

    for (const state of states) {
      if (state.id && state.name) {
        mapping.set(state.name, state.id);
      }
    }
  } catch (error) {
    console.warn('[LinearKanban] Failed to fetch workflow states via GraphQL:', error);
  }

  return mapping;
}

export async function updateIssueViaGraphQL(
  apiKey: string,
  issueId: string,
  stateId: string
): Promise<{ success: boolean; error?: string; issue?: unknown }> {
  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({
        query: `
          mutation UpdateIssue($issueId: String!, $stateId: String!) {
            issueUpdate(id: $issueId, input: { stateId: $stateId }) {
              success
              issue {
                id
                identifier
                title
                state {
                  id
                  name
                  type
                }
              }
            }
          }
        `,
        variables: { issueId, stateId },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[LinearKanban] GraphQL update error:', response.status, errorText);
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();

    if (data.errors) {
      console.error('[LinearKanban] GraphQL mutation errors:', data.errors);
      return { success: false, error: data.errors[0]?.message || 'GraphQL error' };
    }

    const result = data?.data?.issueUpdate;

    if (result?.success) {
      return {
        success: true,
        issue: result.issue,
      };
    } else {
      return { success: false, error: 'Update returned success: false' };
    }
  } catch (error) {
    console.error('[LinearKanban] GraphQL update exception:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}







