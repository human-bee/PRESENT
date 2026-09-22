import { packDocument } from './common';

export const kanbanHtml = packDocument(`
<div><h2>Task board</h2><p class="muted">Shared commitments, clear owners and one next move.</p></div>
<form id="add" class="row"><label class="grow">Task<input id="new-task" required maxlength="300" placeholder="What needs to happen?"></label><label class="grow">Owner<input id="new-owner" maxlength="80" placeholder="Name or team"></label><button id="add-button" class="primary" type="button">Add task</button></form>
<div id="board" class="cols" aria-label="Task columns"></div>`, `
const statuses=['To do','Doing','Done'];
const board=document.getElementById('board');
const render=()=>{const focus=rememberFocus(board);board.replaceChildren();const tasks=records(state(),'task').sort((a,b)=>Number(a.at)-Number(b.at));for(const status of statuses){const column=el('section',{className:'panel'}),items=tasks.filter(task=>(statuses.includes(task.status)?task.status:'To do')===status);column.append(el('h3',{},status+' · '+items.length));for(const task of items){const card=el('article',{className:'task panel','data-task-id':task.id});const title=textInput(task.title,'Task title',300),owner=textInput(task.owner,'Task owner',80);title.dataset.editKey=task.id+':title';owner.dataset.editKey=task.id+':owner';title.oninput=()=>update('task',task.id,{title:title.value});owner.oninput=()=>update('task',task.id,{owner:owner.value});card.append(field('Task',title),field('Owner',owner),choice(statuses,status,'Task status',value=>update('task',task.id,{status:value})),button('Delete',()=>commit({['task:'+task.id]:null}),'danger'));column.append(card)}if(!items.length)column.append(empty(status==='To do'?'Add a task to begin.':'Nothing here yet.'));board.append(column)}restoreFocus(board,focus)};
const addTask=()=>{const title=document.getElementById('new-task'),owner=document.getElementById('new-owner');if(!title.value.trim())return;if(records(state(),'task').length>=40){notice.textContent='This board holds up to 40 tasks. Remove a completed task first.';return}if(update('task',id(),{title:title.value.trim(),owner:owner.value.trim(),status:'To do',at:Date.now(),createdBy:actor()})){title.value='';owner.value='';title.focus()}};
document.getElementById('add-button').onclick=addTask;document.getElementById('add').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addTask()}};
window.addEventListener('present:state',render);render();
`);
