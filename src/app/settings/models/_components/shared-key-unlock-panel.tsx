type Props = {
  busy: boolean;
  unlockPassword: string;
  onUnlockPasswordChange: (value: string) => void;
  onUnlock: () => void;
  onLock: () => void;
};

export function SharedKeyUnlockPanel({ busy, unlockPassword, onUnlockPasswordChange, onUnlock, onLock }: Props) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Shared Key Unlock</h2>
      <p className="mt-1 text-sm text-gray-600">
        Use optional admin password to enable shared fallback keys for this session.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="password"
          value={unlockPassword}
          onChange={(event) => onUnlockPasswordChange(event.target.value)}
          placeholder="Optional shared-key password"
          className="w-80 rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onUnlock}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Unlock Shared Keys
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onLock}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Lock
        </button>
      </div>
    </section>
  );
}
