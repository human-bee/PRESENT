"use client";

import { Fragment } from 'react';
import type { ToolJob } from '../utils/toolTypes';
import { JobCard, type JobCardProps } from './JobCard';

export interface ToolListProps {
  jobs: ToolJob[];
  onCancel?: JobCardProps['onCancel'];
  onRetry?: JobCardProps['onRetry'];
  emptyState?: React.ReactNode;
}

export function ToolList({ jobs, onCancel, onRetry, emptyState }: ToolListProps) {
  if (!jobs.length) {
    return <div className="text-xs text-muted-foreground">{emptyState ?? 'No active jobs'}</div>;
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <Fragment key={job.id}>
          <JobCard job={job} onCancel={onCancel} onRetry={onRetry} />
        </Fragment>
      ))}
    </div>
  );
}
