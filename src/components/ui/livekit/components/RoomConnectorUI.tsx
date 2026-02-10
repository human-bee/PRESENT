import { cn } from '@/lib/utils';
import {
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle,
  AlertCircle,
  Users,
  Copy,
  Bot,
  BotOff,
} from 'lucide-react';
import type { LivekitRoomConnectorState } from '../hooks/types';
import { Button } from '@/components/ui/shared/button';

interface RoomConnectorUIProps {
  state: LivekitRoomConnectorState | null;
  roomName: string;
  onMinimize: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onCopyLink: () => void;
  onRequestAgent?: () => void;
}

export function RoomConnectorUI({
  state,
  roomName,
  onMinimize,
  onConnect,
  onDisconnect,
  onCopyLink,
  onRequestAgent,
}: RoomConnectorUIProps) {
  const connectionState = (state?.connectionState ?? 'disconnected') as LivekitRoomConnectorState['connectionState'];
  const isMinimized = state?.isMinimized || false;
  const participantCount = state?.participantCount || 0;
  const errorMessage = state?.errorMessage || null;
  const agentStatus = state?.agentStatus || 'not-requested';
  const agentIdentity = state?.agentIdentity || null;

  const borderClass =
    connectionState === 'connected'
      ? 'border-success-surface'
      : connectionState === 'connecting'
        ? 'border-info-surface'
        : connectionState === 'error'
          ? 'border-danger-outline'
          : 'border-default';

  const stateTextClass =
    connectionState === 'connected'
      ? 'text-success'
      : connectionState === 'connecting'
        ? 'text-info'
        : connectionState === 'error'
          ? 'text-danger'
          : 'text-tertiary';

  return (
    <div
      className={cn(
        'bg-surface-elevated border-2 rounded-2xl shadow-sm transition-all duration-200',
        borderClass,
        isMinimized ? 'w-48 h-12' : 'w-80',
      )}
      style={{
        pointerEvents: 'all',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-default">
        <div className="flex items-center gap-2">
          {connectionState === 'connected' && <Wifi className={cn('w-4 h-4', stateTextClass)} />}
          {connectionState === 'connecting' && (
            <Loader2 className={cn('w-4 h-4 animate-spin', stateTextClass)} />
          )}
          {connectionState === 'error' && <AlertCircle className={cn('w-4 h-4', stateTextClass)} />}
          {connectionState === 'disconnected' && <WifiOff className={cn('w-4 h-4', stateTextClass)} />}

          <span className="font-medium text-sm select-none">
            {isMinimized ? 'LiveKit' : 'LiveKit Room Connector'}
          </span>
        </div>

        <Button variant="ghost" size="sm" onClick={onMinimize} style={{ pointerEvents: 'all' }}>
          {isMinimized ? '▲' : '▼'}
        </Button>
      </div>

      {/* Content - only show when not minimized */}
      {!isMinimized && (
        <div className="p-4 space-y-4">
          {/* Room Info */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary select-none">Room:</span>
              <span className="font-mono text-xs bg-surface-secondary border border-default px-2 py-1 rounded select-all text-secondary">
                {roomName}
              </span>
            </div>

            {connectionState === 'connected' && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-secondary select-none">Participants:</span>
                  <div className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span className="select-none">{participantCount}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-secondary select-none">AI Agent:</span>
                  <div className="flex items-center gap-1.5">
                    {agentStatus === 'joined' && (
                      <>
                        <Bot className="w-3.5 h-3.5 text-success" />
                        <span className="text-success text-xs select-none">Connected</span>
                      </>
                    )}
                    {agentStatus === 'dispatching' && (
                      <>
                        <Loader2 className="w-3.5 h-3.5 text-info animate-spin" />
                        <span className="text-info text-xs select-none">Joining...</span>
                      </>
                    )}
                    {agentStatus === 'failed' && (
                      <>
                        <BotOff className="w-3.5 h-3.5 text-danger" />
                        <span className="text-danger text-xs select-none">Failed</span>
                      </>
                    )}
                    {agentStatus === 'not-requested' && (
                      <>
                        <BotOff className="w-3.5 h-3.5 text-tertiary" />
                        <span className="text-tertiary text-xs select-none">Not active</span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status Message */}
          {connectionState === 'error' && errorMessage && (
            <div className="text-sm text-danger text-center select-none break-words">
              {errorMessage}
            </div>
          )}

          {connectionState === 'connecting' && !errorMessage && (
            <div className="text-sm text-info text-center select-none">
              Connecting to room...
            </div>
          )}

          {connectionState === 'connected' && !errorMessage && (
            <div className="text-sm text-success text-center flex items-center justify-center gap-1 select-none">
              <CheckCircle className="w-3.5 h-3.5" />
              Connected successfully
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={connectionState === 'connected' ? onDisconnect : onConnect}
              disabled={connectionState === 'connecting'}
              style={{
                pointerEvents: connectionState === 'connecting' ? 'none' : 'all',
              }}
              variant={connectionState === 'connected' ? 'destructive' : 'default'}
              className="flex-1"
            >
              {connectionState === 'connected'
                ? 'Disconnect'
                : connectionState === 'connecting'
                  ? 'Connecting...'
                  : connectionState === 'error'
                    ? 'Retry'
                    : 'Connect'}
            </Button>

            {connectionState === 'connected' && (
              <Button
                onClick={onCopyLink}
                title="Copy room link"
                style={{ pointerEvents: 'all' }}
                variant="outline"
                size="icon"
              >
                <Copy className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Agent Control Button */}
          {connectionState === 'connected' && agentStatus !== 'joined' && (
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  onRequestAgent?.();
                }}
                disabled={agentStatus === 'dispatching'}
                style={{
                  pointerEvents: agentStatus === 'dispatching' ? 'none' : 'all',
                }}
                variant={agentStatus === 'failed' ? 'outline' : 'secondary'}
                className={cn('flex-1 flex items-center justify-center gap-2', agentStatus === 'failed' && 'text-warning')}
              >
                {agentStatus === 'dispatching' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Requesting Agent...
                  </>
                ) : agentStatus === 'failed' ? (
                  <>
                    <Bot className="w-4 h-4" />
                    Retry Agent
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" />
                    Invite AI Agent
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Instructions */}
          {(connectionState === 'disconnected' ||
            (connectionState === 'error' &&
              !errorMessage?.includes('Missing LiveKit server URL'))) && (
            <div className="text-xs text-tertiary text-center select-none">
              Connect to enable LiveKit features on the canvas
            </div>
          )}

          {connectionState === 'connected' && (
            <div className="text-xs text-tertiary text-center select-none">
              {agentStatus === 'joined'
                ? `AI Agent "${agentIdentity}" is ready to assist`
                : agentStatus === 'dispatching'
                  ? 'Requesting AI agent to join...'
                  : agentStatus === 'failed'
                    ? `Agent failed: ${state?.errorMessage || "Try the 'Retry Agent' button."}`
                    : 'You can spawn participant tiles and toolbars, or invite an AI agent'}
            </div>
          )}

          {/* Agent Error Details */}
          {connectionState === 'connected' && agentStatus === 'failed' && state?.errorMessage && (
            <div className="text-xs text-danger bg-danger-surface border border-danger-outline rounded p-2 select-none">
              <div className="font-medium mb-1">Agent Connection Issue:</div>
              <div>{state.errorMessage}</div>
              <div className="mt-2 border-t border-danger-outline pt-2 text-danger">
                <div className="font-medium">Make sure your agent worker is running:</div>
                <code className="mt-1 block rounded border border-default bg-surface-secondary p-1 text-xs text-secondary">
                  npm run agent:realtime
                </code>
                <div className="mt-1">
                  Agent dispatch only creates tokens. The actual worker connects to the room.
                </div>
              </div>
            </div>
          )}

          {/* Agent Timeout Warning */}
          {connectionState === 'connected' && agentStatus === 'dispatching' && (
            <div className="text-xs text-info bg-info-surface border border-info-surface rounded p-2 select-none">
              <div className="font-medium mb-1">Agent Dispatching...</div>
              <div>Waiting for agent to join the room (timeout in 30s)</div>
              <div className="mt-2 border-t border-info-surface pt-2 text-info">
                <div className="font-medium">If this takes too long:</div>
                <div>
                  1. Check if agent worker is running:{' '}
                  <code className="rounded border border-default bg-surface-secondary px-1 text-secondary">
                    npm run agent:realtime
                  </code>
                </div>
                <div>2. Check the terminal for agent connection logs</div>
                <div>3. Verify your .env.local has all LiveKit credentials</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
