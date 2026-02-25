type Props = {
  busy: boolean;
  adminSharedKeyDraft: string;
  onAdminSharedKeyDraftChange: (value: string) => void;
  onUpsertSharedKey: () => void;
  adminPasswordDraft: string;
  onAdminPasswordDraftChange: (value: string) => void;
  onUpdatePasswordPolicy: () => void;
  onApplyRestartChanges: () => void;
};

export function AdminKeyringPanel({
  busy,
  adminSharedKeyDraft,
  onAdminSharedKeyDraftChange,
  onUpsertSharedKey,
  adminPasswordDraft,
  onAdminPasswordDraftChange,
  onUpdatePasswordPolicy,
  onApplyRestartChanges,
}: Props) {
  return (
    <section className="space-y-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <h2 className="text-lg font-semibold text-indigo-900">Admin Keyring and Apply Controls</h2>

      <div>
        <div className="text-sm font-medium text-indigo-900">Shared Provider Keys</div>
        <textarea
          value={adminSharedKeyDraft}
          onChange={(event) => onAdminSharedKeyDraftChange(event.target.value)}
          className="mt-2 h-40 w-full rounded-md border p-3 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onUpsertSharedKey}
          className="mt-2 rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Upsert Shared Key
        </button>
      </div>

      <div>
        <div className="text-sm font-medium text-indigo-900">Shared Key Password Policy</div>
        <textarea
          value={adminPasswordDraft}
          onChange={(event) => onAdminPasswordDraftChange(event.target.value)}
          className="mt-2 h-32 w-full rounded-md border p-3 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onUpdatePasswordPolicy}
          className="mt-2 rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Update Password Policy
        </button>
      </div>

      <div>
        <div className="text-sm font-medium text-indigo-900">Apply Restart-Bound Changes</div>
        <button
          type="button"
          disabled={busy}
          onClick={onApplyRestartChanges}
          className="mt-2 rounded-md bg-indigo-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Apply Restart Changes
        </button>
      </div>
    </section>
  );
}
