import { CLEAR_ALL_SHAPES_SENTINEL, convertTeacherAction } from './teacher-bridge';

describe('convertTeacherAction', () => {
  it('converts teacher create into canonical create_shape', () => {
    const action = {
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
    };

    const converted = convertTeacherAction(action);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('create_shape');
    expect(converted?.params).toMatchObject({
      id: 'canvas_note_1',
      type: 'note',
      x: 120,
      y: 80,
      props: expect.objectContaining({ color: 'yellow', text: 'Hello world' }),
    });
  });

  it('converts teacher move into canonical move target', () => {
    const action = {
      _type: 'move',
      intent: 'move hero',
      shapeId: 'hero',
      x: 400,
      y: -120,
    };

    const converted = convertTeacherAction(action);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('move');
    expect(converted?.params).toMatchObject({
      ids: ['hero'],
      target: { x: 400, y: -120 },
    });
  });

  it('converts teacher pen into create_shape draw events', () => {
    const action = {
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
    };

    const converted = convertTeacherAction(action);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('create_shape');
    expect(converted?.params).toMatchObject({ type: 'draw', props: { segments: expect.any(Array) } });
    const segments = (converted?.params as any).props.segments;
    expect(Array.isArray(segments)).toBe(true);
    expect(segments[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it('converts teacher clear into delete_shape sentinel payload', () => {
    const action = {
      _type: 'clear',
    };

    const converted = convertTeacherAction(action);
    expect(converted).toBeTruthy();
    expect(converted?.name).toBe('delete_shape');
    expect(converted?.params).toMatchObject({
      ids: [CLEAR_ALL_SHAPES_SENTINEL],
    });
  });
});
