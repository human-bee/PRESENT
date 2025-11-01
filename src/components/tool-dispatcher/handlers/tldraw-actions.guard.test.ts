jest.mock('@tldraw/tldraw', () => ({
  toRichText: (text: string) => text,
}), { virtual: true });

import { applyEnvelope } from './tldraw-actions';

const mockEditor = {
  calls: [] as any[],
  createShapes: function (payload: any[]) {
    this.calls.push(['createShapes', payload]);
  },
  updateShapes: function (payload: any[]) {
    this.calls.push(['updateShapes', payload]);
  },
  deleteShapes: function (payload: any[]) {
    this.calls.push(['deleteShapes', payload]);
  },
  getShape: () => null,
} as any;

test('ignores envelope with wrong version', () => {
  mockEditor.calls.length = 0;
  applyEnvelope(
    { editor: mockEditor, isHost: true, appliedIds: new Set() },
    { v: 'wrong', sessionId: 's', seq: 1, ts: Date.now(), actions: [], partial: false } as any,
  );
  expect(mockEditor.calls).toHaveLength(0);
});
