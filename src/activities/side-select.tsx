import type { Activity } from '../../shared/activity';
export function SideSelect({
  activity,
  name,
  defaultValue = '',
  label = 'Side',
}: {
  activity: Activity;
  name: string;
  defaultValue?: string;
  label?: string;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={defaultValue}>
        <option value="">Open floor</option>
        {activity.sides.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
