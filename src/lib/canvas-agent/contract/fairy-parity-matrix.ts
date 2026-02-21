import { TEACHER_ACTIONS_BY_PROFILE } from './teacher';

export type FairyParityClass = 'canvas' | 'orchestration' | 'meta';
export type FairyExecutorClass = 'canvas-dispatch' | 'server-orchestration' | 'server-meta';

export type FairyParityEntry = {
  class: FairyParityClass;
  executor: FairyExecutorClass;
  ready: boolean;
  sideEffect: string;
};

type Fairy48ActionName = (typeof TEACHER_ACTIONS_BY_PROFILE.fairy48)[number];

const FAIRY_PARITY_MATRIX = {
  'abort-duo-project': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Aborts active duo project and records reason in orchestration ledger.',
  },
  'abort-project': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Aborts active project and records reason in orchestration ledger.',
  },
  'activate-agent': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Records requested agent activation in orchestration ledger.',
  },
  align: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Aligns shape positions on the canvas.',
  },
  'await-duo-tasks-completion': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Records a duo wait barrier for task completion tracking.',
  },
  'await-tasks-completion': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Records a wait barrier for task completion tracking.',
  },
  'bring-to-front': {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Moves selected shapes to front z-order.',
  },
  'change-page': {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Switches current TLDraw page by name.',
  },
  'claim-todo-item': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Claims an existing orchestration todo item.',
  },
  clear: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Clears all canvas shapes.',
  },
  'country-info': {
    class: 'meta',
    executor: 'server-meta',
    ready: true,
    sideEffect: 'Records a country-info request as non-mutating metadata.',
  },
  create: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Creates canvas shapes.',
  },
  'create-duo-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Creates duo project task state with assignment metadata.',
  },
  'create-page': {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Creates a TLDraw page and optionally switches to it.',
  },
  'create-project-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Creates project task state with assignment metadata.',
  },
  'create-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Creates solo task state in orchestration ledger.',
  },
  delete: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Deletes a specific shape.',
  },
  'delete-personal-todo-items': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Deletes personal todo records by id.',
  },
  'delete-project-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Deletes project task state by task id.',
  },
  'direct-to-start-duo-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Records delegation for a duo task start.',
  },
  'direct-to-start-project-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Records delegation for project task start.',
  },
  distribute: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Distributes shapes evenly across an axis.',
  },
  'end-duo-project': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks duo project complete in orchestration ledger.',
  },
  'end-project': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks project complete in orchestration ledger.',
  },
  'enter-orchestration-mode': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Enables orchestration mode for current room/session lane.',
  },
  'fly-to-bounds': {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Moves viewport to provided bounds.',
  },
  label: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Updates text/rich text on target shape.',
  },
  'mark-duo-task-done': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks current duo task done.',
  },
  'mark-my-task-done': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks claimed task done for current agent.',
  },
  'mark-task-done': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks current solo task done.',
  },
  message: {
    class: 'meta',
    executor: 'server-meta',
    ready: true,
    sideEffect: 'Sends assistant chat message without canvas mutation.',
  },
  move: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Moves one or more shapes.',
  },
  'move-position': {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Moves viewport center to a coordinate.',
  },
  offset: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Offsets multiple shapes by delta.',
  },
  pen: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Creates draw/pen geometry from points.',
  },
  place: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Places one shape relative to another.',
  },
  resize: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Resizes one or more shapes.',
  },
  review: {
    class: 'meta',
    executor: 'server-meta',
    ready: true,
    sideEffect: 'Enqueues bounded follow-up review detail.',
  },
  rotate: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Rotates selected shapes.',
  },
  'send-to-back': {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Moves selected shapes to back z-order.',
  },
  stack: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Stacks shapes in row/column order with gap.',
  },
  'start-duo-project': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Starts a duo project with plan metadata.',
  },
  'start-duo-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks duo task as started.',
  },
  'start-project': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Starts project with plan metadata.',
  },
  'start-task': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Marks solo task as started.',
  },
  think: {
    class: 'meta',
    executor: 'server-meta',
    ready: true,
    sideEffect: 'Records internal thought as assistant-side chat context.',
  },
  update: {
    class: 'canvas',
    executor: 'canvas-dispatch',
    ready: true,
    sideEffect: 'Updates existing shape attributes.',
  },
  'upsert-personal-todo-item': {
    class: 'orchestration',
    executor: 'server-orchestration',
    ready: true,
    sideEffect: 'Creates or updates personal todo item state.',
  },
} satisfies Record<Fairy48ActionName, FairyParityEntry>;

export function getFairyParityEntry(actionName: Fairy48ActionName) {
  return FAIRY_PARITY_MATRIX[actionName];
}

export function getFairyParityRows() {
  return TEACHER_ACTIONS_BY_PROFILE.fairy48.map((action) => ({
    action,
    ...FAIRY_PARITY_MATRIX[action],
  }));
}

export function getFairyParitySummary() {
  const rows = getFairyParityRows();
  const total = rows.length;
  const ready = rows.filter((row) => row.ready).length;
  const byClass = rows.reduce<Record<FairyParityClass, number>>(
    (acc, row) => {
      acc[row.class] += 1;
      return acc;
    },
    { canvas: 0, orchestration: 0, meta: 0 },
  );
  return {
    total,
    ready,
    notReady: total - ready,
    byClass,
  };
}

export const FAIRY_PARITY_ACTIONS = Object.freeze(
  TEACHER_ACTIONS_BY_PROFILE.fairy48.map((action) => action),
);
