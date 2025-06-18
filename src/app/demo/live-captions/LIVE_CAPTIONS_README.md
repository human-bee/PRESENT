# 🎤 Live Captions Component

A real-time live captions component that displays speech transcriptions in an interactive tldraw-style canvas with beautiful speech bubbles, powered by Groq Whisper and LiveKit.

## ✨ Features

### 🎯 Real-time Transcription
- **Groq Whisper Integration**: High-accuracy speech-to-text processing
- **Interim & Final Transcripts**: Shows live typing effect for interim results
- **Speaker Identification**: Automatic speaker detection and labeling
- **Timestamp Tracking**: Precise timing for each transcript

### 🎨 Interactive Canvas
- **tldraw-style Interface**: Beautiful, intuitive canvas design
- **Draggable Speech Bubbles**: Move transcripts around the canvas
- **Auto-positioning**: Smart placement to avoid overlaps
- **Multiple Themes**: Grid, dots, or clean canvas backgrounds
- **Smooth Animations**: Framer Motion powered transitions

### 💾 Data Management
- **Persistent State**: Tambo-powered state management
- **Export Capabilities**: TXT, JSON, or SRT format exports
- **Configurable Limits**: Set maximum transcript count
- **Real-time Updates**: Live sync across participants

### 🔧 Customization
- **Speaker Avatars**: Toggle avatar display with auto-generated images
- **Timestamp Display**: Show/hide timestamps
- **Drag & Drop**: Enable/disable bubble movement
- **Canvas Themes**: Choose from multiple visual styles

## 🚀 Quick Start

### Prerequisites
- LiveKit room connection (requires `LivekitRoomConnector` component)
- Groq Whisper configured in your livekit-backend
- Tambo AI React integration

### Installation

The component is already integrated into your Tambo system! Just use it via AI:

```
"Show me live captions for this meeting"
"Create a live transcription canvas"
"Add real-time speech bubbles to the room"
```

### Manual Usage

```tsx
import LiveCaptions from "@/components/LiveCaptions";

<LiveCaptions
  showSpeakerAvatars={true}
  showTimestamps={true}
  enableDragAndDrop={true}
  maxTranscripts={50}
  autoPosition={true}
  exportFormat="txt"
  canvasTheme="dots"
/>
```

## 🏗️ Architecture

### Data Flow
```
LiveKit Room → Groq Whisper → Data Channel → LiveCaptions Component
                                    ↓
                            Speech Bubble Canvas
                                    ↓
                            Tambo State Management
```

### Component Structure
- **LiveCaptions**: Main component container
- **SpeechBubble**: Individual transcript bubble
- **MessageLoading**: Interim transcript animation
- **Canvas**: Interactive drawing surface

### State Management
Uses Tambo's `useTamboComponentState` for:
- Transcript history
- Connection status
- Participant tracking
- User preferences
- Canvas dimensions

## 🎛️ Configuration Options

### Props Schema
```typescript
{
  showSpeakerAvatars: boolean;     // Display speaker avatars
  showTimestamps: boolean;         // Show transcript timestamps
  enableDragAndDrop: boolean;      // Allow bubble dragging
  maxTranscripts: number;          // Maximum transcripts on canvas
  autoPosition: boolean;           // Auto-arrange new bubbles
  exportFormat: "txt"|"json"|"srt"; // Export file format
  canvasTheme: "grid"|"dots"|"clean"; // Canvas background style
}
```

### Canvas Themes
- **Grid**: Subtle grid lines for precise positioning
- **Dots**: Dotted pattern for visual appeal
- **Clean**: Minimal background for focus

## 🔌 LiveKit Integration

### Backend Requirements
Your `livekit-backend` must have:
1. Groq Whisper STT configured
2. Data channel broadcasting enabled
3. Transcription handler active

### Data Channel Format
```json
{
  "type": "live_transcription",
  "text": "Hello world",
  "speaker": "John Doe",
  "timestamp": 1234567890,
  "is_final": true
}
```

## 🎨 Styling & Theming

### CSS Variables
The component uses your project's design tokens:
- `--background`: Canvas background
- `--border`: Speech bubble borders
- `--muted`: Interim transcript styling
- `--foreground`: Text colors

### Custom Styling
Override styles using Tailwind classes:
```tsx
<LiveCaptions className="custom-captions" />
```

## 📱 Demo

Visit `/demo/live-captions` to see the component in action:
1. Connect to a LiveKit room
2. Start speaking
3. Watch real-time transcriptions appear as speech bubbles
4. Drag bubbles around the canvas
5. Export transcripts in your preferred format

## 🔧 Troubleshooting

### Common Issues

**No transcripts appearing:**
- Ensure LiveKit room is connected
- Check microphone permissions
- Verify Groq Whisper is configured in backend

**Speech bubbles not draggable:**
- Check `enableDragAndDrop` prop is true
- Ensure Framer Motion is installed

**Export not working:**
- Browser must support File API
- Check transcript data exists

### Debug Mode
Enable debug logging:
```typescript
// In your component
console.log("LiveCaptions state:", state);
```

## 🚀 Advanced Usage

### Custom Positioning
```typescript
const customPosition = (index: number) => ({
  x: index * 200,
  y: Math.sin(index) * 100 + 200
});
```

### Event Handling
```typescript
const handleTranscriptCopy = (text: string) => {
  // Custom copy logic
  navigator.clipboard.writeText(text);
  toast.success("Transcript copied!");
};
```

### State Persistence
```typescript
// State automatically persists across sessions
// Access via Tambo state management
const [state, setState] = useTamboComponentState(
  `live-captions-${roomName}`,
  defaultState
);
```

## 🤝 Contributing

### Adding Features
1. Update the schema in `liveCaptionsSchema`
2. Add props to `LiveCaptionsProps`
3. Implement in the component
4. Update Tambo registry description

### Testing
```bash
npm test -- LiveCaptions
```

## 📄 License

Part of the Tambo AI ecosystem. See project license for details.

---

**Built with ❤️ using:**
- [LiveKit](https://livekit.io) - Real-time communication
- [Groq Whisper](https://groq.com) - Speech recognition
- [Tambo AI](https://tambo.co) - AI-powered components
- [Framer Motion](https://framer.com/motion) - Smooth animations
- [tldraw](https://tldraw.dev) - Canvas inspiration 