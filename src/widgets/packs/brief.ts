import { packDocument } from './common';
import { briefActionMetaPatch } from './brief-state';

export const briefHtml = packDocument(`
<div><h2>Meeting brief</h2><p class="muted">Keep what mattered, what was decided and who takes the next step.</p></div>
<label>Summary<textarea id="brief-summary" aria-label="Meeting summary" rows="4" maxlength="4000" placeholder="What brought us together, and where did we land?"></textarea></label>
<section class="stack"><h3>Decisions</h3><div class="row"><input id="new-decision" class="grow" aria-label="New decision" maxlength="500" placeholder="What did we decide?"><button id="add-decision" type="button">Add decision</button></div><div id="decisions" class="stack" aria-label="Meeting decisions"></div></section>
<section class="stack"><h3>Actions</h3><div class="row"><input id="new-action" class="grow" aria-label="New action" maxlength="300" placeholder="What happens next?"><input id="new-action-owner" class="grow" aria-label="New action owner" maxlength="80" placeholder="Owner"><button id="add-action" type="button" class="primary">Add action</button></div><div id="actions" class="stack" aria-label="Meeting actions"></div></section>`, `
const briefActionMetaPatch=${briefActionMetaPatch.toString()};
const summary=document.getElementById('brief-summary'),decisions=document.getElementById('decisions'),actions=document.getElementById('actions');
const statuses=['To do','Doing','Done'];
const render=()=>{
  const current=state(),decisionFocus=rememberFocus(decisions),actionFocus=rememberFocus(actions);
  if(document.activeElement!==summary)summary.value=typeof current.summary==='string'?current.summary:'';
  decisions.replaceChildren();actions.replaceChildren();
  for(const decision of records(current,'decision').sort((a,b)=>Number(a.at)-Number(b.at))){
    const panel=el('div',{className:'panel stack','data-decision-id':decision.id}),text=el('textarea',{'aria-label':'Decision text',rows:2,maxlength:500});
    text.value=String(decision.text||'');text.dataset.editKey=decision.id+':text';text.oninput=()=>update('decision',decision.id,{text:text.value});
    panel.append(text,button('Delete decision',()=>commit({['decision:'+decision.id]:null}),'danger'));decisions.append(panel);
  }
  for(const action of records(current,'action').sort((a,b)=>Number(a.at)-Number(b.at))){
    const panel=el('article',{className:'panel stack','data-action-id':action.id}),text=textInput(action.text,'Action text',300),owner=textInput(current['owner:'+action.id],'Action owner',80);
    const status=statuses.includes(current['status:'+action.id])?current['status:'+action.id]:'To do';
    text.dataset.editKey=action.id+':text';owner.dataset.editKey=action.id+':owner';
    text.oninput=()=>update('action',action.id,{text:text.value});owner.oninput=()=>commit(briefActionMetaPatch(action.id,'owner',owner.value));
    panel.append(field('Action',text),row(field('Owner',owner),choice(statuses,status,'Action status',value=>commit(briefActionMetaPatch(action.id,'status',value))),button('Delete action',()=>commit({['action:'+action.id]:null,['owner:'+action.id]:null,['status:'+action.id]:null}),'danger')));actions.append(panel);
  }
  if(!decisions.children.length)decisions.append(empty('Capture a decision when the room reaches one.'));
  if(!actions.children.length)actions.append(empty('Add the next step and give it an owner.'));
  restoreFocus(decisions,decisionFocus);restoreFocus(actions,actionFocus);
};
summary.oninput=()=>commit({summary:summary.value});summary.onblur=()=>{summary.value=String(state().summary||'')};
const addDecision=()=>{
  const input=document.getElementById('new-decision');if(!input.value.trim())return;
  if(records(state(),'decision').length>=30){notice.textContent='Keep up to 30 decisions in this brief.';return}
  if(update('decision',id(),{text:input.value.trim(),at:Date.now(),createdBy:actor()})){input.value='';input.focus()}
};
const addAction=()=>{
  const input=document.getElementById('new-action'),owner=document.getElementById('new-action-owner');if(!input.value.trim())return;
  if(records(state(),'action').length>=30){notice.textContent='Keep up to 30 actions in this brief.';return}
  const key=id(),patch={...recordPatch(state(),'action',key,{text:input.value.trim(),at:Date.now(),createdBy:actor()}),...briefActionMetaPatch(key,'owner',owner.value.trim()),...briefActionMetaPatch(key,'status','To do')};
  if(commit(patch)){input.value='';owner.value='';input.focus()}
};
document.getElementById('add-decision').onclick=addDecision;document.getElementById('add-action').onclick=addAction;
document.getElementById('new-decision').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addDecision()}};
for(const name of ['new-action','new-action-owner'])document.getElementById(name).onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addAction()}};
window.addEventListener('present:state',render);render();
`);
