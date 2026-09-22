import { ModelPicker } from './model-picker';
import type { AgentProvider, GenerationOptions } from '../shared/agent-models';
import type { RoomState } from '../shared/room';
import { useRef, useState } from 'react';
import type { Editor } from 'tldraw';
import { Icon } from './icons';
import { downloadTldrawFile, importTldrawFile } from './tldraw/file-io';

export function Settings({ editor, onError, name, setName, provider, setProvider, generationOptions, setGenerationOptions, webmcp, capabilities, room, close }: {
  editor: Editor | null; onError: (message: string) => void;
  name: string; setName: (s: string) => void; provider: AgentProvider; setProvider: (s: AgentProvider) => void;
  generationOptions: GenerationOptions; setGenerationOptions: (s: GenerationOptions) => void;
  webmcp: boolean; capabilities: Record<string, unknown>; room: RoomState; close: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null); const [fileBusy, setFileBusy] = useState(false);
  async function download() {
    if (!editor || fileBusy) return; setFileBusy(true);
    try { await downloadTldrawFile(editor, room.title); }
    catch (error) { onError(error instanceof Error ? error.message : 'This room could not be exported.'); }
    finally { setFileBusy(false); }
  }
  async function importFile(file?: File) {
    if (!editor || !file || fileBusy) return; setFileBusy(true);
    try { await importTldrawFile(editor, file, room.id); close(); }
    catch (error) { onError(error instanceof Error ? error.message : 'This canvas could not be imported.'); }
    finally { setFileBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  return <aside className="popover settings-panel overlay" aria-label="Room settings"><div className="popover-heading"><span className="popover-label">MAKE YOURSELF AT HOME</span><button type="button" aria-label="Close settings" onClick={close}><Icon name="close" size={16}/></button></div>
    <h2>The room is yours.</h2><label>Your name<input value={name} onChange={event => setName(event.target.value.slice(0, 40))} placeholder="How should we call you?" maxLength={40}/></label>
    <ModelPicker provider={provider} setProvider={setProvider} options={generationOptions} setOptions={setGenerationOptions} capabilities={capabilities}/>
    <p className="settings-note">Your agent creates working, shared tools for whatever you’re doing. Select something to change it.</p>
    <div className="connection-detail"><span className={`status-dot ${webmcp ? 'on' : ''}`}/><span>{webmcp ? 'Your browser agent can see this room' : 'Browser agent tools unavailable in this browser'}</span></div>
    <div className="settings-actions"><button type="button" disabled={!editor || fileBusy} onClick={download}><Icon name="download" size={16}/> Save this room</button><button type="button" disabled={!editor || fileBusy} onClick={() => fileInput.current?.click()}><Icon name="plus" size={16}/> Import a canvas</button><button type="button" onClick={() => location.assign('/')}><Icon name="plus" size={16}/> A fresh room</button></div>
    <input ref={fileInput} type="file" accept=".tldr,application/vnd.tldraw+json" aria-label="Import a .tldr file" hidden style={{ display: 'none' }} onChange={event => void importFile(event.target.files?.[0])}/>
    <small className="settings-footnote">Camera and microphone are yours to switch on. Room links give access to everyone holding them. This room is running on your computer.</small>
    <span className="sr-only">Agent status {JSON.stringify(capabilities)}</span>
  </aside>;
}
