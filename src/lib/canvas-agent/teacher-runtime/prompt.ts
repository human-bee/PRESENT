import type { BoxModel } from 'tldraw';
import type { AgentPrompt } from '../../../../vendor/tldraw-agent-template/shared/types/AgentPrompt';
import type { PromptPart } from '../../../../vendor/tldraw-agent-template/shared/types/PromptPart';
import type { MessagesPart } from '../../../../vendor/tldraw-agent-template/shared/parts/MessagesPartUtil';
import type { ScreenshotPart } from '../../../../vendor/tldraw-agent-template/shared/parts/ScreenshotPartUtil';
import type { ViewportBoundsPart } from '../../../../vendor/tldraw-agent-template/shared/parts/ViewportBoundsPartUtil';
import type { TodoListPart } from '../../../../vendor/tldraw-agent-template/shared/parts/TodoListPartUtil';
import type { ChatHistoryPart } from '../../../../vendor/tldraw-agent-template/shared/parts/ChatHistoryPartUtil';
import type { ContextItemsPart } from '../../../../vendor/tldraw-agent-template/shared/parts/ContextItemsPartUtil';
import type { DataPart } from '../../../../vendor/tldraw-agent-template/shared/parts/DataPartUtil';
import type { TimePart } from '../../../../vendor/tldraw-agent-template/shared/parts/TimePartUtil';
import type { SystemPromptPart } from '../../../../vendor/tldraw-agent-template/shared/parts/SystemPromptPartUtil';
import type { ModelNamePart } from '../../../../vendor/tldraw-agent-template/shared/parts/ModelNamePartUtil';
import type { TodoItem } from '../../../../vendor/tldraw-agent-template/shared/types/TodoItem';
import type { ContextItem } from '../../../../vendor/tldraw-agent-template/shared/types/ContextItem';
import { DEFAULT_MODEL_NAME, type AgentModelName } from '../../../../vendor/tldraw-agent-template/worker/models';

export type TeacherPromptContext = {
  userMessages: string[];
  requestType?: 'user' | 'schedule' | 'todo';
  screenshotDataUrl?: string | null;
  bounds?: BoxModel | null;
  viewport?: BoxModel | null;
  styleInstructions?: string | null;
  promptBudget?: Record<string, unknown> | null;
  modelName?: string;
  timestamp?: string;
  contextItems?: ContextItem[];
  todoItems?: TodoItem[];
  chatHistory?: ChatHistoryPart['items'];
};

type LoosePrompt = Partial<Record<PromptPart['type'], PromptPart>>;

const MODEL_ALIASES: Record<string, AgentModelName> = {
  'anthropic:claude-4.5-sonnet': 'claude-4.5-sonnet',
  'anthropic:claude-4-sonnet': 'claude-4-sonnet',
  'anthropic:claude-3.5-sonnet': 'claude-3.5-sonnet',
  'anthropic:claude-3-5-sonnet': 'claude-3.5-sonnet',
  'anthropic:claude-3-5-sonnet-20241022': 'claude-3.5-sonnet',
};

const FALLBACK_MESSAGE = 'Continue improving the canvas layout with strong hierarchy and confident composition.';

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const coerceMessages = (raw: string[]): string[] => {
  const filtered = raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
  if (filtered.length > 0) return filtered;
  return [FALLBACK_MESSAGE];
};

const resolveTeacherModelName = (raw?: string): AgentModelName => {
  if (!raw) return DEFAULT_MODEL_NAME;
  const normalized = raw.trim().toLowerCase();
  return MODEL_ALIASES[normalized] ?? DEFAULT_MODEL_NAME;
};

export function buildTeacherPrompt(context: TeacherPromptContext): AgentPrompt {
  const requestType = context.requestType ?? 'user';
  const messages = coerceMessages(context.userMessages);
  if (isNonEmptyString(context.styleInstructions)) {
    messages.push(`Brand / style guardrails (from PRESENT):\n${context.styleInstructions.trim()}`);
  }

  const parts: LoosePrompt = {
    system: { type: 'system' } satisfies SystemPromptPart,
    modelName: {
      type: 'modelName',
      name: resolveTeacherModelName(context.modelName),
    } satisfies ModelNamePart,
    messages: {
      type: 'messages',
      messages,
      requestType,
    } satisfies MessagesPart,
    screenshot: {
      type: 'screenshot',
      screenshot: context.screenshotDataUrl ?? null,
    } satisfies ScreenshotPart,
    viewportBounds: {
      type: 'viewportBounds',
      userBounds: context.viewport ?? context.bounds ?? null,
      agentBounds: context.bounds ?? context.viewport ?? null,
    } satisfies ViewportBoundsPart,
    todoList: {
      type: 'todoList',
      items: context.todoItems ?? ([] as TodoItem[]),
    } satisfies TodoListPart,
    chatHistory: {
      type: 'chatHistory',
      items: context.chatHistory ?? null,
    } satisfies ChatHistoryPart,
    contextItems: {
      type: 'contextItems',
      items: context.contextItems ?? [],
      requestType,
      // PRESENT passes shape summaries in contextItems so the vendored teacher agent gets a coarse canvas snapshot.
    } satisfies ContextItemsPart,
    data: {
      type: 'data',
      data: context.promptBudget ? [context.promptBudget as any] : [],
    } satisfies DataPart,
    time: {
      type: 'time',
      time: context.timestamp ?? new Date().toISOString(),
    } satisfies TimePart,
  };

  return parts as AgentPrompt;
}
