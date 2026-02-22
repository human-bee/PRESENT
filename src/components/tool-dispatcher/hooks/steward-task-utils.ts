const readTrimmed = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

export type DispatchRoomResolution = {
  targetRoom: string;
  roomFromCall: string;
  activeRoomName: string;
  hasRoomMismatch: boolean;
};

export const resolveDispatchRoom = (input: {
  callRoomId?: string | null;
  activeRoomName?: string | null;
}): DispatchRoomResolution => {
  const roomFromCall = readTrimmed(input.callRoomId);
  const activeRoomName = readTrimmed(input.activeRoomName);
  return {
    targetRoom: roomFromCall || activeRoomName,
    roomFromCall,
    activeRoomName,
    hasRoomMismatch:
      roomFromCall.length > 0 &&
      activeRoomName.length > 0 &&
      roomFromCall !== activeRoomName,
  };
};

export const readTaskTraceId = (taskRecord: Record<string, unknown> | null): string | undefined => {
  if (!taskRecord) return undefined;
  const camelTrace = readTrimmed(taskRecord.traceId);
  if (camelTrace) return camelTrace;
  const snakeTrace = readTrimmed(taskRecord.trace_id);
  return snakeTrace || undefined;
};

export const hasExceededServerErrorBudget = (
  consecutiveServerErrorCount: number,
  maxServerErrors: number,
): boolean => consecutiveServerErrorCount >= maxServerErrors;
