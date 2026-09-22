export type Step = { actor: string; prompt: string; expected: string; seconds?: number; text?: string };
export const stories: { name: string; steps: Step[] }[] = [
 { name:'design-critique', steps:[
  {actor:'Maya',prompt:'Create an empty task board for our design review.',expected:'kanban'},
  {actor:'Leo',prompt:'Start a 2 minute timer for silent review.',expected:'timer',seconds:120},
  {actor:'Sam',prompt:'Add a note saying "Keyboard navigation needs attention".',expected:'note',text:'Keyboard navigation needs attention'},
  {actor:'Maya',prompt:'Do not start a 5 minute timer yet.',expected:'defer'},
  {actor:'Leo',prompt:'Build a custom interactive accessibility scorecard with sliders.',expected:'defer'},
  {actor:'Sam',prompt:'Create an empty meeting brief for the handoff.',expected:'brief'},
 ]},
 { name:'community-workshop',steps:[
  {actor:'Ari',prompt:'Set up an empty audience question board for our workshop.',expected:'audience'},
  {actor:'Noor',prompt:'Start a 90 second countdown for introductions.',expected:'timer',seconds:90},
  {actor:'Jules',prompt:'Create a shared dice roller for our improv game.',expected:'dice'},
  {actor:'Ari',prompt:'Make a task board and start a 3 minute timer.',expected:'defer'},
  {actor:'Noor',prompt:'Put "Everyone gets a turn" on a new note.',expected:'note',text:'Everyone gets a turn'},
  {actor:'Jules',prompt:'Create a shared deck of playing cards.',expected:'cards'},
 ]},
 { name:'evidence-debate',steps:[
  {actor:'Imani',prompt:'Open a new empty debate desk for claims and evidence.',expected:'debate'},
  {actor:'Dev',prompt:'Start a 3 minute countdown for the opening argument.',expected:'timer',seconds:180},
  {actor:'Rae',prompt:'Fact check whether solar panels work at night with current sources.',expected:'defer'},
  {actor:'Imani',prompt:'Create a new note: "Separate evidence from assumptions".',expected:'note',text:'Separate evidence from assumptions'},
  {actor:'Dev',prompt:'Change the existing timer to 30 seconds.',expected:'defer'},
  {actor:'Rae',prompt:'I might want a task board later, but not now.',expected:'defer'},
 ]},
];
