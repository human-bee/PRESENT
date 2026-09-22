import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { json } from '../http';
import { getCanvasRecords, transactCanvas } from '../room-store';
import { judge } from '../agents/choice-judgments';
import { duration, frameShapes, initialShapes, origin, phases, players, roomId, shapeId } from './scene';
let time=0,playing=false,speed=1,trails=true,timer:ReturnType<typeof setInterval>|undefined,commitMs=0,frame=0,lastError='';
function ensure(){const records=getCanvasRecords(roomId);const creates=initialShapes(records);if(creates.length)transactCanvas(roomId,{scene:'1970',create:true},'PRESENT playbook',()=>({creates}));}
function commit(){const start=performance.now();transactCanvas(roomId,{scene:'1970',time,frame},'PRESENT playbook',records=>({updates:frameShapes(records,time,trails)}));commitMs=Math.round((performance.now()-start)*100)/100;frame++;}
function stop(){playing=false;if(timer)clearInterval(timer);timer=undefined;}
function play(){stop();if(time>=duration)time=0;playing=true;timer=setInterval(()=>{try{time=Math.min(duration,Math.round((time+.2*speed)*100)/100);commit();if(time>=duration)stop();}catch(e){lastError=e instanceof Error?e.message:'Replay stopped';stop();}},200);timer.unref();}
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare')}),z.object({action:z.literal('play')}),z.object({action:z.literal('pause')}),z.object({action:z.literal('rewind')}),
 z.object({action:z.literal('seek'),time:z.number().min(0).max(duration)}),z.object({action:z.literal('speed'),speed:z.union([z.literal(.5),z.literal(1),z.literal(2)])}),
 z.object({action:z.literal('trails'),show:z.boolean()}),z.object({action:z.literal('ask'),text:z.string().trim().min(1).max(400)}),
]);
function state(){return{roomId,time,playing,speed,trails,commitMs,frame,error:lastError,phases,players:players.map(({id,label,name,team})=>({id,label,name,team})),duration,origin,focusId:shapeId('pitch'),phase:phases.filter(p=>p.t<=time).at(-1)}}
export async function handlePlaybook(req:IncomingMessage,res:ServerResponse){
 if(new URL(req.url??'/','http://localhost').pathname!=='/api/playbook')return false;
 if(req.method==='GET'){json(res,200,state());return true;}
 if(req.method!=='POST'){json(res,405,{error:'Use POST'});return true;}
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1500){json(res,413,{error:'Request too large'});return true;}}
 try{
 const v=input.parse(JSON.parse(raw));ensure();lastError='';let decision:unknown;
 switch(v.action){case'prepare':stop();time=0;commit();break;case'play':play();break;case'pause':stop();break;case'rewind':stop();time=0;commit();break;case'seek':stop();time=v.time;commit();break;case'speed':speed=v.speed;break;case'trails':trails=v.show;commit();break;
 case'ask':{
 const result=await judge({request:v.text,currentTime:time,phase:state().phase?.name}, {control:{type:'choice',instructions:'Select the ONE replay control requested. Reject ambiguous, compound or unrelated requests. These are prerecorded schematic soccer poses; do not invent football events.',criteria:{play:'Play, resume or run the replay',pause:'Pause or freeze this frame',rewind:'Return to the start',slow:'Play at half speed / slow motion',normal:'Normal playback speed',fast:'Double playback speed',pele:'Jump to Pele receiving and waiting with the ball',overlap:'Jump to Carlos Alberto beginning his overlapping run',pass:'Jump to Pele passing to Carlos Alberto',finish:'Jump to the shot or goal finish',show:'Show passing and running lines',hide:'Hide passing and running lines',unknown:'Unsupported, ambiguous or multiple operations'}}},'jev');
 const choice=result.get('control');decision={choice,modelMs:result.modelMs,confidence:result.confidence('control')};
 if(!choice||choice==='unknown')throw new Error('Try one replay instruction: play, pause, slow down, or jump to Pelé’s pass.');
 if(choice==='play')play();else if(choice==='pause')stop();else if(choice==='rewind'){stop();time=0;commit();}else if(['slow','normal','fast'].includes(choice)){speed=choice==='slow'?.5:choice==='fast'?2:1;play();}else if(choice==='show'||choice==='hide'){trails=choice==='show';commit();}else{stop();time=({pele:18,overlap:13,pass:22,finish:26}as Record<string,number>)[choice];commit();}break;
 }}json(res,200,{...state(),decision});
 }catch(e){json(res,400,{error:e instanceof Error?e.message:'Replay request failed'});}return true;
}
