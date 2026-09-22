import { agentNames, type AgentProvider, type GenerationOptions, type ProviderAvailability } from '../shared/agent-models';
export function ModelPicker({ provider, setProvider, options, setOptions, capabilities }: {
  provider: AgentProvider; setProvider: (value: AgentProvider) => void;
  options: GenerationOptions; setOptions: (value: GenerationOptions) => void; capabilities: Record<string, unknown>;
}) {
  const providers = (capabilities.providers ?? []) as ProviderAvailability[];
  const selected = providers.find(p => p.id === provider);
  const available = selected?.reasoning ?? ['low'];
  const change = (value: AgentProvider) => {
    const next = providers.find(p => p.id === value);
    setProvider(value); setOptions({ ...options, reasoning: next?.reasoning.includes(options.reasoning ?? 'low') ? options.reasoning : 'low', fast: !!next?.fast && !!options.fast });
  };
  return <>
    <label>Who’s making things?<select value={provider} onChange={event => change(event.target.value as AgentProvider)}>
      {(['luna', 'terra', 'codex', 'cerebras', 'spark'] as AgentProvider[]).map(id => {
        const item = providers.find(p => p.id === id);
        return <option key={id} value={id} disabled={!item?.configured}>{agentNames[id]}{id === 'luna' ? ' · quick ideas' : id === 'terra' ? ' · balanced' : ''}{item && !item.configured ? ' · unavailable' : ''}</option>;
      })}
    </select></label>
    <label>Reasoning<select aria-label="Reasoning level" value={options.reasoning ?? 'low'} onChange={event => setOptions({ ...options, reasoning: event.target.value as GenerationOptions['reasoning'] })}>
      {available.map(effort => <option key={effort} value={effort}>{effort}</option>)}
    </select></label>
    <label className="model-fast"><input type="checkbox" checked={!!options.fast} disabled={!selected?.fast} onChange={event => setOptions({ ...options, fast: event.target.checked })}/> Fast</label>
    <label className="model-fast"><input type="checkbox" checked={options.decisions !== 'off'} onChange={event => setOptions({ ...options, decisions: event.target.checked ? 'jev' : 'off' })}/> Jev for quick decisions</label>
    <p className="settings-note">{selected?.fast ? selected.fastDescription ?? 'Priority speed uses more of your Codex allowance.' : provider === 'cerebras' ? 'Cerebras speed is built in; there is no separate Fast tier.' : selected?.reason ?? 'Checking model availability…'}</p>
  </>;
}
