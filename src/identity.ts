const MEMBER_STORAGE_KEY = 'present:member-id';
let fallbackMemberId: string | undefined;

export function getParticipantId(storage?: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const target = storage ?? sessionStorage;
    const saved = target.getItem(MEMBER_STORAGE_KEY);
    if (saved && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(saved)) return saved;
    const id = crypto.randomUUID();
    target.setItem(MEMBER_STORAGE_KEY, id);
    return id;
  } catch { fallbackMemberId ??= crypto.randomUUID(); return fallbackMemberId; }
}

export function getRoomId() {
  const match = location.pathname.match(/^\/r\/([a-f0-9]{24,64})$/);
  if (match) return match[1];
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  history.replaceState({}, '', `/r/${id}`);
  return id;
}
