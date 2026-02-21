import { TEACHER_ACTIONS_BY_PROFILE } from './teacher';
import { CLEAR_ALL_SHAPES_SENTINEL, convertTeacherAction, teacherConverterCoverage } from './teacher-bridge';

describe('convertTeacherAction', () => {
  it('covers every fairy48 and template24 teacher action', () => {
    const expected = new Set([
      ...TEACHER_ACTIONS_BY_PROFILE.template24,
      ...TEACHER_ACTIONS_BY_PROFILE.fairy48,
    ]);

    expect(new Set(teacherConverterCoverage.supported)).toEqual(expected);
    expect(teacherConverterCoverage.missing).toEqual([]);
  });

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

  it('keeps fairy48 orchestration/page actions off compatibility think/todo shims', () => {
    const samples: Array<{ type: string; payload: Record<string, unknown> }> = [
      { type: 'start-project', payload: { _type: 'start-project', projectName: 'proj-a', projectDescription: 'desc', projectColor: 'blue', projectPlan: 'plan' } },
      { type: 'start-duo-project', payload: { _type: 'start-duo-project', projectName: 'proj-b', projectDescription: 'desc', projectColor: 'green', projectPlan: 'plan' } },
      { type: 'end-project', payload: { _type: 'end-project' } },
      { type: 'end-duo-project', payload: { _type: 'end-duo-project' } },
      { type: 'abort-project', payload: { _type: 'abort-project', reason: 'bad-input' } },
      { type: 'abort-duo-project', payload: { _type: 'abort-duo-project', reason: 'bad-input' } },
      { type: 'enter-orchestration-mode', payload: { _type: 'enter-orchestration-mode' } },
      { type: 'start-task', payload: { _type: 'start-task', taskId: 'task-1' } },
      { type: 'start-duo-task', payload: { _type: 'start-duo-task', taskId: 'task-2' } },
      { type: 'mark-task-done', payload: { _type: 'mark-task-done' } },
      { type: 'mark-my-task-done', payload: { _type: 'mark-my-task-done' } },
      { type: 'mark-duo-task-done', payload: { _type: 'mark-duo-task-done' } },
      { type: 'await-tasks-completion', payload: { _type: 'await-tasks-completion', taskIds: ['task-1'] } },
      { type: 'await-duo-tasks-completion', payload: { _type: 'await-duo-tasks-completion', taskIds: ['task-2'] } },
      { type: 'create-task', payload: { _type: 'create-task', taskId: 'task-1', title: 'Title', text: 'Text', x: 0, y: 0, w: 100, h: 80 } },
      { type: 'create-project-task', payload: { _type: 'create-project-task', taskId: 'task-2', title: 'Title', text: 'Text', assignedTo: 'agent-a', x: 0, y: 0, w: 100, h: 80 } },
      { type: 'create-duo-task', payload: { _type: 'create-duo-task', taskId: 'task-3', title: 'Title', text: 'Text', assignedTo: 'agent-b', x: 0, y: 0, w: 100, h: 80 } },
      { type: 'delete-project-task', payload: { _type: 'delete-project-task', taskId: 'task-2', reason: 'cancelled' } },
      { type: 'direct-to-start-project-task', payload: { _type: 'direct-to-start-project-task', taskId: 'task-2', otherFairyId: 'agent-z' } },
      { type: 'direct-to-start-duo-task', payload: { _type: 'direct-to-start-duo-task', taskId: 'task-3', otherFairyId: 'agent-y' } },
      { type: 'activate-agent', payload: { _type: 'activate-agent', fairyId: 'agent-x' } },
      { type: 'change-page', payload: { _type: 'change-page', pageName: 'Page 2', intent: 'go' } },
      { type: 'create-page', payload: { _type: 'create-page', pageName: 'Page 3', intent: 'new', switchToPage: true } },
      { type: 'upsert-personal-todo-item', payload: { _type: 'upsert-personal-todo-item', id: 'todo-1', status: 'todo', text: 'do thing' } },
      { type: 'delete-personal-todo-items', payload: { _type: 'delete-personal-todo-items', ids: ['todo-1'] } },
      { type: 'claim-todo-item', payload: { _type: 'claim-todo-item', todoItemId: 'todo-1' } },
    ];

    for (const sample of samples) {
      const converted = convertTeacherAction(sample.payload);
      expect(converted).toBeTruthy();
      expect(converted?.name).toBe(sample.type);
      expect(['think', 'todo']).not.toContain(converted?.name);
    }
  });

  it('keeps fairy48 meta actions explicit (no add_detail shim)', () => {
    const review = convertTeacherAction({
      _type: 'review',
      intent: 'check layout alignment',
    });
    expect(review).toBeTruthy();
    expect(review?.name).toBe('review');

    const countryInfo = convertTeacherAction({
      _type: 'country-info',
      code: 'US',
    });
    expect(countryInfo).toBeTruthy();
    expect(countryInfo?.name).toBe('country-info');
    expect(countryInfo?.params).toMatchObject({ code: 'US' });
  });
});
