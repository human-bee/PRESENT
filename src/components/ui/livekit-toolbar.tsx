"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";
import {
  useLocalParticipant,
  useParticipants,
  useTrackToggle,
  useIsMuted,
  useConnectionQualityIndicator,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  MessageSquare,
  Hand,
  UserPlus,
  Settings,
  Users,
  Signal,
  SignalLow,
  SignalMedium,
  SignalHigh,
  Sparkles,
  LayoutGrid,
  Circle,
  Square,
  X,
  ChevronUp,
  ChevronDown,
  Volume2,
  Loader,
  Maximize2,
  Accessibility,
} from "lucide-react";

// Define custom icons for recording states
const Record = ({ className }: { className?: string }) => (
  <Circle className={cn("fill-current", className)} />
);

const RecordStop = ({ className }: { className?: string }) => (
  <Square className={cn("fill-current", className)} />
);

const StopScreenShare = ({ className }: { className?: string }) => (
  <div className="relative">
    <ScreenShare className={className} />
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-full h-0.5 bg-current rotate-45" />
    </div>
  </div>
);

// Define the component props schema with Zod
export const livekitToolbarSchema = z.object({
  // Toolbar Configuration
  minimal: z.boolean().optional().describe("Whether to show minimal or verbose mode (default: false)"),
  controls: z.object({
    microphone: z.boolean().optional().describe("Show microphone toggle (default: true)"),
    camera: z.boolean().optional().describe("Show camera toggle (default: true)"),
    screenShare: z.boolean().optional().describe("Show screen share toggle (default: true)"),
    chat: z.boolean().optional().describe("Show chat toggle (default: true)"),
    raiseHand: z.boolean().optional().describe("Show raise hand toggle (default: true)"),
    invite: z.boolean().optional().describe("Show invite button (default: true)"),
    settings: z.boolean().optional().describe("Show settings button (default: true)"),
    participants: z.boolean().optional().describe("Show participants button (default: true)"),
    recording: z.boolean().optional().describe("Show recording controls (default: true)"),
    layout: z.boolean().optional().describe("Show layout controls (default: true)"),
    assistant: z.boolean().optional().describe("Show AI assistant controls (default: true)"),
    accessibility: z.boolean().optional().describe("Show accessibility controls (default: true)"),
    leave: z.boolean().optional().describe("Show leave call button (default: true)"),
  }).optional().describe("Configure which controls to show"),
  
  // Initial States
  initialStates: z.object({
    micEnabled: z.boolean().optional().describe("Initial microphone state (default: true)"),
    cameraEnabled: z.boolean().optional().describe("Initial camera state (default: true)"),
    screenShareEnabled: z.boolean().optional().describe("Initial screen share state (default: false)"),
    isRecording: z.boolean().optional().describe("Initial recording state (default: false)"),
    handRaised: z.boolean().optional().describe("Initial hand raised state (default: false)"),
    layoutMode: z.enum(["grid", "focus"]).optional().describe("Initial layout mode (default: 'grid')"),
    assistantState: z.enum(["idle", "listening", "thinking", "speaking"]).optional().describe("Initial assistant state (default: 'idle')"),
  }).optional().describe("Initial states for toolbar controls"),
  
  // Room Info
  roomInfo: z.object({
    participantCount: z.number().optional().describe("Number of participants in the room"),
    unreadMessages: z.number().optional().describe("Number of unread chat messages"),
    connectionQuality: z.enum(["poor", "good", "excellent"]).optional().describe("Connection quality (poor, good, excellent)"),
    roomName: z.string().optional().describe("Name of the current room"),
  }).optional().describe("Current room information"),
});

// Define the props type based on the Zod schema
export type LivekitToolbarProps = z.infer<typeof livekitToolbarSchema>;

// Component state type
type LivekitToolbarState = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  isRecording: boolean;
  handRaised: boolean;
  layoutMode: "grid" | "focus";
  assistantState: "idle" | "listening" | "thinking" | "speaking";
  expanded: boolean;
  connectionQuality: 0 | 1 | 2 | 3; // 0=poor, 1=fair, 2=good, 3=excellent
  participantCount: number;
  unreadMessages: number;
};

/**
 * LivekitToolbar Component
 *
 * A comprehensive video conferencing toolbar with all standard LiveKit controls
 * including media controls, communication features, room management, and AI assistant integration.
 */
export function LivekitToolbar({
  minimal = false,
  controls = {},
  initialStates = {},
  roomInfo = {},
}: LivekitToolbarProps) {
  // Initialize Tambo component state
  const [state, setState] = useTamboComponentState<LivekitToolbarState>(
    "livekit-toolbar",
    {
      micEnabled: initialStates.micEnabled ?? true,
      cameraEnabled: initialStates.cameraEnabled ?? true,
      screenShareEnabled: initialStates.screenShareEnabled ?? false,
      isRecording: initialStates.isRecording ?? false,
      handRaised: initialStates.handRaised ?? false,
      layoutMode: initialStates.layoutMode ?? "grid",
      assistantState: initialStates.assistantState ?? "idle",
      expanded: !minimal,
      connectionQuality: roomInfo.connectionQuality === "poor" ? 0 : 
                        roomInfo.connectionQuality === "good" ? 2 : 
                        roomInfo.connectionQuality === "excellent" ? 3 : 3,
      participantCount: roomInfo.participantCount ?? 0,
      unreadMessages: roomInfo.unreadMessages ?? 0,
    }
  );

  // Default control configuration
  const defaultControls = {
    microphone: true,
    camera: true,
    screenShare: true,
    chat: true,
    raiseHand: true,
    invite: true,
    settings: true,
    participants: true,
    recording: true,
    layout: true,
    assistant: true,
    accessibility: true,
    leave: true,
    ...controls,
  };

  // Handle control actions
  const handleToggleMic = () => {
    if (!state) return;
    setState({ ...state, micEnabled: !state.micEnabled });
  };

  const handleToggleCamera = () => {
    if (!state) return;
    setState({ ...state, cameraEnabled: !state.cameraEnabled });
  };

  const handleToggleScreenShare = () => {
    if (!state) return;
    setState({ ...state, screenShareEnabled: !state.screenShareEnabled });
  };

  const handleToggleChat = () => {
    if (!state) return;
    setState({ ...state, unreadMessages: 0 });
  };

  const handleToggleRaiseHand = () => {
    if (!state) return;
    setState({ ...state, handRaised: !state.handRaised });
  };

  const handleToggleRecording = () => {
    if (!state) return;
    setState({ ...state, isRecording: !state.isRecording });
  };

  const handleToggleLayout = (layout: "grid" | "focus") => {
    if (!state) return;
    setState({ ...state, layoutMode: layout });
  };

  const handleToggleAssistant = () => {
    if (!state) return;
    const states: ("idle" | "listening" | "thinking" | "speaking")[] = ["idle", "listening", "thinking", "speaking"];
    const currentIndex = states.indexOf(state.assistantState);
    const nextIndex = (currentIndex + 1) % states.length;
    setState({ ...state, assistantState: states[nextIndex] });
  };

  const handleExpandToggle = () => {
    if (!state) return;
    setState({ ...state, expanded: !state.expanded });
  };

  // Connection quality icon based on signal strength
  const ConnectionQualityIcon = React.useMemo(() => {
    switch (state?.connectionQuality) {
      case 0: return Signal;
      case 1: return SignalLow;
      case 2: return SignalMedium;
      case 3: return SignalHigh;
      default: return SignalHigh;
    }
  }, [state?.connectionQuality]);

  // Assistant state indicator
  const renderAssistantState = () => {
    switch (state?.assistantState) {
      case "listening":
        return (
          <div className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-500">Listening</span>
          </div>
        );
      case "thinking":
        return (
          <div className="flex items-center gap-1.5">
            <Loader className="w-3.5 h-3.5 text-amber-500 animate-spin" />
            <span className="text-xs text-amber-500">Thinking</span>
          </div>
        );
      case "speaking":
        return (
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
            <span className="text-xs text-blue-500">Speaking</span>
          </div>
        );
      default:
        return null;
    }
  };

  // Tooltip component (simple implementation)
  const Tooltip = ({ content, children }: { content: string; children: React.ReactNode }) => (
    <div className="relative group">
      {children}
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        {content}
      </div>
    </div>
  );

  // Badge component
  const Badge = ({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "destructive" }) => (
    <span className={cn(
      "inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium",
      variant === "destructive" ? "bg-red-500 text-white" : "bg-gray-100 text-gray-900"
    )}>
      {children}
    </span>
  );

  // Button component
  const Button = ({ 
    children, 
    variant = "outline", 
    size = "icon", 
    onClick, 
    className,
    ...props 
  }: { 
    children: React.ReactNode; 
    variant?: "outline" | "default" | "destructive"; 
    size?: "icon" | "sm"; 
    onClick?: () => void;
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background",
        variant === "outline" && "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "destructive" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        size === "icon" && "h-9 w-9",
        size === "sm" && "h-8 px-3",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );

  return (
    <div className="w-full bg-background border border-border rounded-xl flex flex-col shadow-lg">
      {/* Expandable header for minimal mode */}
      {minimal && (
        <div 
          className="w-full flex justify-center py-1 cursor-pointer hover:bg-accent/50 rounded-t-xl"
          onClick={handleExpandToggle}
        >
          {state?.expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      )}

      {/* Main toolbar content */}
      {(!minimal || state?.expanded) && (
        <div className="flex items-center justify-between gap-2 p-2 flex-wrap">
          {/* Media Controls Group */}
          {(defaultControls.microphone || defaultControls.camera || defaultControls.screenShare) && (
            <div className="flex items-center gap-1">
              {defaultControls.microphone && (
                <Tooltip content={state?.micEnabled ? "Mute microphone" : "Unmute microphone"}>
                  <Button
                    variant={state?.micEnabled ? "outline" : "destructive"}
                    onClick={handleToggleMic}
                  >
                    {state?.micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  </Button>
                </Tooltip>
              )}

              {defaultControls.camera && (
                <Tooltip content={state?.cameraEnabled ? "Turn off camera" : "Turn on camera"}>
                  <Button
                    variant={state?.cameraEnabled ? "outline" : "destructive"}
                    onClick={handleToggleCamera}
                  >
                    {state?.cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                </Tooltip>
              )}

              {defaultControls.screenShare && (
                <Tooltip content={state?.screenShareEnabled ? "Stop sharing screen" : "Share screen"}>
                  <Button
                    variant={state?.screenShareEnabled ? "default" : "outline"}
                    onClick={handleToggleScreenShare}
                  >
                    {state?.screenShareEnabled ? <StopScreenShare className="h-4 w-4" /> : <ScreenShare className="h-4 w-4" />}
                  </Button>
                </Tooltip>
              )}
            </div>
          )}

          {/* Communication Controls */}
          {(defaultControls.chat || defaultControls.raiseHand || defaultControls.invite) && (
            <div className="flex items-center gap-1">
              {defaultControls.chat && (
                <Tooltip content="Chat">
                  <Button variant="outline" onClick={handleToggleChat} className="relative">
                    <MessageSquare className="h-4 w-4" />
                    {(state?.unreadMessages ?? 0) > 0 && (
                      <div className="absolute -top-1 -right-1">
                        <Badge variant="destructive">
                          {(state?.unreadMessages ?? 0) > 9 ? '9+' : state?.unreadMessages}
                        </Badge>
                      </div>
                    )}
                  </Button>
                </Tooltip>
              )}

              {defaultControls.raiseHand && (
                <Tooltip content={state?.handRaised ? "Lower hand" : "Raise hand"}>
                  <Button
                    variant={state?.handRaised ? "default" : "outline"}
                    onClick={handleToggleRaiseHand}
                  >
                    <Hand className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}

              {defaultControls.invite && (
                <Tooltip content="Invite participants">
                  <Button variant="outline">
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}
            </div>
          )}

          {/* Room Management */}
          {(defaultControls.settings || defaultControls.participants) && (
            <div className="flex items-center gap-1">
              {defaultControls.settings && (
                <Tooltip content="Settings">
                  <Button variant="outline">
                    <Settings className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}

              {defaultControls.participants && (
                <Tooltip content="Participants">
                  <Button variant="outline" className="relative">
                    <Users className="h-4 w-4" />
                    {(state?.participantCount ?? 0) > 0 && (
                      <div className="absolute -top-1 -right-1">
                        <Badge>
                          {(state?.participantCount ?? 0) > 99 ? '99+' : state?.participantCount}
                        </Badge>
                      </div>
                    )}
                  </Button>
                </Tooltip>
              )}

              <Tooltip content={`Connection: ${['Poor', 'Fair', 'Good', 'Excellent'][state?.connectionQuality ?? 3]}`}>
                <div className="h-9 w-9 flex items-center justify-center">
                  <ConnectionQualityIcon className={cn(
                    "h-4 w-4",
                    (state?.connectionQuality ?? 3) === 0 && "text-red-500",
                    (state?.connectionQuality ?? 3) === 1 && "text-amber-500",
                    (state?.connectionQuality ?? 3) === 2 && "text-emerald-500",
                    (state?.connectionQuality ?? 3) === 3 && "text-emerald-500"
                  )} />
                </div>
              </Tooltip>
            </div>
          )}

          {/* Voice Assistant & Layout Controls */}
          {(defaultControls.assistant || defaultControls.layout) && (
            <div className="flex items-center gap-1">
              {defaultControls.assistant && state?.assistantState !== "idle" && (
                <div className="px-2 py-1 bg-background border border-border rounded-md">
                  {renderAssistantState()}
                </div>
              )}

              {defaultControls.assistant && (
                <Tooltip content="AI Assistant">
                  <Button
                    variant={state?.assistantState !== "idle" ? "default" : "outline"}
                    onClick={handleToggleAssistant}
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}

              {defaultControls.layout && (
                <div className="flex border border-border rounded-md">
                  <Tooltip content="Grid layout">
                    <Button
                      variant={state?.layoutMode === "grid" ? "default" : "outline"}
                      onClick={() => handleToggleLayout("grid")}
                      className="rounded-r-none border-0"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Focus layout">
                    <Button
                      variant={state?.layoutMode === "focus" ? "default" : "outline"}
                      onClick={() => handleToggleLayout("focus")}
                      className="rounded-l-none border-0"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>
          )}

          {/* Recording & Exit Controls */}
          {(defaultControls.recording || defaultControls.accessibility || defaultControls.leave) && (
            <div className="flex items-center gap-1">
              {defaultControls.recording && (
                <Tooltip content={state?.isRecording ? "Stop recording" : "Start recording"}>
                  <Button
                    variant={state?.isRecording ? "destructive" : "outline"}
                    onClick={handleToggleRecording}
                  >
                    {state?.isRecording ? <RecordStop className="h-4 w-4" /> : <Record className="h-4 w-4" />}
                  </Button>
                </Tooltip>
              )}

              {defaultControls.accessibility && (
                <Tooltip content="Accessibility options">
                  <Button variant="outline">
                    <Accessibility className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}

              {defaultControls.leave && (
                <Tooltip content="Leave call">
                  <Button variant="destructive">
                    <X className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Default export for convenience
export default LivekitToolbar; 