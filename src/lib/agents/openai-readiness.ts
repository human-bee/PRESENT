import fs from 'node:fs';

export function openAIReadiness() {
  let networkAllowsOpenAI = true;
  const file = '/etc/codex/network-policy.json';
  if (fs.existsSync(file)) {
    try {
      const policy = JSON.parse(fs.readFileSync(file, 'utf8')).http_network_policy;
      networkAllowsOpenAI = policy?.type !== 'restricted' || policy.egress_rules?.some((rule: { host?: string }) => rule.host === 'api.openai.com');
    } catch { networkAllowsOpenAI = false; }
  }
  return { credentialConfigured: Boolean(process.env.OPENAI_API_KEY), networkAllowsOpenAI: Boolean(networkAllowsOpenAI) };
}
