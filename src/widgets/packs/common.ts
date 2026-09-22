export type PackState = Record<string, unknown>;

/** The saved object also contains its HTML; leave space under the room object limit. */
export const PACK_STATE_BYTES = 16_000;

export function recordPatch(state: PackState, prefix: string, id: string, changes: Record<string, unknown>): PackState {
  if (!/^[a-z]+$/.test(prefix) || !/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid record identity.');
  const key = `${prefix}:${id}`;
  const old = state[key];
  const record = old && typeof old === 'object' && !Array.isArray(old) ? old : {};
  return { [key]: { ...record, ...changes, id } };
}

export function records(state: PackState, prefix: string): Array<Record<string, unknown> & { id: string }> {
  return Object.entries(state).flatMap(([key, value]) => {
    if (!key.startsWith(`${prefix}:`) || !value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string' && key === `${prefix}:${record.id}` ? [record as Record<string, unknown> & { id: string }] : [];
  });
}

export const packStyle = `<style>
body{padding:18px;height:100vh;overflow:auto}h1,h2,h3,p{margin:0}h2{font-size:18px}h3{font-size:13px}p{line-height:1.5}.muted,small{color:#697266;font-size:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.stack{display:grid;gap:12px}.space{justify-content:space-between}.panel{border:1px solid #dfe4d9;border-radius:10px;padding:12px;background:#fff}.primary{background:#344e3b;color:white;border-color:#344e3b}button{border:1px solid #d7ded1;background:#f4f6ee;border-radius:7px;padding:7px 10px;font-size:12px;color:inherit}button:disabled{opacity:.5;cursor:default}input,textarea,select{border:1px solid #d7ded1;border-radius:6px;background:white;color:inherit;padding:7px;min-width:0}input,textarea{width:100%}textarea{resize:vertical;line-height:1.5}label{display:grid;gap:4px;font-size:12px}form{margin:0}.grow{flex:1;min-width:80px}.danger{color:#9c4135}.badge{border-radius:20px;padding:3px 7px;background:#edf0e6;font-size:11px}.empty{border:1px dashed #d7ded1;padding:18px;border-radius:8px;color:#697266;font-size:13px}.notice{color:#9c4135;font-size:12px;min-height:16px}.source{color:#42694d;overflow-wrap:anywhere}.preview{white-space:normal;overflow-wrap:anywhere;font-size:13px;line-height:1.6}.preview p{margin:0 0 8px}.preview h1,.preview h2,.preview h3{margin:12px 0 6px}.preview pre{white-space:pre-wrap;background:#f4f6ee;padding:8px;border-radius:5px}.preview blockquote{border-left:3px solid #b0be9f;margin:8px 0;padding-left:10px}.preview ul,.preview ol{padding-left:20px;margin:6px 0}.preview .inline-link{color:#42694d;border:0;background:transparent;padding:0;font:inherit;text-decoration:underline}.preview code{background:#f0f2e9;padding:1px 3px}.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.task{display:grid;gap:8px;margin-top:8px}.cards{display:flex;gap:8px;flex-wrap:wrap}.card{width:62px;min-height:88px;border:1px solid #d0d8c8;background:#fff;border-radius:8px;padding:8px;display:grid;align-content:space-between}.red{color:#af4b3b}.card.back{background:#e6ebdb}.claim{display:grid;gap:10px}details summary{cursor:pointer;font-size:12px;color:#42694d}details[open] summary{margin-bottom:10px}output{font-size:36px;font-weight:600}.diff{white-space:pre-wrap;font:12px ui-monospace,monospace;max-height:160px;overflow:auto}.added{background:#e4efdf}.removed{background:#f9e4df;text-decoration:line-through}.split{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:430px){.cols,.split{grid-template-columns:1fr}}
</style>`;

export const commonScript = `
const __name=(fn)=>fn;
const present=window.present;
const records=${records.toString()};
const recordPatch=${recordPatch.toString()};
const root=document.getElementById('pack');
const notice=document.getElementById('notice');
const el=(tag,attrs={},text)=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else if(key==='className')node.className=value;else node.setAttribute(key,String(value))}if(text!==undefined)node.textContent=String(text);return node};
const button=(text,action,style='')=>el('button',{type:'button',onclick:action,className:style},text);
const field=(text,node)=>{const label=el('label',{},text);label.append(node);return label};
const row=(...nodes)=>{const line=el('div',{className:'row'});line.append(...nodes);return line};
const state=()=>present.getState();
const id=()=>crypto.randomUUID();
const actor=()=>present.participantId||'Participant';
const commit=(patch)=>{const next={...state(),...patch};if(new TextEncoder().encode(JSON.stringify(next)).length>${PACK_STATE_BYTES}){notice.textContent='This change was not saved: storage is full. Remove an old entry or shorten the text.';return false}notice.textContent='';present.setState(patch);return true};
const update=(prefix,key,changes)=>commit(recordPatch(state(),prefix,key,changes));
const textInput=(value,label,max=200)=>{const input=el('input',{'aria-label':label,maxlength:max});input.value=typeof value==='string'?value:'';return input};
const choice=(values,value,label,onchange)=>{const input=el('select',{'aria-label':label});for(const item of values)input.append(el('option',{value:item},item));input.value=value;input.onchange=()=>onchange(input.value);return input};
const empty=(text)=>el('p',{className:'empty'},text);
const timestamp=(value)=>new Date(Number(value)||0).toLocaleString();
const rememberFocus=(container)=>{const input=document.activeElement;return container.contains(input)&&input.dataset.editKey?{key:input.dataset.editKey,start:input.selectionStart,end:input.selectionEnd}:null};
const restoreFocus=(container,focus)=>{if(!focus)return;const input=Array.from(container.querySelectorAll('[data-edit-key]')).find(node=>node.dataset.editKey===focus.key);if(input){input.focus({preventScroll:true});if(typeof focus.start==='number')input.setSelectionRange(focus.start,focus.end)}};
`;

export function packDocument(content: string, script: string): string {
  return `${packStyle}<main id="pack" class="stack">${content}</main><p id="notice" class="notice" role="status"></p><script>(()=>{${commonScript}${script}})()</script>`;
}
