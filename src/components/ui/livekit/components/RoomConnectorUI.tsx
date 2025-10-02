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

  return (
    <div
      className={cn(
        'bg-white border-2 rounded-lg shadow-lg transition-all duration-200',
        connectionState === 'connected' && 'border-green-500',
        connectionState === 'connecting' && 'border-blue-500',
        connectionState === 'error' && 'border-red-500',
        connectionState === 'disconnected' && 'border-gray-300',
        isMinimized ? 'w-48 h-12' : 'w-80',
      )}
      style={{
        pointerEvents: 'all',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          {connectionState === 'connected' && <Wifi className="w-4 h-4 text-green-500" />}
          {connectionState === 'connecting' && (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          )}
          {connectionState === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
          {connectionState === 'disconnected' && <WifiOff className="w-4 h-4 text-gray-500" />}

          <span className="font-medium text-sm select-none">
            {isMinimized ? 'LiveKit' : 'LiveKit Room Connector'}
          </span>
        </div>

        <button
          onClick={onMinimize}
          className="p-1 hover:bg-gray-100 rounded cursor-pointer select-none"
          style={{ pointerEvents: 'all' }}
        >
          {isMinimized ? '▲' : '▼'}
        </button>
      </div>

      {/* Content - only show when not minimized */}
      {!isMinimized && (
        <div className="p-4 space-y-4">
          {/* Room Info */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 select-none">Room:</span>
              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded select-all">
                {roomName}
              </span>
            </div>

            {connectionState === 'connected' && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 select-none">Participants:</span>
                  <div className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span className="select-none">{participantCount}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 select-none">AI Agent:</span>
                  <div className="flex items-center gap-1.5">
                    {agentStatus === 'joined' && (
                      <>
                        <Bot className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-green-600 text-xs select-none">Connected</span>
                      </>
                    )}
                    {agentStatus === 'dispatching' && (
                      <>
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                        <span className="text-blue-600 text-xs select-none">Joining...</span>
                      </>
                    )}
                    {agentStatus === 'failed' && (
                      <>
                        <BotOff className="w-3.5 h-3.5 text-red-500" />
                        <span className="text-red-600 text-xs select-none">Failed</span>
                      </>
                    )}
                    {agentStatus === 'not-requested' && (
                      <>
                        <BotOff className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-gray-500 text-xs select-none">Not active</span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status Message */}
          {connectionState === 'error' && errorMessage && (
            <div className="text-sm text-red-600 text-center select-none break-words">
              {errorMessage}
            </div>
          )}

          {connectionState === 'connecting' && !errorMessage && (
            <div className="text-sm text-blue-600 text-center select-none">
              Connecting to room...
            </div>
          )}

          {connectionState === 'connected' && !errorMessage && (
            <div className="text-sm text-green-600 text-center flex items-center justify-center gap-1 select-none">
              <CheckCircle className="w-3.5 h-3.5" />
              Connected successfully
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={connectionState === 'connected' ? onDisconnect : onConnect}
              disabled={connectionState === 'connecting'}
              className={cn(
                'flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer select-none',
                connectionState === 'connected'
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : connectionState === 'connecting'
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600',
              )}
              style={{
                pointerEvents: connectionState === 'connecting' ? 'none' : 'all',
              }}
            >
              {connectionState === 'connected'
                ? 'Disconnect'
                : connectionState === 'connecting'
                  ? 'Connecting...'
                  : connectionState === 'error'
                    ? 'Retry'
                    : 'Connect'}
            </button>

            {connectionState === 'connected' && (
              <button
                onClick={onCopyLink}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 cursor-pointer select-none"
                title="Copy room link"
                style={{ pointerEvents: 'all' }}
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Agent Control Button */}
          {connectionState === 'connected' && agentStatus !== 'joined' && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (onRequestAgent) {
                    onRequestAgent();
                    return;
                  }

                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('livekit:request-agent', {
                        detail: { roomName },
                      }),
                    );
                  }
                }}
                disabled={agentStatus === 'dispatching'}
                className={cn(
                  'flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer select-none flex items-center justify-center gap-2',
                  agentStatus === 'dispatching'
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : agentStatus === 'failed'
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'bg-purple-500 text-white hover:bg-purple-600',
                )}
                style={{
                  pointerEvents: agentStatus === 'dispatching' ? 'none' : 'all',
                }}
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
              </button>
            </div>
          )}

          {/* Instructions */}
          {(connectionState === 'disconnected' ||
            (connectionState === 'error' &&
              !errorMessage?.includes('Missing LiveKit server URL'))) && (
            <div className="text-xs text-gray-500 text-center select-none">
              Connect to enable LiveKit features on the canvas
            </div>
          )}

          {connectionState === 'connected' && (
            <div className="text-xs text-gray-500 text-center select-none">
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
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 select-none">
              <div className="font-medium mb-1">🔧 Agent Connection Issue:</div>
              <div>{state.errorMessage}</div>
              <div className="mt-2 text-red-500 border-t border-red-200 pt-2">
                <div className="font-medium">🚨 Make sure your agent worker is running:</div>
                <code className="block bg-red-100 border border-red-300 p-1 rounded mt-1 text-xs">
                  npm run agent:dev
                </code>
                <div className="mt-1">
                  Agent dispatch only creates tokens. The actual worker connects to the room.
                </div>
              </div>
            </div>
          )}

          {/* Agent Timeout Warning */}
          {connectionState === 'connected' && agentStatus === 'dispatching' && (
            <div className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2 select-none">
              <div className="font-medium mb-1">⏰ Agent Dispatching...</div>
              <div>Waiting for agent to join the room (timeout in 30s)</div>
              <div className="mt-2 text-blue-500 border-t border-blue-200 pt-2">
                <div className="font-medium">💡 If this takes too long:</div>
                <div>
                  1. Check if agent worker is running:{' '}
                  <code className="bg-blue-100 px-1 rounded">npm run agent:dev</code>
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
