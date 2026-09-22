import { packDocument } from './common';
import { shuffleOrder } from './game-state';

export const cardsHtml = packDocument(`
<div><h2>Shared deck</h2><p class="muted">A shared table of 52 cards. Face-down cards are visible in room data; this deck has no private hands.</p></div>
<div class="row"><button id="draw" class="primary" type="button">Draw card</button><button id="shuffle" type="button">Shuffle deck</button><button id="return" type="button">Return all</button><span id="count" class="badge"></span></div>
<div id="table" class="cards" aria-label="Cards on table"></div>`, `
const shuffleOrder=${shuffleOrder.toString()};
const random=(count)=>Array.from(crypto.getRandomValues(new Uint32Array(count)),value=>value/4294967296);
const table=document.getElementById('table');
const deck=()=>records(state(),'card').filter(card=>card.location==='deck').sort((a,b)=>Number(state()['order:'+a.id])-Number(state()['order:'+b.id])||a.id.localeCompare(b.id));
const render=()=>{table.replaceChildren();const cards=records(state(),'card'),onTable=cards.filter(card=>card.location==='table').sort((a,b)=>Number(a.drawnAt)-Number(b.drawnAt));document.getElementById('count').textContent=deck().length+' in deck';document.getElementById('draw').disabled=!deck().length;document.getElementById('shuffle').disabled=deck().length<2;for(const card of onTable){const item=el('div',{className:'card'+(card.faceUp?(['♥','♦'].includes(card.suit)?' red':''):' back'),'data-card-id':card.id});item.append(el('strong',{},card.faceUp?card.label:'PRESENT'),button(card.faceUp?'Hide':'Reveal',()=>update('card',card.id,{faceUp:!state()['card:'+card.id]?.faceUp})),button('Return',()=>update('card',card.id,{location:'deck',faceUp:false,drawnAt:null,drawnBy:null})));table.append(item)}if(!onTable.length)table.append(empty('Draw a card onto the shared table.'))};
document.getElementById('draw').onclick=()=>{const card=deck()[0];if(card)update('card',card.id,{location:'table',faceUp:false,drawnAt:Date.now(),drawnBy:actor()})};
document.getElementById('shuffle').onclick=()=>{const cards=deck();commit(shuffleOrder(cards.map(card=>card.id),random(Math.max(0,cards.length-1))))};
document.getElementById('return').onclick=()=>{const patch={};for(const card of records(state(),'card').filter(card=>card.location==='table'))Object.assign(patch,recordPatch(state(),'card',card.id,{location:'deck',faceUp:false,drawnAt:null,drawnBy:null}));if(Object.keys(patch).length)commit(patch)};
window.addEventListener('present:state',render);render();
`);
