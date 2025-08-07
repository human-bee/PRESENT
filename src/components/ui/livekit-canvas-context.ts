"use client";

import React from "react";

export const CanvasLiveKitContext = React.createContext<{
  isConnected: boolean;
  roomName: string;
  participantCount: number;
} | null>(null);