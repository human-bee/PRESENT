import { packDocument } from './common';
import { rollValues } from './game-state';

export const diceHtml = packDocument(`
<div><h2>Dice table</h2><p class="muted">Rolls are shared with the room and attributed to the participant.</p></div>
<div class="row"><label>Dice<select id="quantity" aria-label="Number of dice"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option></select></label><label>Sides<select id="sides" aria-label="Dice sides"><option>4</option><option selected>6</option><option>8</option><option>10</option><option>12</option><option>20</option><option>100</option></select></label><button id="roll" type="button" class="primary">Roll dice</button></div>
<div id="latest" class="panel" aria-live="polite"></div><details><summary>Shared roll history</summary><div id="history" class="stack"></div></details>`, `
const rollValues=${rollValues.toString()};const latest=document.getElementById('latest'),history=document.getElementById('history');
const render=()=>{latest.replaceChildren();history.replaceChildren();const rolls=records(state(),'roll').sort((a,b)=>Number(b.at)-Number(a.at)||b.id.localeCompare(a.id));const first=rolls[0];if(first){latest.append(el('output',{},Array.isArray(first.values)?first.values.reduce((sum,value)=>sum+Number(value),0):'—'),el('p',{},(first.values||[]).join(' + ')+' · d'+first.sides),el('small',{},'Rolled by '+String(first.actor)+' · '+timestamp(first.at)))}else latest.append(empty('Choose your dice and make the first roll.'));for(const roll of rolls){const item=el('div',{className:'row space'});item.append(el('span',{},(roll.values||[]).join(', ')+' · d'+roll.sides),el('small',{},String(roll.actor)+' · '+timestamp(roll.at)),button('Remove',()=>commit({['roll:'+roll.id]:null})));history.append(item)}};
document.getElementById('roll').onclick=()=>{const count=Number(document.getElementById('quantity').value),sides=Number(document.getElementById('sides').value),samples=Array.from(crypto.getRandomValues(new Uint32Array(count)),value=>value/4294967296);if(records(state(),'roll').length>=40){notice.textContent='The history holds 40 rolls. Remove an older roll first.';return}update('roll',id(),{sides,values:rollValues(sides,samples),actor:actor(),at:Date.now()})};
window.addEventListener('present:state',render);render();
`);
