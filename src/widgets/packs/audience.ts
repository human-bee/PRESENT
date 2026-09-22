import { packDocument } from './common';
import { questionStatusPatch, questionVoteCount, questionVotePatch } from './audience-state';

export const audienceHtml = packDocument(`
<div><h2>Audience Q&A</h2><p class="muted">A shared question queue. Participation is optional.</p></div>
<div id="active-question" class="stack" aria-label="Active question"></div>
<label>Your question<textarea id="new-question" aria-label="New audience question" rows="2" maxlength="500" placeholder="What would you like the room to answer?"></textarea></label>
<div class="row space"><button id="add-question" type="button" class="primary">Add question</button><label>Show<select id="question-filter" aria-label="Question filter"><option value="open">Open questions</option><option value="resolved">Resolved questions</option><option value="all">All questions</option></select></label></div>
<div id="questions" class="stack" aria-label="Audience questions"></div>`, `
const questionVotePatch=${questionVotePatch.toString()};
const questionVoteCount=${questionVoteCount.toString()};
const questionStatusPatch=${questionStatusPatch.toString()};
const list=document.getElementById('questions'),active=document.getElementById('active-question');
let filter='open';
const render=()=>{
  const current=state(),focus=rememberFocus(list),questions=records(current,'question');
  const selected=questions.find(question=>question.id===current.activeQuestionId&&current['questionStatus:'+question.id]!=='resolved');
  active.replaceChildren();
  if(selected){
    const panel=el('section',{className:'panel stack'});
    panel.append(el('h3',{},'Discussing now'),el('p',{},selected.text||''),button('Resolve active question',()=>commit(questionStatusPatch(selected.id,'resolved'))));
    active.append(panel);
  }
  list.replaceChildren();
  const visible=questions.filter(question=>filter==='all'||(current['questionStatus:'+question.id]==='resolved'?'resolved':'open')===filter);
  visible.sort((a,b)=>questionVoteCount(current,b.id)-questionVoteCount(current,a.id)||Number(a.at)-Number(b.at)||a.id.localeCompare(b.id));
  for(const question of visible){
    const resolved=current['questionStatus:'+question.id]==='resolved';
    const panel=el('article',{className:'panel stack','data-question-id':question.id});
    const text=el('textarea',{'aria-label':'Question text',rows:2,maxlength:500});
    text.value=String(question.text||'');text.dataset.editKey=question.id+':text';
    text.oninput=()=>update('question',question.id,{text:text.value});
    const ownPatch=questionVotePatch(current,question.id,present.participantId,true);
    const ownKey=ownPatch&&Object.keys(ownPatch)[0],voted=!!ownKey&&current[ownKey]===true;
    const vote=button((voted?'Voted':'Vote')+' · '+questionVoteCount(current,question.id),()=>{
      const next=questionVotePatch(state(),question.id,present.participantId,!voted);if(next)commit(next);
    });
    vote.setAttribute('aria-pressed',String(voted));vote.disabled=resolved||!ownKey;
    const controls=row(vote);
    if(resolved)controls.append(button('Reopen',()=>commit(questionStatusPatch(question.id,'open'))));
    else {
      const activate=button(selected?.id===question.id?'Active':'Activate',()=>commit({activeQuestionId:question.id}));
      activate.disabled=selected?.id===question.id;
      controls.append(activate,button('Resolve',()=>commit(questionStatusPatch(question.id,'resolved'))));
    }
    controls.append(button('Delete',()=>commit({['question:'+question.id]:null}),'danger'));
    panel.append(row(el('span',{className:'badge'},resolved?'Resolved':'Open'),el('small',{},question.createdBy===actor()?'Your question':'Room question')),text,controls);
    list.append(panel);
  }
  if(!visible.length)list.append(empty(filter==='resolved'?'Resolved questions will appear here.':'Add a question or return to the open queue.'));
  restoreFocus(list,focus);
};
document.getElementById('add-question').onclick=()=>{
  const input=document.getElementById('new-question');if(!input.value.trim())return;
  if(records(state(),'question').length>=30){notice.textContent='This queue holds up to 30 questions. Remove an old question first.';return}
  const key=id();
  if(commit({...recordPatch(state(),'question',key,{text:input.value.trim(),at:Date.now(),createdBy:actor()}),...questionStatusPatch(key,'open')})){input.value='';input.focus()}
};
document.getElementById('question-filter').onchange=event=>{filter=event.target.value;render()};
window.addEventListener('present:state',render);render();
`);
