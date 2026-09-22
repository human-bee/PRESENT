export const reactiveStories = [
  { name: 'A planning debate becomes a shared decision', capability: 'debate' as const, steps: [
    { actor: 'Maya', target: 'widget', prompt: 'Async reviews reduce interruptions because everyone can reply when they have a quiet moment.', expected: 'contribution', relation: 'support', claim: 'async' },
    { actor: 'Owen', target: 'widget', prompt: 'What evidence do we have that async reviews reduce interruptions?', expected: 'contribution', relation: 'question', claim: 'async' },
    { actor: 'Lin', target: 'widget', prompt: 'Async reviews do not reduce interruptions: people constantly check for comments.', expected: 'contribution', relation: 'challenge', claim: 'async' },
    { actor: 'Maya', target: 'note', prompt: 'Make the selected note blue.', expected: 'color', color: 'blue' },
    { actor: 'Owen', target: 'note', prompt: 'Move this note 120 pixels to the right.', expected: 'move', dx: 120 },
    { actor: 'Lin', target: 'note', prompt: 'Replace this note text with "Pilot async reviews for one week".', expected: 'text', text: 'Pilot async reviews for one week' },
  ] },
  { name: 'A release team updates the board and canvas', capability: 'kanban' as const, steps: [
    { actor: 'Sam', target: 'widget', prompt: 'Move the onboarding copy review into Doing.', expected: 'task', task: 'copy', status: 'Doing' },
    { actor: 'Priya', target: 'widget', prompt: 'Mark the keyboard accessibility audit as done.', expected: 'task', task: 'access', status: 'Done' },
    { actor: 'Noah', target: 'note', prompt: 'Color this note green.', expected: 'color', color: 'green' },
    { actor: 'Sam', target: 'note', prompt: 'Move the selected note 80 pixels down.', expected: 'move', dy: 80 },
    { actor: 'Priya', target: 'note', prompt: 'Change this note text to "Ready for the release review".', expected: 'text', text: 'Ready for the release review' },
    { actor: 'Noah', target: 'widget', prompt: 'Do not mark the onboarding copy review done. We are discussing it tomorrow.', expected: 'defer' },
  ] },
];
