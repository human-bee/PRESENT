#!/usr/bin/env node

/**
 * Test script for agent dispatch flow
 * 
 * This script simulates the frontend flow:
 * 1. Creates a room
 * 2. Triggers agent dispatch
 * 3. Monitors the dispatch file
 */

async function testAgentDispatch() {
  console.log('🧪 Testing Agent Dispatch Flow...');
  
  try {
    // Step 1: Trigger agent dispatch
    console.log('📤 Triggering agent dispatch...');
    const response = await fetch('http://localhost:3000/api/agent/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomName: 'test-room-' + Date.now(),
        trigger: 'participant_connected',
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      throw new Error(`Dispatch failed: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ Dispatch triggered:', {
      agentIdentity: result.agent.identity,
      roomName: result.agent.roomName
    });
    
    // Step 2: Monitor dispatch file
    console.log('👀 Monitoring dispatch file...');
    const fs = await import('fs/promises');
    
    for (let i = 0; i < 12; i++) { // Monitor for 60 seconds (12 * 5s)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const dispatchData = JSON.parse(await fs.readFile('.next/agent-dispatch.json', 'utf-8'));
        console.log(`📊 Status check ${i + 1}: ${dispatchData.status}`);
        
        if (dispatchData.status === 'completed') {
          console.log('🎉 Agent dispatch completed successfully!');
          break;
        } else if (dispatchData.status === 'failed') {
          console.log('❌ Agent dispatch failed');
          break;
        }
      } catch (error) {
        console.log(`⚠️ No dispatch file found on check ${i + 1}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Only run if this script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testAgentDispatch();
} 