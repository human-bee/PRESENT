export const activityKinds = ['debate', 'standup', 'live', 'planning', 'retro'] as const;
export const activityTemplates = {
  debate: {
    title: 'A good disagreement',
    label: 'Debate',
    description: 'Take a side. Get curious. Follow the evidence.',
    lanes: ['For', 'Against'],
  },
  standup: {
    title: 'Make progress together',
    label: 'Standup',
    description: 'People, blockers, and work that moves in the meeting.',
    lanes: ['In progress', 'Up next'],
  },
  live: {
    title: 'Let the audience in',
    label: 'Live room',
    description: 'A moderated queue for what happens next.',
    lanes: ['On air', 'Next up'],
  },
  planning: {
    title: 'Choose the next move',
    label: 'Planning',
    description: 'Explore options, evidence, and commitments.',
    lanes: ['Explore', 'Commit'],
  },
  retro: {
    title: 'Make the next one better',
    label: 'Retrospective',
    description: 'Keep the lessons. Turn them into experiments.',
    lanes: ['Keep', 'Change'],
  },
} satisfies Record<
  (typeof activityKinds)[number],
  { title: string; label: string; description: string; lanes: string[] }
>;
