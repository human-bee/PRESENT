import { createHash } from 'node:crypto';
import { toRichText, type TLRecord, type TLShape, type TLShapeId } from '@tldraw/tlschema';
import { buildCanvasMutation } from '../agents/canvas-tools';
import type { CanvasCommand } from '../../shared/canvas-commands';
export const roomId = 'dfbd64fbe874039f400b2cffeee953bf';
export const origin = { x: 10000, y: 1000 };
export const duration = 30;
export const phases = [
  { t: 0, name: 'Escape the press', text: 'Clodoaldo carries out of pressure. The move begins in Brazil’s half.' },
  { t: 5, name: 'Find Rivellino', text: 'The ball moves left. Italy shifts toward the crowded side.' },
  { t: 9, name: 'Release Jairzinho', text: 'Rivellino sends Jairzinho down the left. Watch the opposite flank.' },
  { t: 13, name: 'Draw the defence', text: 'Jairzinho comes inside, pulling attention away from Carlos Alberto.' },
  { t: 18, name: 'Pelé waits', text: 'Jairzinho finds Pelé. The captain is arriving in the open right channel.' },
  { t: 22, name: 'The blind pass', text: 'Pelé rolls the ball into Carlos Alberto’s path. The space was made off the ball.' },
  { t: 26, name: 'The finish', text: 'Carlos Alberto meets the pass and drives the ball across goal.' },
  { t: 30, name: 'Brazil 4 · Italy 1', text: 'A team goal, drawn as a shared canvas. Replay it, scrub it, or draw your own run.' },
];
type Point = [number, number];
export const players: { id: string; label: string; name: string; team: 'bra' | 'ita'; start: Point; end: Point }[] = [
  ['b1','1','Félix',[5,34],[6,34]], ['b2','2','Brito',[20,22],[37,24]], ['b3','3','Piazza',[22,43],[40,43]],
  ['b16','16','Everaldo',[30,10],[53,10]], ['b4','4','Carlos Alberto',[37,61],[93,48]], ['b5','5','Clodoaldo',[39,36],[66,31]],
  ['b8','8','Gérson',[48,28],[74,26]], ['b11','11','Rivellino',[48,9],[70,13]], ['b7','7','Jairzinho',[64,11],[84,24]],
  ['b10','10','Pelé',[74,39],[84,37]], ['b9','9','Tostão',[77,28],[95,30]],
].map(([id,label,name,start,end])=>({id,label,name,start,end,team:'bra'})) as typeof players;
for (const [i,p] of ([[101,34],[85,11],[83,27],[85,43],[81,60],[67,20],[65,38],[66,54],[46,24],[43,42],[53,55]] as Point[]).entries()) players.push({id:'i'+i,label:i===0?'G':String(i),name:i===0?'Italy · goalkeeper':'Italy · schematic '+i,team:'ita',start:p,end:i===0?[102,33]:[Math.min(98,p[0]+13),p[1]+(i%2?4:-5)]});
const tracks: Record<string, [number, number, number][]> = {
 b5:[[0,39,36],[2,42,30],[3.5,46,35],[5,49,29],[30,66,31]],
 b11:[[0,48,9],[5,52,10],[9,56,10],[30,70,13]],
 b7:[[0,64,11],[9,70,10],[13,76,17],[18,82,28],[30,84,24]],
 b10:[[0,74,39],[18,82,37],[22,83,37],[30,84,37]],
 b4:[[0,37,61],[9,47,61],[13,57,59],[18,69,58],[22,79,55],[26,91,48],[30,93,48]],
 ball:[[0,40,37],[2,43,31],[3.5,47,36],[4.5,50,30],[5.4,53,11],[8,55,11],[9.4,71,11],[13,77,18],[17,83,29],[18.4,83,38],[21.5,83,38],[24,86,52],[26,92,49],[27.5,106,29],[30,106,29]],
};
export function pointAt(id: string, t: number): Point {
 const p=players.find(p=>p.id===id); const track=tracks[id] ?? [[0,...p!.start],[duration,...p!.end]];
 t=Math.max(0,Math.min(duration,t)); const next=track.findIndex(k=>k[0]>t);
 if(next<0)return [track.at(-1)![1],track.at(-1)![2]];
 if(next===0)return [track[0][1],track[0][2]];
 const a=track[next-1],b=track[next],f=(t-a[0])/(b[0]-a[0]);return [a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
}
export const shapeId = (key:string) => `shape:voice_${createHash('sha256').update(`playbook-1970-${key}:0`).digest('hex').slice(0,28)}` as TLShapeId;
const geo=(x:number,y:number,w:number,h:number,color='green',fill='none',text='',kind='rectangle')=>({type:'create_geo',x:origin.x+x,y:origin.y+y,w,h,color,fill,text,geo:kind}) as CanvasCommand;
const arrow=(a:Point,b:Point,color='grey')=>({type:'create_arrow',x:origin.x,y:origin.y,start:{x:a[0]*10,y:a[1]*10},end:{x:b[0]*10,y:b[1]*10},color,text:'',bend:0}) as CanvasCommand;
export function initialShapes(records: TLRecord[]) {
 const commands: [string,CanvasCommand][]=[['pitch',geo(0,0,1050,680,'green','semi')],['centre',geo(435,250,180,180,'green','none','','ellipse')],['half',arrow([52.5,0],[52.5,68],'green')]];
 for(const [key,x,w,h,y] of [['boxL',0,165,403,138.5],['boxR',885,165,403,138.5],['sixL',0,55,183,248.5],['sixR',995,55,183,248.5],['goalL',-24,24,73,303.5],['goalR',1050,24,73,303.5]] as const) commands.push([key,geo(x,y,w,h)]);
 commands.push(['spot',geo(521,336,8,8,'green','solid','','ellipse')]);
 for(const [key,x]of [['penL',110],['penR',940]] as const)commands.push([key,geo(x-3,337,6,6,'green','solid','','ellipse')]);
 // Ghost routes sit underneath the player tokens; they are native arrows too.
 for(const [key,a,b]of [['pass1',[50,30],[53,11]],['pass2',[55,11],[71,11]],['pass3',[83,29],[83,38]],['pass4',[83,38],[92,49]],['shot',[92,49],[106,29]],['run',[37,61],[93,48]]] as [string,Point,Point][])commands.push([key,arrow(a,b,key==='run'?'orange':'grey')]);
 for(const p of players){const q=pointAt(p.id,0);commands.push([p.id,geo(q[0]*10-27,q[1]*10-27,54,54,p.team==='bra'?'yellow':'blue','solid',p.label,'ellipse')]);}
 const ball=pointAt('ball',0);commands.push(['ball',geo(ball[0]*10-7,ball[1]*10-7,14,14,'black','solid','','ellipse')]);
 commands.push(['caption',{type:'create_text',x:origin.x,y:origin.y+715,w:1060,text:'SCHEMATIC RECONSTRUCTION · Approximate positions, not tracking data',color:'grey'}]);
 const creates:TLRecord[]=[];
 for(const [key,command]of commands){if(records.some(r=>r.id===shapeId(key)))continue;const built=buildCanvasMutation({pageId:'page:page',commands:[command]},[...records,...creates],'PRESENT playbook',`playbook-1970-${key}`);for(const r of built.mutation.creates){if(r.typeName==='shape'){const p=r.props as unknown as Record<string,unknown>;if(r.type!=='text')p.dash='solid';p.font='sans';p.size='s';if(key==='half')p.arrowheadEnd='none';if(key.startsWith('pass')||key==='shot'||key==='run'){p.dash=key==='run'?'dashed':'solid';r.opacity=.14;}r.meta={...r.meta,playbookKey:key};}creates.push(r);}}
 return creates;
}
export function frameShapes(records:TLRecord[],t:number,trails:boolean){
 return records.filter((r):r is TLShape=>r.typeName==='shape'&&typeof r.meta.playbookKey==='string').flatMap(r=>{
  const key=String(r.meta.playbookKey);if(players.some(p=>p.id===key)||key==='ball'){const p=pointAt(key,t),radius=key==='ball'?7:27;return[{...r,x:origin.x+p[0]*10-radius,y:origin.y+p[1]*10-radius,...(key!=='ball'?{props:{...r.props,w:54,h:54,richText:toRichText(players.find(p=>p.id===key)!.label)}}:{})} as TLShape];}
  if(['pass1','pass2','pass3','pass4','shot','run'].includes(key)){const threshold:Record<string,number>={pass1:4,pass2:8,pass3:17,pass4:21,shot:26,run:9};return[{...r,opacity:trails?(t>=threshold[key]?.85:.12):0}];}
  if(key==='caption')return[{...r,props:{...r.props,richText:toRichText('SCHEMATIC RECONSTRUCTION · Approximate positions, not tracking data')}} as TLShape];return[];
 });
}
