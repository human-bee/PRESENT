/**
 * CanvasPage
 *
 * Core collaborative workspace for authenticated users.
 * Handles authentication redirect, initializes LiveKit for real-time audio/video and data sync, loads MCP server configs, and composes the main canvas UI with chat, controls, and agent integrations.
 */

"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Room, ConnectionState, RoomEvent, VideoPresets, RoomOptions } from "livekit-client";
import { RoomContext } from "@livekit/components-react";
import dynamic from "next/dynamic";
import { CanvasLiveKitContext } from "@/components/ui/livekit-canvas-context";

const CanvasSpaceSingleComponent = dynamic(() => import("@/components/ui/hackathon/canvas-space-single-component").then(m => m.default), { ssr: false });

export default function Canvas() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [room] = useState(() => {
    const roomOptions: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
        facingMode: 'user',
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    };
    return new Room(roomOptions);
  });

  const [roomState, setRoomState] = useState({
    isConnected: false,
    roomName: "tambo-canvas-room",
    participantCount: 0,
  });

  useEffect(() => {
    const updateRoomState = () => {
      setRoomState({
        isConnected: room.state === ConnectionState.Connected,
        roomName: "tambo-canvas-room",
        participantCount: room.numParticipants,
      });
    };

    room.on(RoomEvent.Connected, updateRoomState);
    room.on(RoomEvent.Disconnected, updateRoomState);
    room.on(RoomEvent.ParticipantConnected, updateRoomState);
    room.on(RoomEvent.ParticipantDisconnected, updateRoomState);

    return () => {
      room.off(RoomEvent.Connected, updateRoomState);
      room.off(RoomEvent.Disconnected, updateRoomState);
      room.off(RoomEvent.ParticipantConnected, updateRoomState);
      room.off(RoomEvent.ParticipantDisconnected, updateRoomState);
      room.disconnect();
    };
  }, [room]);

  useEffect(() => {
    if (loading) return;
    if (!user) router.push("/auth/signin");
  }, [loading, user, router]);

  if (loading) return null;
  if (!user) return null;

  return (
    <RoomContext.Provider value={room}>
      <CanvasLiveKitContext.Provider value={roomState}>
        <CanvasSpaceSingleComponent />
      </CanvasLiveKitContext.Provider>
    </RoomContext.Provider>
  );
}
