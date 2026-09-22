import { createWidgetStateView } from './pending-widget-state';

export type WidgetState = Record<string, unknown>;
export const MAX_STATE_BYTES = 48_000;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** State crosses a trust boundary, so accept only small, plain JSON trees. */
export function isWidgetState(value: unknown): value is WidgetState {
  const seen = new WeakSet<object>();
  const valid = (item: unknown, depth: number): boolean => {
    if (depth > 10) return false;
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return false;
    return Object.entries(item).every(([key, child]) => !forbiddenKeys.has(key) && valid(child, depth + 1));
  };
  if (!value || Array.isArray(value) || typeof value !== 'object' || !valid(value, 0)) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_STATE_BYTES; }
  catch { return false; }
}

export function readWidgetPatch(event: Pick<MessageEvent, 'source' | 'data'>, source: MessageEventSource | null, channel: string): WidgetState | null {
  if (!source || event.source !== source || !event.data || event.data.channel !== channel || event.data.type !== 'present:patch') return null;
  return isWidgetState(event.data.patch) ? event.data.patch : null;
}

export function readWidgetIncrement(event: Pick<MessageEvent, 'source' | 'data'>, source: MessageEventSource | null, channel: string): { key: string; by: number } | null {
  if (!source || event.source !== source || event.data?.channel !== channel || event.data.type !== 'present:increment') return null;
  const { key, by } = event.data;
  return typeof key === 'string' && key.length > 0 && key.length <= 200 && !forbiddenKeys.has(key) && typeof by === 'number' && Number.isFinite(by) ? { key, by } : null;
}

export function readWidgetLink(event: Pick<MessageEvent, 'source' | 'data'>, source: MessageEventSource | null, channel: string): string | null {
  if (!source || event.source !== source || event.data?.channel !== channel || event.data.type !== 'present:link' || typeof event.data.url !== 'string' || event.data.url.length > 2048) return null;
  try {
    const url = new URL(event.data.url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function readWidgetRequestId(event: Pick<MessageEvent, 'source' | 'data'>, source: MessageEventSource | null, channel: string): string | null {
  if (!source || event.source !== source || event.data?.channel !== channel) return null;
  const id = event.data?.requestId;
  return typeof id === 'string' && id.length <= 100 && id.startsWith(`${channel}:`) && /^[1-9]\d*$/.test(id.slice(channel.length + 1)) ? id : null;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

export function buildSandboxDocument(html: string, channel: string, state: WidgetState, participantId = ''): string {
  const initialState = isWidgetState(state) ? state : {};
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{color-scheme:light}html,body{margin:0;min-height:100%;background:#fffef9;color:#28342a;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}*{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #7a9761;outline-offset:3px}</style>
<script>(()=>{
const __name=(fn)=>fn;
const channel=${scriptJson(channel)};const view=(${createWidgetStateView.toString()})(${scriptJson(initialState)});let state=view.read();let sequence=0;
const emit=()=>window.dispatchEvent(new CustomEvent('present:state',{detail:structuredClone(state)}));
const safe=(value)=>{try{const text=JSON.stringify(value);return text.length<=48000&&value&&typeof value==='object'&&!Array.isArray(value)&&!/("(?:__proto__|prototype|constructor)"\\s*:)/.test(text)}catch{return false}};
window.present=Object.freeze({participantId:${scriptJson(participantId)},getState:()=>structuredClone(state),setState:patch=>{
if(!safe(patch))return;patch=JSON.parse(JSON.stringify(patch));if(!safe({...state,...patch}))return;
const requestId=channel+':'+(++sequence);state=view.add({requestId,patch});parent.postMessage({type:'present:patch',channel,requestId,patch},'*');emit();
},increment:(key,by=1)=>{
if(typeof key!=='string'||!key.length||key.length>200||['__proto__','prototype','constructor'].includes(key)||typeof by!=='number'||!Number.isFinite(by))return;
const current=Object.hasOwn(state,key)?state[key]:0;if(typeof current!=='number'||!Number.isFinite(current+by))return;
const requestId=channel+':'+(++sequence);state=view.add({requestId,key,by});parent.postMessage({type:'present:increment',channel,requestId,key,by},'*');emit();
},contribute:text=>{if(!navigator.userActivation?.isActive||typeof text!=='string'||!text.trim()||text.length>1200)return;const requestId=channel+':'+(++sequence);parent.postMessage({type:'present:contribute',channel,requestId,text},'*')
},openLink:url=>{if(typeof url==='string'&&url.length<=2048)parent.postMessage({type:'present:link',channel,url},'*')}});
window.addEventListener('message',event=>{
if(event.source!==parent||event.data?.channel!==channel)return;
if(event.data.type==='present:contribution-result'){window.dispatchEvent(new CustomEvent('present:contribution-result',{detail:{ok:event.data.ok===true,error:String(event.data.error||'')}}));return}
if(event.data.type==='present:rejected'&&typeof event.data.requestId==='string'){state=view.reject(event.data.requestId);emit();return}
if(event.data.type!=='present:state'||!safe(event.data.state)||!Array.isArray(event.data.receipts))return;
state=view.receive(event.data.state,event.data.receipts);emit();
const receipts=event.data.receipts.filter(id=>typeof id==='string'&&id.length<=100).slice(-500);
requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({type:'present:rendered',channel,receipts},'*')))});
document.addEventListener('click',event=>{const link=event.target.closest?.('a[href],area[href]');if(link){event.preventDefault();if(event.isTrusted)window.present.openLink(link.getAttribute('href'))}},true);
document.addEventListener('submit',event=>event.preventDefault(),true);
parent.postMessage({type:'present:ready',channel},'*');
})();</script></head><body>${html}</body></html>`;
}
