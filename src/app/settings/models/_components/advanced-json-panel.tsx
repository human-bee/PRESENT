type Props = {
  busy: boolean;
  isAdmin: boolean;
  userConfigDraft: string;
  onUserConfigDraftChange: (value: string) => void;
  onSaveUserJson: () => void;
  adminProfileDraft: string;
  onAdminProfileDraftChange: (value: string) => void;
  onSaveAdminJson: () => void;
};

export function AdvancedJsonPanel({
  busy,
  isAdmin,
  userConfigDraft,
  onUserConfigDraftChange,
  onSaveUserJson,
  adminProfileDraft,
  onAdminProfileDraftChange,
  onSaveAdminJson,
}: Props) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Advanced Raw JSON</h2>
      <p className="mt-1 text-sm text-gray-600">
        For unsupported keys or bulk edits, you can still use raw JSON payloads directly.
      </p>

      <details className="mt-3 rounded-md border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-800">User Override JSON</summary>
        <textarea
          value={userConfigDraft}
          onChange={(event) => onUserConfigDraftChange(event.target.value)}
          className="mt-3 h-56 w-full rounded-md border p-3 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onSaveUserJson}
          className="mt-3 rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Save User Overrides (JSON)
        </button>
      </details>

      {isAdmin ? (
        <details className="mt-3 rounded-md border border-indigo-200 bg-indigo-50/30 p-3">
          <summary className="cursor-pointer text-sm font-medium text-indigo-900">Admin Profile JSON</summary>
          <textarea
            value={adminProfileDraft}
            onChange={(event) => onAdminProfileDraftChange(event.target.value)}
            className="mt-3 h-56 w-full rounded-md border p-3 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={onSaveAdminJson}
            className="mt-2 rounded-md bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Upsert Profile (JSON)
          </button>
        </details>
      ) : null}
    </section>
  );
}
