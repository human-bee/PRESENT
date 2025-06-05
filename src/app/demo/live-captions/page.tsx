"use client";

import { useState } from "react";
import LiveCaptions from "@/components/LiveCaptions";
import { LiveKitRoom } from "@livekit/components-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Users, Settings } from "lucide-react";

// Force client-side rendering to prevent SSG issues with Tambo hooks


export default function LiveCaptionsDemo() {
  const [roomName, setRoomName] = useState("live-captions-demo");
  const [token, setToken] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const connectToRoom = async () => {
    try {
      // Get token from your API
      const response = await fetch("/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room: roomName,
          username: `user-${Math.random().toString(36).substring(7)}`,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setToken(data.token);
        setIsConnected(true);
      } else {
        console.error("Failed to get token");
      }
    } catch (error) {
      console.error("Error connecting to room:", error);
    }
  };

  const disconnectFromRoom = () => {
    setToken("");
    setIsConnected(false);
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-4">Live Captions Demo</h1>
            <p className="text-lg text-muted-foreground mb-8">
              Experience real-time speech transcription with beautiful visual speech bubbles
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mic className="h-5 w-5" />
                  Real-time Transcription
                </CardTitle>
                <CardDescription>
                  Powered by Groq Whisper for accurate speech-to-text
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• Live interim and final transcripts</li>
                  <li>• Speaker identification</li>
                  <li>• Timestamp tracking</li>
                  <li>• Export to TXT, JSON, or SRT</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Interactive Canvas
                </CardTitle>
                <CardDescription>
                  tldraw-style interface with draggable speech bubbles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• Draggable speech bubbles</li>
                  <li>• Auto-positioning system</li>
                  <li>• Multiple canvas themes</li>
                  <li>• Persistent state management</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle>Connect to Room</CardTitle>
              <CardDescription>
                Join a LiveKit room to start capturing live captions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Room Name</label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-md bg-background"
                  placeholder="Enter room name"
                />
              </div>
              <Button onClick={connectToRoom} className="w-full">
                Connect to Room
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <LiveKitRoom
        token={token}
        serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://present-livekit-server.livekit.cloud"}
        connect={true}
        audio={true}
        video={false}
        className="h-screen"
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b bg-muted/20">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">Live Captions Demo</h1>
              <span className="text-sm text-muted-foreground">Room: {roomName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
              <Button variant="outline" size="sm" onClick={disconnectFromRoom}>
                Disconnect
              </Button>
            </div>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="p-4 border-b bg-muted/10">
              <div className="max-w-2xl">
                <h3 className="font-medium mb-3">Component Settings</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <strong>Speaker Avatars:</strong> Enabled
                  </div>
                  <div>
                    <strong>Timestamps:</strong> Enabled
                  </div>
                  <div>
                    <strong>Drag & Drop:</strong> Enabled
                  </div>
                  <div>
                    <strong>Canvas Theme:</strong> Dots
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Live Captions Component */}
          <div className="flex-1">
            <LiveCaptions
              showSpeakerAvatars={true}
              showTimestamps={true}
              enableDragAndDrop={true}
              maxTranscripts={50}
              autoPosition={true}
              exportFormat="txt"
              canvasTheme="dots"
            />
          </div>
        </div>
      </LiveKitRoom>
    </div>
  );
} 