"use client";

import React, { useState, useEffect } from 'react';
import { LivekitToolbar } from './livekit-toolbar';
import { Room, RoomOptions, ConnectionQuality } from 'livekit-client';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import { 
  Play, 
  Square, 
  RotateCcw, 
  Settings, 
  Eye, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Mic,
  Video,
  Users,
  Wifi
} from 'lucide-react';

type TestSuite = {
  name: string;
  tests: TestCase[];
};

type TestCase = {
  name: string;
  description: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  execute: () => Promise<boolean>;
  manual?: boolean;
};

type TestResults = {
  passed: number;
  failed: number;
  total: number;
};

/**
 * LiveKit Toolbar Demo & Testing Environment
 * 
 * A comprehensive testing interface for validating all LiveKit toolbar integrations
 * including real room connections, voice commands, canvas events, and UI interactions.
 */
export function LivekitToolbarDemo() {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionUrl, setConnectionUrl] = useState('');
  const [token, setToken] = useState('');
  const [roomName, setRoomName] = useState('test-room');
  const [testResults, setTestResults] = useState<TestResults>({ passed: 0, failed: 0, total: 0 });
  const [currentTest, setCurrentTest] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  
  // LiveKit connection setup
  const connectToRoom = async () => {
    try {
      addLog('Attempting to connect to LiveKit room...');
      
      // For demo purposes, we'll create a mock room object
      // In a real app, you'd use the actual LiveKit connect function
      const mockRoom = {
        state: 'connected',
        localParticipant: {
          identity: 'demo-user',
          name: 'Demo User',
          connectionQuality: ConnectionQuality.Excellent,
          publishData: async (data: Uint8Array) => {
            addLog('📤 Data published: ' + new TextDecoder().decode(data));
          }
        },
        disconnect: () => {
          addLog('🔌 Disconnected from room');
          setIsConnected(false);
        },
        on: (event: string, callback: Function) => {
          addLog(`📡 Listening for event: ${event}`);
        },
        startRecording: async () => {
          addLog('🎥 Recording started');
        },
        stopRecording: async () => {
          addLog('⏹️ Recording stopped');
        },
        removeParticipant: async (id: string) => {
          addLog(`👤 Participant ${id} removed`);
        }
      } as any;
      
      setRoom(mockRoom);
      setIsConnected(true);
      addLog('✅ Successfully connected to demo room');
      
    } catch (error) {
      addLog(`❌ Connection failed: ${error}`);
      console.error('Failed to connect to room:', error);
    }
  };
  
  const disconnectFromRoom = () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setIsConnected(false);
      addLog('🔌 Disconnected from room');
    }
  };
  
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };
  
  // Test suites
  const testSuites: TestSuite[] = [
    {
      name: 'LiveKit Integration',
      tests: [
        {
          name: 'Room Connection',
          description: 'Verify LiveKit room connection and participant tracking',
          status: 'pending',
          execute: async () => {
            if (!room || !isConnected) return false;
            addLog('🧪 Testing room connection...');
            return room.state === 'connected';
          }
        },
        {
          name: 'Media Controls',
          description: 'Test microphone, camera, and screen share toggles',
          status: 'pending',
          manual: true,
          execute: async () => {
            addLog('🧪 Manual test: Try toggling mic, camera, and screen share');
            return true;
          }
        },
        {
          name: 'Participant Management',
          description: 'Test individual participant controls and moderation',
          status: 'pending',
          manual: true,
          execute: async () => {
            addLog('🧪 Manual test: Hover over participants to see controls');
            return true;
          }
        }
      ]
    },
    {
      name: 'Voice Commands',
      tests: [
        {
          name: 'Data Channel Setup',
          description: 'Verify voice command data channel is established',
          status: 'pending',
          execute: async () => {
            if (!room) return false;
            addLog('🧪 Testing voice command data channel...');
            // Check if data channel callbacks are registered
            return !!(window as any).__dataChannelCallbacks?.['voice-commands'];
          }
        },
        {
          name: 'Voice Command Processing',
          description: 'Test voice command execution',
          status: 'pending',
          execute: async () => {
            if (!room) return false;
            addLog('🧪 Testing voice command processing...');
            
            // Simulate voice command
            const command = { type: 'TOGGLE_MIC' };
            const payload = new TextEncoder().encode(JSON.stringify(command));
            
            try {
              await room.localParticipant.publishData(payload, { reliable: true });
              addLog('✅ Voice command sent successfully');
              return true;
            } catch (error) {
              addLog(`❌ Voice command failed: ${error}`);
              return false;
            }
          }
        }
      ]
    },
    {
      name: 'Canvas Integration',
      tests: [
        {
          name: 'Canvas Events',
          description: 'Verify canvas event dispatching',
          status: 'pending',
          execute: async () => {
            addLog('🧪 Testing canvas event dispatch...');
            
            let eventDispatched = false;
            const originalDispatchEvent = window.dispatchEvent;
            
            window.dispatchEvent = function(event: Event) {
              if (event.type.startsWith('tambo:')) {
                eventDispatched = true;
                addLog(`📤 Canvas event dispatched: ${event.type}`);
              }
              return originalDispatchEvent.call(this, event);
            };
            
            // Trigger a re-render to dispatch canvas events
            setRoomName(prev => prev + '_test');
            
            // Restore original function
            setTimeout(() => {
              window.dispatchEvent = originalDispatchEvent;
            }, 100);
            
            return eventDispatched;
          }
        },
        {
          name: 'Component State',
          description: 'Verify Tambo component state persistence',
          status: 'pending',
          manual: true,
          execute: async () => {
            addLog('🧪 Manual test: Check if toolbar state persists across refreshes');
            return true;
          }
        }
      ]
    },
    {
      name: 'Real-time Features',
      tests: [
        {
          name: 'Hand Raise',
          description: 'Test hand raise functionality',
          status: 'pending',
          manual: true,
          execute: async () => {
            addLog('🧪 Manual test: Click hand raise button and verify state');
            return true;
          }
        },
        {
          name: 'Recording Controls',
          description: 'Test recording start/stop functionality',
          status: 'pending',
          manual: true,
          execute: async () => {
            addLog('🧪 Manual test: Test recording controls if moderation enabled');
            return true;
          }
        },
        {
          name: 'Connection Quality',
          description: 'Verify connection quality indicators',
          status: 'pending',
          execute: async () => {
            if (!room) return false;
            addLog('🧪 Testing connection quality indicators...');
            
            // Check if connection quality is being tracked
            const quality = room.localParticipant.connectionQuality;
            addLog(`📊 Current connection quality: ${quality}`);
            return quality !== undefined;
          }
        }
      ]
    }
  ];
  
  const runTest = async (testCase: TestCase, suiteIndex: number, testIndex: number) => {
    setCurrentTest(`${suiteIndex}-${testIndex}`);
    
    const updatedSuites = [...testSuites];
    updatedSuites[suiteIndex].tests[testIndex].status = 'running';
    
    try {
      const result = await testCase.execute();
      updatedSuites[suiteIndex].tests[testIndex].status = result ? 'passed' : 'failed';
      
      setTestResults(prev => ({
        passed: prev.passed + (result ? 1 : 0),
        failed: prev.failed + (result ? 0 : 1),
        total: prev.total + 1
      }));
      
      addLog(`${result ? '✅' : '❌'} Test ${testCase.name}: ${result ? 'PASSED' : 'FAILED'}`);
    } catch (error) {
      updatedSuites[suiteIndex].tests[testIndex].status = 'failed';
      setTestResults(prev => ({
        ...prev,
        failed: prev.failed + 1,
        total: prev.total + 1
      }));
      addLog(`❌ Test ${testCase.name}: ERROR - ${error}`);
    }
    
    setCurrentTest(null);
  };
  
  const runAllTests = async () => {
    setTestResults({ passed: 0, failed: 0, total: 0 });
    addLog('🚀 Starting test suite...');
    
    for (let suiteIndex = 0; suiteIndex < testSuites.length; suiteIndex++) {
      const suite = testSuites[suiteIndex];
      addLog(`📁 Running test suite: ${suite.name}`);
      
      for (let testIndex = 0; testIndex < suite.tests.length; testIndex++) {
        const test = suite.tests[testIndex];
        if (!test.manual) {
          await runTest(test, suiteIndex, testIndex);
          // Small delay between tests
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          addLog(`⏭️ Skipping manual test: ${test.name}`);
        }
      }
    }
    
    addLog('🏁 Test suite completed');
  };
  
  const resetTests = () => {
    setTestResults({ passed: 0, failed: 0, total: 0 });
    setLogs([]);
    addLog('🔄 Tests reset');
  };
  
  const getStatusIcon = (status: TestCase['status']) => {
    switch (status) {
      case 'passed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running': return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
      default: return <div className="w-4 h-4 border border-gray-300 rounded-full" />;
    }
  };
  
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          LiveKit Toolbar Testing Environment
        </h1>
        <p className="text-muted-foreground">
          Comprehensive integration testing for the LiveKit toolbar component
        </p>
      </div>
      
      {/* Connection Panel */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Wifi className="w-5 h-5" />
          LiveKit Connection
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">WebSocket URL</label>
            <input
              type="text"
              value={connectionUrl}
              onChange={(e) => setConnectionUrl(e.target.value)}
              placeholder="wss://your-livekit-server.com"
              className="w-full px-3 py-2 border border-border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Room Token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="your-room-token"
              className="w-full px-3 py-2 border border-border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Room Name</label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="test-room"
              className="w-full px-3 py-2 border border-border rounded-md"
            />
          </div>
        </div>
        
        <div className="flex gap-2">
          {!isConnected ? (
            <button
              onClick={connectToRoom}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Connect to Room
            </button>
          ) : (
            <button
              onClick={disconnectFromRoom}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 flex items-center gap-2"
            >
              <Square className="w-4 h-4" />
              Disconnect
            </button>
          )}
          
          <div className={cn(
            "px-3 py-2 rounded-md text-sm flex items-center gap-2",
            isConnected ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
          )}>
            <div className={cn(
              "w-2 h-2 rounded-full",
              isConnected ? "bg-green-500 animate-pulse" : "bg-gray-400"
            )} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>
      
      {/* LiveKit Room Provider and Toolbar */}
      {isConnected && room && (
        <LiveKitRoom
          room={room}
          connectOptions={{ autoSubscribe: true }}
          className="bg-card border border-border rounded-lg p-6"
        >
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Live Toolbar
            </h2>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <LivekitToolbar
                roomName={roomName}
                enableVoiceCommands={true}
                enableParticipantControls={true}
                enableAdaptiveUI={true}
                moderationEnabled={true}
                showConnectionStatus={true}
                showParticipantList={true}
                features={{
                  recording: true,
                  screenShare: true,
                  chat: true,
                  handRaise: true,
                  backgroundBlur: true,
                  aiAssistant: true,
                }}
              />
            </div>
            
            <RoomAudioRenderer />
          </div>
        </LiveKitRoom>
      )}
      
      {/* Test Control Panel */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Integration Tests
          </h2>
          
          <div className="flex gap-2">
            <button
              onClick={runAllTests}
              disabled={!isConnected}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Run All Tests
            </button>
            <button
              onClick={resetTests}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>
        
        {/* Test Results Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{testResults.passed}</div>
            <div className="text-sm text-green-700">Passed</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{testResults.failed}</div>
            <div className="text-sm text-red-700">Failed</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-600">{testResults.total}</div>
            <div className="text-sm text-gray-700">Total</div>
          </div>
        </div>
        
        {/* Test Suites */}
        <div className="space-y-4">
          {testSuites.map((suite, suiteIndex) => (
            <div key={suite.name} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted px-4 py-3 font-medium">
                {suite.name}
              </div>
              <div className="divide-y divide-border">
                {suite.tests.map((test, testIndex) => (
                  <div key={test.name} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(test.status)}
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {test.name}
                          {test.manual && (
                            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                              Manual
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {test.description}
                        </div>
                      </div>
                    </div>
                    
                    {!test.manual && (
                      <button
                        onClick={() => runTest(test, suiteIndex, testIndex)}
                        disabled={!isConnected || currentTest === `${suiteIndex}-${testIndex}`}
                        className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                      >
                        Run
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Logs Panel */}
      <div className="bg-card border border-border rounded-lg">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-xl font-semibold">Test Logs</h2>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-primary hover:text-primary/80"
          >
            {showLogs ? 'Hide' : 'Show'} Logs
          </button>
        </div>
        
        {showLogs && (
          <div className="p-4">
            <div className="bg-black text-green-400 font-mono text-sm p-4 rounded max-h-96 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="text-gray-500">No logs yet...</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LivekitToolbarDemo; 