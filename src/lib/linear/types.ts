import { z } from 'zod';

export type LoadPhase =
  | 'idle'
  | 'starting'
  | 'fetchingTeams'
  | 'fetchingIssues'
  | 'normalizing'
  | 'hydrating'
  | 'ready'
  | 'error';

export type LoadEvent = {
  phase: LoadPhase;
  message: string;
  meta?: Record<string, unknown>;
  ts: number;
};

export interface LoadStatus {
  step: LoadPhase;
  message?: string;
  lastUpdated: number;
  isRateLimited?: boolean;
}

export interface LinearTeam {
  id: string;
  name: string;
  key?: string;
}

export interface LinearProject {
  id: string;
  name: string;
  teamId?: string;
}

export interface LinearStatus {
  id: string;
  name: string;
  type?: string;
  color?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status?: string;
  statusId?: string;
  updatedAt: string;
  priority?: { value: number; name: string };
  labels?: string[];
  project?: string;
  assignee?: string;
}

export interface LinearBoardData {
  teams: LinearTeam[];
  projects: LinearProject[];
  statuses: LinearStatus[];
  issues: LinearIssue[];
  selectedTeamId?: string;
  selectedProjectId?: string;
}

/* --------------------------------------------------------------------------
 * Kanban State
 * --------------------------------------------------------------------------*/

export type KanbanState = {
  selectedTeam: string;
  selectedProject?: string;
  issues: LinearIssue[];
  draggedIssue: string | null;
  pendingUpdates: PendingUpdate[];
  updateMessage: string;
};

export type PendingUpdate = {
  id: number;
  issueId: string;
  issueIdentifier: string;
  fromStatus?: string;
  toStatus: string;
  statusId: string;
  timestamp: string;
  status: 'pending' | 'success' | 'failed';
};

export type DropIndicator = {
  targetId: string;
  position: 'before' | 'after';
};

export type ExtendedKanbanState = KanbanState & {
  selectedIssue: string | null;
  comments: Record<string, Array<{ id: string; user: string; text: string; time: string }>>;
  activeDropColumn: string | null;
  dropIndicator: DropIndicator | null;
  linearApiKey?: string;
  availableTeams: LinearTeam[];
  availableStatuses: LinearStatus[];
  availableProjects: LinearProject[];
};

export const linearKanbanSchema = z.object({
  title: z.string().default('Linear Kanban Board (v2)').describe('Board title'),
  teams: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    )
    .optional()
    .describe('Linear teams available to switch between'),
  statuses: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        name: z.string(),
      }),
    )
    .optional()
    .describe('Status definitions for the workflow'),
  issues: z
    .array(
      z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        status: z.string(),
        updatedAt: z.string(),
        priority: z.object({ value: z.number(), name: z.string() }).optional(),
        labels: z.array(z.string()).optional(),
        project: z.string().optional(),
        assignee: z.string().optional(),
      }),
    )
    .optional()
    .describe('Initial issues to render on the board'),
});

export type LinearKanbanProps = z.infer<typeof linearKanbanSchema> & {
  __custom_message_id?: string;
  className?: string;
};

export interface KanbanColumn {
  id: string;
  title: string;
  key: string;
}







