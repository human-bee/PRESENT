import { useEffect, useState } from 'react';
import type { Activity } from '../../shared/activity';
import type { WorkJob } from '../../shared/work';
export function useWorkJobs(roomId: string, a: Activity) {
  const [jobs, setJobs] = useState<Record<string, WorkJob>>({});
  const ids = a.meeting.commitments.flatMap((c) => (c.jobId ? [c.jobId] : [])).join(',');
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const refresh = async () => {
      const values = await Promise.allSettled(
        ids
          .split(',')
          .filter(Boolean)
          .map(async (id) => {
            const response = await fetch(`/api/work/${id}?roomId=${roomId}`, { signal: controller.signal });
            if (!response.ok) return null;
            return [id, (await response.json()) as WorkJob] as const;
          }),
      );
      if (controller.signal.aborted) return;
      const found = values.flatMap((value) => (value.status === 'fulfilled' && value.value ? [value.value] : []));
      setJobs(Object.fromEntries(found));
      if (found.some(([, job]) => ['queued', 'running'].includes(job.status)))
        timer = window.setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ids, roomId]);
  return jobs;
}
