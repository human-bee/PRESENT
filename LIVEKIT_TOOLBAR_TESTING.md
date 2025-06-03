# 🧪 LiveKit Toolbar Integration Testing Guide

## Overview

This guide provides comprehensive testing procedures to verify that all LiveKit toolbar integrations are working correctly. The toolbar is a complex component with multiple integrations that need to be validated.

## 🚀 Quick Start Testing

### 1. Run Automated Tests
```bash
# Run the test suite
npm test -- --testNamePattern="LivekitToolbar Integration Tests"

# Run with coverage
npm test -- --coverage --testNamePattern="LivekitToolbar Integration Tests"
```

### 2. Launch Demo Environment
```bash
# Start the development server
npm run dev

# Navigate to the testing page
# http://localhost:3000/demo/livekit-toolbar
```

## 🔧 Integration Test Checklist

### ✅ LiveKit Integration
- [ ] **Room Connection**: Component connects to LiveKit room
- [ ] **Participant Tracking**: Shows all connected participants
- [ ] **Media Controls**: Mic/Camera/Screen share toggles work
- [ ] **Real-time Updates**: Participant join/leave events update UI
- [ ] **Connection Quality**: Shows accurate connection indicators
- [ ] **Error Handling**: Graceful handling of connection failures

**How to Test:**
1. Set up a LiveKit server (local or cloud)
2. Get valid room tokens
3. Connect multiple participants
4. Verify all controls work in real-time

### ✅ Tambo State Integration
- [ ] **State Persistence**: Component state survives refreshes
- [ ] **Unique Component ID**: Each toolbar instance has unique state
- [ ] **State Updates**: UI changes trigger state updates
- [ ] **Default Values**: Correct initial state values
- [ ] **State Synchronization**: Multiple components don't conflict

**How to Test:**
1. Open toolbar, change settings
2. Refresh page, verify settings persist
3. Open multiple rooms, verify separate state
4. Check browser storage for state data

### ✅ Voice Command Integration
- [ ] **Data Channel Setup**: Voice command channel established
- [ ] **Command Processing**: Voice commands execute correctly
- [ ] **Command Types**: All command types supported
- [ ] **Error Handling**: Malformed commands don't crash
- [ ] **Moderation Commands**: Mod-only commands respect permissions

**Supported Voice Commands:**
- `TOGGLE_MIC` - Toggle microphone
- `TOGGLE_CAMERA` - Toggle camera
- `START_RECORDING` - Start/stop recording (moderators only)
- `MUTE_ALL` - Mute all participants (moderators only)
- `RAISE_HAND` - Raise/lower hand

**How to Test:**
1. Connect to room with voice commands enabled
2. Send test commands via data channel
3. Verify commands execute and show feedback
4. Test moderation permissions

### ✅ Canvas Integration
- [ ] **Canvas Events**: Component dispatches canvas events
- [ ] **Event Types**: All event types correctly formatted
- [ ] **Position/Size**: Canvas position and size tracked
- [ ] **Focus States**: Focus events update component state
- [ ] **Layout Updates**: Pin/unpin events notify canvas

**Canvas Events Dispatched:**
- `tambo:showComponent` - When component mounts
- `tambo:componentUpdate` - When component state changes
- `tambo:layoutUpdate` - When participants are pinned/unpinned

**How to Test:**
1. Monitor browser console for canvas events
2. Resize component, verify size events
3. Pin participants, verify layout events
4. Check event payload structure

### ✅ Participant Management
- [ ] **Hover Controls**: Controls appear on participant hover
- [ ] **Moderation Actions**: Mute/kick/pin work for moderators
- [ ] **Permission Checks**: Non-moderators can't access mod controls
- [ ] **Visual Feedback**: Status indicators show correct states
- [ ] **Adaptive Display**: UI adapts to participant count

**How to Test:**
1. Join room with multiple participants
2. Hover over participant avatars
3. Test moderation controls (requires moderator role)
4. Verify status indicators (muted, poor connection, etc.)

### ✅ Real-time Features
- [ ] **Hand Raise**: Hand raise/lower works and syncs
- [ ] **Recording**: Recording controls start/stop correctly
- [ ] **Connection Monitoring**: Quality indicators update live
- [ ] **Data Messaging**: Real-time data exchange works
- [ ] **State Synchronization**: Changes sync across clients

**How to Test:**
1. Use hand raise feature with multiple participants
2. Start/stop recording (moderator required)
3. Monitor connection quality changes
4. Verify real-time state sync

### ✅ UI/UX Features
- [ ] **Adaptive Layout**: Compact mode activates appropriately
- [ ] **Context Awareness**: Controls show/hide based on context
- [ ] **Animations**: Smooth transitions and feedback
- [ ] **Responsive Design**: Works on different screen sizes
- [ ] **Accessibility**: Keyboard navigation and screen readers

**How to Test:**
1. Test with different participant counts
2. Resize browser window
3. Use keyboard navigation
4. Test with screen reader

## 🎯 Manual Testing Scenarios

### Scenario 1: New User Joins Room
1. Connect to empty room
2. Verify toolbar shows correctly
3. Have second user join
4. Verify participant appears
5. Test participant controls

### Scenario 2: Moderation Workflow
1. Join as moderator
2. Have regular users join
3. Test mute all functionality
4. Test individual participant controls
5. Test recording controls

### Scenario 3: Connection Issues
1. Connect to room
2. Simulate poor connection
3. Verify quality indicators
4. Test reconnection behavior
5. Verify graceful degradation

### Scenario 4: Voice Commands
1. Enable voice commands
2. Send various command types
3. Test with/without permissions
4. Verify command feedback
5. Test error scenarios

## 🔍 Debugging and Troubleshooting

### Common Issues

#### 1. Room Connection Fails
```javascript
// Check room configuration
console.log('Room state:', room?.state);
console.log('Connection quality:', room?.localParticipant?.connectionQuality);

// Verify token and URL
console.log('Connection URL:', connectionUrl);
console.log('Token valid:', !!token);
```

#### 2. Voice Commands Not Working
```javascript
// Check data channel setup
console.log('Data channel callbacks:', window.__dataChannelCallbacks);

// Test data channel manually
room.localParticipant.publishData(
  new TextEncoder().encode(JSON.stringify({ type: 'TEST' })),
  { reliable: true }
);
```

#### 3. Canvas Events Not Dispatching
```javascript
// Monitor canvas events
window.addEventListener('tambo:showComponent', (e) => {
  console.log('Canvas event:', e.detail);
});

// Check event listeners
console.log('Event listeners:', window.getEventListeners?.());
```

#### 4. State Not Persisting
```javascript
// Check Tambo state
console.log('Component state:', state);
console.log('Local storage:', localStorage.getItem('tambo-livekit-toolbar'));

// Verify component ID
console.log('Component ID:', componentId);
```

### Performance Monitoring

```javascript
// Monitor render performance
console.time('toolbar-render');
// ... component renders ...
console.timeEnd('toolbar-render');

// Check memory usage
console.log('Memory:', performance.memory);

// Monitor WebSocket messages
room.on('dataReceived', (payload) => {
  console.log('Data received:', new TextDecoder().decode(payload));
});
```

## 📊 Test Results Documentation

### Test Report Template

```markdown
## LiveKit Toolbar Test Results

**Date:** [Date]
**Tester:** [Name]
**Environment:** [Development/Staging/Production]
**LiveKit Server:** [URL]

### Integration Tests
- [ ] LiveKit Integration: ✅ PASS / ❌ FAIL
- [ ] Tambo State: ✅ PASS / ❌ FAIL  
- [ ] Voice Commands: ✅ PASS / ❌ FAIL
- [ ] Canvas Integration: ✅ PASS / ❌ FAIL
- [ ] Participant Management: ✅ PASS / ❌ FAIL
- [ ] Real-time Features: ✅ PASS / ❌ FAIL

### Issues Found
1. [Issue description]
2. [Issue description]

### Performance Notes
- Render time: [X]ms
- Memory usage: [X]MB
- WebSocket latency: [X]ms
```

## 🛠️ Advanced Testing

### Load Testing
```bash
# Test with multiple concurrent connections
for i in {1..10}; do
  curl -X POST "your-livekit-server/join" \
    -d "room=load-test&participant=user-$i" &
done
```

### Stress Testing
```javascript
// Simulate rapid state changes
for (let i = 0; i < 100; i++) {
  setTimeout(() => {
    setState(prev => ({ ...prev, participantCount: i }));
  }, i * 10);
}
```

### Browser Compatibility
Test in multiple browsers:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## 🎉 Success Criteria

The LiveKit toolbar is considered **fully functional** when:

✅ All automated tests pass  
✅ Manual testing scenarios complete successfully  
✅ Real LiveKit room connections work  
✅ Voice commands execute properly  
✅ Canvas integration dispatches events  
✅ Participant management functions correctly  
✅ UI adapts to different contexts  
✅ Error scenarios are handled gracefully  
✅ Performance meets requirements  
✅ Browser compatibility verified  

## 📝 Maintenance

### Regular Testing Schedule
- **Daily**: Automated test suite
- **Weekly**: Manual testing scenarios  
- **Monthly**: Full integration testing
- **Release**: Complete test checklist

### Updating Tests
When adding new features:
1. Add automated tests
2. Update manual test scenarios
3. Document new integration points
4. Update this testing guide

---

*For questions or issues with testing, refer to the component documentation or create an issue in the project repository.* 