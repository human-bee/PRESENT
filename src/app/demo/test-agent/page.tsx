"use client";

import React, { useState, useEffect } from "react";
import { Room, RoomEvent } from "livekit-client";

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
      
      // Get a token from our API using GET with query parameters
      const params = new URLSearchParams({
        roomName: roomName,
        identity: 'test-user',
        name: 'Test User'
      });
      
      const response = await fetch(`/api/token?${params.toString()}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token request failed: ${response.status} - ${errorText}`);
      }
      
      const { accessToken } = await response.json();
      const wsUrl = process.env.NEXT_PUBLIC_LK_SERVER_URL || 'wss://localhost:7880';
      addLog(`✅ Got token, connecting to: ${wsUrl}`);
      
      // Add comprehensive WebRTC debugging
      addLog("🔍 Checking WebRTC support...");
      addLog(`Browser: ${navigator.userAgent}`);
      addLog(`RTCPeerConnection: ${!!window.RTCPeerConnection}`);
      addLog(`getUserMedia: ${!!(navigator.mediaDevices?.getUserMedia)}`);
      addLog(`WebRTC APIs: ${JSON.stringify({
        RTCPeerConnection: !!window.RTCPeerConnection,
        RTCSessionDescription: !!window.RTCSessionDescription,
        RTCIceCandidate: !!window.RTCIceCandidate,
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: !!(navigator.mediaDevices?.getUserMedia)
      })}`);
      
      if (!window.RTCPeerConnection) {
        throw new Error("RTCPeerConnection not available - WebRTC not supported");
      }
      
      addLog("🔗 All WebRTC APIs detected, attempting LiveKit connection...");
      
      // Connect to LiveKit room with timeout and detailed error handling
      const connectPromise = room.connect(wsUrl, accessToken).catch((lkError) => {
        // Log the original LiveKit error details
        addLog(`🔍 LiveKit Error Details: ${JSON.stringify({
          message: lkError.message,
          name: lkError.name,
          stack: lkError.stack?.split('\n')[0] // Just first line of stack
        })}`);
        throw lkError;
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timeout after 30 seconds")), 30000)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      addLog(`🎉 Connected to room: ${roomName}`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog(`❌ Connection failed: ${errorMessage}`);
      
      // Add specific debugging for common issues
      if (errorMessage.includes("doesn't seem to be supported")) {
        addLog("💡 Try: 1) Update your browser 2) Disable ad blockers 3) Check if WebRTC is enabled");
        addLog("💡 Open browser console for more details");
      }
    }
  };

  const disconnectFromRoom = () => {
    room.disconnect();
    addLog("🔌 Disconnected from room");
  };

  const testWebRTC = async () => {
    try {
      addLog("🧪 Testing WebRTC capabilities...");
      
      // Log all possible WebRTC API variations
      addLog(`🔍 Window APIs: ${JSON.stringify({
        RTCPeerConnection: typeof window.RTCPeerConnection,
        webkitRTCPeerConnection: typeof (window as any).webkitRTCPeerConnection,
        mozRTCPeerConnection: typeof (window as any).mozRTCPeerConnection,
        RTCSessionDescription: typeof window.RTCSessionDescription,
        RTCIceCandidate: typeof window.RTCIceCandidate,
        location: window.location.protocol
      })}`);
      
      // Check if we're on HTTPS
      const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
      addLog(`🔒 Secure context: ${isSecure} (${window.location.protocol}//${window.location.host})`);
      
      // Try different RTCPeerConnection constructors
      let RTCPeerConnectionConstructor = window.RTCPeerConnection || 
                                        (window as any).webkitRTCPeerConnection || 
                                        (window as any).mozRTCPeerConnection;
                                        
      if (!RTCPeerConnectionConstructor) {
        addLog("❌ No RTCPeerConnection constructor found");
        addLog("🔍 Available constructors:", Object.getOwnPropertyNames(window).filter(name => name.includes('RTC')));
        return;
      }
      
      addLog(`✅ Found RTCPeerConnection: ${RTCPeerConnectionConstructor.name}`);
      
      // Try to create a peer connection
      const pc = new RTCPeerConnectionConstructor();
      addLog("✅ Can create RTCPeerConnection");
      addLog(`📊 ICE connection state: ${pc.iceConnectionState}`);
      pc.close();
      
      // Test getUserMedia
      if (!navigator.mediaDevices?.getUserMedia) {
        addLog("❌ getUserMedia not available");
        return;
      }
      addLog("✅ getUserMedia available");
      
      addLog("🎉 WebRTC appears to be working!");
      
    } catch (error) {
      addLog(`❌ WebRTC test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      addLog(`🔍 Error details: ${JSON.stringify({
        name: (error as Error)?.name,
        message: (error as Error)?.message,
        stack: (error as Error)?.stack?.split('\n')[0]
      })}`);
    }
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
      } catch {
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
                onClick={testWebRTC}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                Test WebRTC
              </button>
              
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
              <p className="text-gray-500">No events yet. Click &ldquo;Connect to Room&rdquo; to start testing.</p>
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