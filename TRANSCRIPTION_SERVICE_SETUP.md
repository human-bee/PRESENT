# LiveKit Transcription Service Setup

## The Issue

The LiveKit agents TypeScript/JavaScript library uses `import.meta` in a way that's incompatible with Next.js's webpack bundler. Additionally, `livekit-client` is a browser-only library that requires WebRTC APIs not available in Node.js environments.

## The Solution

We've implemented a **browser-based transcription service** that runs directly in the React component. This approach:
- Avoids all bundler and environment compatibility issues
- Runs in the browser where WebRTC APIs are available
- Integrates seamlessly with the existing LiveKit room connection
- Sends transcriptions via LiveKit data channels

## How It Works

### 1. LiveTranscription Component
Located at `src/components/LiveTranscription.tsx`, this component:
- Monitors audio tracks in the LiveKit room
- Processes audio in the browser (ready for real Whisper integration)
- Sends transcriptions via LiveKit data channels
- Currently sends demo transcriptions every 3 seconds for testing

### 2. Integration with SpeechTranscription
The `LiveTranscription` component is integrated into the main `SpeechTranscription` component:
- Automatically starts when a room is connected
- Detects all audio tracks from participants
- Displays transcriptions in real-time

## Usage

### 1. Start the Application
```bash
npm run dev
```

### 2. Navigate to Canvas
Open your browser to `http://localhost:3000/canvas?id=your-canvas-id`

### 3. Click "Start"
The transcription service will:
- Connect to the LiveKit room
- Start monitoring for audio tracks
- Display demo transcriptions every 3 seconds

## Demo Transcriptions

Currently, the service sends simulated transcriptions for testing:
```
[Demo transcription from Ben at 2:35:45 PM]
```

## Implementing Real Transcription

To implement actual speech-to-text:

### Option 1: Browser-Based Processing
1. Use the Web Audio API to capture audio chunks
2. Send audio blobs to your API endpoint
3. Forward to OpenAI Whisper API
4. Return transcriptions to the browser

### Option 2: Server-Side Processing
1. Use LiveKit Egress to record audio
2. Process recordings with Whisper
3. Send transcriptions back via webhooks

### Option 3: Python Agent (Recommended for Production)
1. Create a Python-based LiveKit agent
2. Use the mature Python SDK with full audio processing
3. Deploy as a separate service

## Architecture Benefits

- ✅ No bundler compatibility issues
- ✅ Runs in the native browser environment
- ✅ Real-time transcription display
- ✅ Seamless integration with existing UI
- ✅ Ready for production enhancements

## Next Steps

1. **For Testing**: The current demo transcriptions work immediately
2. **For Development**: Implement audio capture and Whisper API integration
3. **For Production**: Consider Python agent or Egress service for robust processing

## Notes

- The service status is displayed at the top of the transcription area
- All transcriptions are sent via LiveKit data channels for reliability
- The component handles participant join/leave gracefully
- Audio processing intervals can be adjusted (currently 3 seconds) 