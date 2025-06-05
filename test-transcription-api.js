require('dotenv').config({ path: '.env.local' });

async function testTranscriptionAPI() {
  // Dynamic import for node-fetch
  const { default: fetch } = await import('node-fetch');
  
  console.log('🧪 Testing Transcription API...');
  
  try {
    // Create a minimal WAV file (silence) for testing
    // This creates a 1-second silent WAV file at 16kHz
    const sampleRate = 16000;
    const duration = 1; // 1 second
    const numSamples = sampleRate * duration;
    
    // Create WAV header
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + numSamples * 2, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // Subchunk1Size
    wavHeader.writeUInt16LE(1, 20); // AudioFormat (PCM)
    wavHeader.writeUInt16LE(1, 22); // NumChannels (mono)
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(sampleRate * 2, 28); // ByteRate
    wavHeader.writeUInt16LE(2, 32); // BlockAlign
    wavHeader.writeUInt16LE(16, 34); // BitsPerSample
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(numSamples * 2, 40);
    
    // Create silent audio data (all zeros)
    const audioData = Buffer.alloc(numSamples * 2);
    
    // Combine header and data
    const wavFile = Buffer.concat([wavHeader, audioData]);
    
    // Convert to base64
    const base64Audio = wavFile.toString('base64');
    
    console.log('📝 Created test WAV file:', wavFile.length, 'bytes');
    console.log('📝 Base64 length:', base64Audio.length);
    
    // Test the API
    const response = await fetch('http://localhost:3000/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: base64Audio,
        speaker: 'Test Speaker',
        sampleRate: sampleRate,
      }),
    });
    
    const responseText = await response.text();
    console.log('📝 Response status:', response.status);
    console.log('📝 Response:', responseText);
    
    if (response.ok) {
      const data = JSON.parse(responseText);
      if (data.success) {
        console.log('✅ Transcription API working!');
        console.log('📝 Transcription:', data.transcription);
      } else {
        console.log('⚠️ API returned success=false, but this is expected for silent audio');
        console.log('📝 Fallback transcription:', data.transcription);
      }
    } else {
      console.log('❌ API error:', response.status, responseText);
    }
    
  } catch (error) {
    console.error('❌ Error testing transcription API:', error.message);
  }
}

// Test if server is running first
async function checkServer() {
  const { default: fetch } = await import('node-fetch');
  
  try {
    const response = await fetch('http://localhost:3000/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    
    if (response.status === 400) {
      console.log('✅ Server is running and API endpoint is accessible');
      return true;
    } else {
      console.log('⚠️ Unexpected response from server:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Server not accessible:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting transcription API test...\n');
  
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('❌ Please make sure the development server is running with: npm run dev');
    return;
  }
  
  await testTranscriptionAPI();
}

main(); 