import { packDocument } from './common';
import { diffLines, safeSourceURL } from './document-state';
import { markdownScript } from './markdown';

export const documentHtml = packDocument(`
<div class="row space"><h2>Shared document</h2><button id="snapshot" type="button">Save version</button></div>
<p class="muted">Edits are shared live. Save a version before a major change.</p>
<div class="split"><label>Markdown<textarea id="editor" aria-label="Document Markdown" rows="13" maxlength="6000" placeholder="# A shared beginning"></textarea></label><div><h3>Live preview</h3><article id="preview" class="preview"></article></div></div>
<div class="row"><label class="grow">Saved versions<select id="versions" aria-label="Saved versions"><option value="">Choose a version</option></select></label><button id="restore" type="button" disabled>Restore</button><button id="remove" type="button" disabled>Delete version</button></div>
<div id="diff" class="diff" aria-label="Version changes"></div>`, `
const diffLines=${diffLines.toString()};const safeSourceURL=${safeSourceURL.toString()};
${markdownScript}
const editor=document.getElementById('editor'),preview=document.getElementById('preview'),versions=document.getElementById('versions'),diff=document.getElementById('diff');
let selected='';
const renderDiff=()=>{diff.replaceChildren();const saved=state()['version:'+selected];document.getElementById('restore').disabled=!saved;document.getElementById('remove').disabled=!saved;if(!saved)return;for(const change of diffLines(String(saved.text||''),String(state().markdown||''))){diff.append(el('div',{className:change.type},(change.type==='added'?'+ ':change.type==='removed'?'- ':'  ')+change.text))}};
const render=()=>{const current=state();const text=String(current.markdown||'');if(document.activeElement!==editor)editor.value=text;markdown(preview,text);const saved=records(current,'version').sort((a,b)=>Number(b.at)-Number(a.at));versions.replaceChildren(el('option',{value:''},'Choose a version'));for(const item of saved)versions.append(el('option',{value:item.id},timestamp(item.at)+' · '+String(item.actor).slice(0,18)));versions.value=selected;renderDiff()};
editor.oninput=()=>commit({markdown:editor.value});editor.onblur=()=>{editor.value=String(state().markdown||'')};
document.getElementById('snapshot').onclick=()=>{if(records(state(),'version').length>=6){notice.textContent='Keep up to six saved versions. Delete an older version first.';return}const key=id();if(update('version',key,{text:String(state().markdown||''),at:Date.now(),actor:actor()})){selected=key;render()}};
versions.onchange=()=>{selected=versions.value;renderDiff()};
document.getElementById('restore').onclick=()=>{const saved=state()['version:'+selected];if(saved)commit({markdown:String(saved.text||'')})};
document.getElementById('remove').onclick=()=>{if(selected&&commit({['version:'+selected]:null})){selected='';render()}};
window.addEventListener('present:state',render);render();
`);
