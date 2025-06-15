"use client";

import React, { useState, useEffect } from "react";
import { Room, RoomEvent, ConnectionState } from "livekit-client";

/**
 * Simple test page to test LiveKit agent automatic dispatch
 * No authentication required - just for testing purposes
 */
export default function TestAgent() {
  const [room] = useState(() => new Room());
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");
  const [roomName] = useState("test-agent-room");
  const [logs, setLogs] = useState<string[]>([]);
  
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 9)]);
    console.log(`[TestAgent] ${message}`);
  };

  const connectToRoom = async () => {
    try {
      addLog("🔄 Requesting LiveKit token...");
      
      // Get a token from our API
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: roomName,
          participantName: 'Test User'
        })
      });
      
      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`);
      }
      
      const { token, wsUrl } = await response.json();
      addLog(`✅ Got token, connecting to: ${wsUrl}`);
      
      // Connect to LiveKit room
      await room.connect(wsUrl, token);
      addLog(`🎉 Connected to room: ${roomName}`);
      
    } catch (error) {
      addLog(`❌ Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const disconnectFromRoom = () => {
    room.disconnect();
    addLog("🔌 Disconnected from room");
  };

  useEffect(() => {
    // Set up room event listeners
    room.on(RoomEvent.Connected, () => {
      setConnectionStatus("connected");
      addLog("✅ Room connected event fired");
    });
    
    room.on(RoomEvent.Disconnected, () => {
      setConnectionStatus("disconnected");
      addLog("🔌 Room disconnected event fired");
    });
    
    room.on(RoomEvent.Reconnecting, () => {
      setConnectionStatus("reconnecting");
      addLog("🔄 Room reconnecting...");
    });
    
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      addLog(`👤 Participant joined: ${participant.identity} (${participant.name || 'unnamed'})`);
    });
    
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      addLog(`👋 Participant left: ${participant.identity}`);
    });
    
    room.on(RoomEvent.DataReceived, (data, participant) => {
      try {
        const message = new TextDecoder().decode(data);
        addLog(`💬 Data from ${participant?.identity}: ${message}`);
      } catch (error) {
        addLog(`💬 Binary data from ${participant?.identity}: ${data.byteLength} bytes`);
      }
    });
    
    return () => {
      room.disconnect();
    };
  }, [room]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-gray-900">
          🤖 LiveKit Agent Automatic Dispatch Test
        </h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-gray-600">Room: <strong>{roomName}</strong></p>
              <p className="text-gray-600">Status: 
                <span className={`ml-2 px-2 py-1 rounded text-sm ${
                  connectionStatus === 'connected' ? 'bg-green-100 text-green-800' :
                  connectionStatus === 'reconnecting' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {connectionStatus}
                </span>
              </p>
            </div>
            
            <div className="space-x-4">
              <button
                onClick={connectToRoom}
                disabled={connectionStatus === 'connected'}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                Connect to Room
              </button>
              
              <button
                onClick={disconnectFromRoom}
                disabled={connectionStatus === 'disconnected'}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
              >
                Disconnect
              </button>
            </div>
          </div>
          
          <div className="text-sm text-gray-500">
            <p><strong>Expected behavior:</strong> When you connect, the clean agent should automatically join this room!</p>
            <p>Check the agent worker logs in the terminal for: <code>🎉 AGENT AUTOMATIC DISPATCH WORKING! 🎉</code></p>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Event Logs</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm h-64 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-500">No events yet. Click "Connect to Room" to start testing.</p>
            ) : (
              logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 