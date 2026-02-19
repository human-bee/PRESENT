import { convertTeacherAction } from './teacher-bridge';
import { TEACHER_ACTIONS, type TeacherActionName } from './teacher';

const VALID_TEACHER_FIXTURES: Record<TeacherActionName, Record<string, unknown>> = {
  'add-detail': { _type: 'add-detail', intent: 'Add details to the bunny face.' },
  align: { _type: 'align', alignment: 'left', gap: 0, intent: 'Align left', shapeIds: ['a', 'b'] },
  bringToFront: { _type: 'bringToFront', intent: 'Bring front', shapeIds: ['a'] },
  clear: { _type: 'clear' },
  count: { _type: 'count', expression: 'number of shapes on canvas' },
  countryInfo: { _type: 'countryInfo', code: 'US' },
  create: {
    _type: 'create',
    intent: 'drop note',
    shape: {
      _type: 'note',
      shapeId: 'canvas_note_1',
      color: 'yellow',
      note: 'Sticky note',
      text: 'Hello world',
      x: 120,
      y: 80,
    },
  },
  delete: { _type: 'delete', intent: 'delete temp', shapeId: 'shape-delete-1' },
  distribute: {
    _type: 'distribute',
    direction: 'horizontal',
    intent: 'spread out',
    shapeIds: ['a', 'b', 'c'],
  },
  getInspiration: { _type: 'getInspiration' },
  label: { _type: 'label', intent: 'Label bunny', shapeId: 'a', text: 'Bunny' },
  message: { _type: 'message', text: 'Working on it.' },
  move: { _type: 'move', intent: 'move hero', shapeId: 'hero', x: 400, y: -120 },
  pen: {
    _type: 'pen',
    intent: 'underline',
    color: 'black',
    fill: 'none',
    style: 'smooth',
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 0 },
    ],
  },
  place: {
    _type: 'place',
    align: 'center',
    alignOffset: 0,
    intent: 'Place shape',
    referenceShapeId: 'ref-1',
    side: 'right',
    sideOffset: 16,
    shapeId: 'shape-1',
  },
  resize: {
    _type: 'resize',
    intent: 'resize cluster',
    originX: 0,
    originY: 0,
    scaleX: 1.25,
    scaleY: 0.8,
    shapeIds: ['shape-1', 'shape-2'],
  },
  review: {
    _type: 'review',
    intent: 'review hero area',
    x: -100,
    y: -120,
    w: 640,
    h: 400,
  },
  rotate: {
    _type: 'rotate',
    centerY: 0,
    degrees: 25,
    intent: 'rotate cluster',
    originX: 0,
    originY: 0,
    shapeIds: ['shape-1', 'shape-2'],
  },
  sendToBack: { _type: 'sendToBack', intent: 'send back', shapeIds: ['a'] },
  setMyView: { _type: 'setMyView', intent: 'focus area', x: 0, y: 0, w: 1024, h: 768 },
  stack: { _type: 'stack', direction: 'horizontal', gap: 24, intent: 'stack row', shapeIds: ['a', 'b'] },
  think: { _type: 'think', text: 'planning next step' },
  update: {
    _type: 'update',
    intent: 'refresh label',
    update: {
      _type: 'note',
      color: 'yellow',
      note: 'Update note',
      shapeId: 'canvas_note_1',
      text: 'Updated',
      x: 120,
      y: 80,
    },
  },
  'update-todo-list': { _type: 'update-todo-list', id: 1, status: 'todo', text: 'Ship reliability patch' },
};

describe('convertTeacherAction', () => {
  it('converts all teacher actions without dropping supported contract actions', () => {
    for (const teacherAction of TEACHER_ACTIONS) {
      const fixture = VALID_TEACHER_FIXTURES[teacherAction];
      expect(fixture).toBeTruthy();
      const converted = convertTeacherAction(fixture);
      expect(converted).toBeTruthy();
    }
  });

  it('converts teacher move into canonical move target', () => {
    const converted = convertTeacherAction(VALID_TEACHER_FIXTURES.move);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('move');
    expect(converted?.params).toMatchObject({
      ids: ['hero'],
      target: { x: 400, y: -120 },
    });
  });

  it('converts teacher pen into create_shape draw events', () => {
    const converted = convertTeacherAction(VALID_TEACHER_FIXTURES.pen);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('create_shape');
    expect(converted?.params).toMatchObject({ type: 'draw', props: { segments: expect.any(Array) } });
    const segments = (converted?.params as any).props.segments;
    expect(Array.isArray(segments)).toBe(true);
    expect(segments[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('converts teacher place into deterministic place action params', () => {
    const converted = convertTeacherAction(VALID_TEACHER_FIXTURES.place);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('place');
    expect(converted?.params).toMatchObject({
      shapeId: 'shape-1',
      referenceShapeId: 'ref-1',
      side: 'right',
      sideOffset: 16,
      align: 'center',
      alignOffset: 0,
    });
  });
});
