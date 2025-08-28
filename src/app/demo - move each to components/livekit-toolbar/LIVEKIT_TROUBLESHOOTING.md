# LiveKit Connection Troubleshooting Guide

## 🔧 Common Issues and Solutions

### 1. **"Still never connecting after starting"**

**Symptoms:**
- LiveKit room connector shows "Connecting..." indefinitely
- No error messages in console
- Token fetch succeeds but room never connects

**Solution:**
Fixed in `src/components/ui/livekit-room-connector.tsx` - the component was fetching tokens but never calling `room.connect()`.

### 2. **CSS Import Caching Issue**

**Symptoms:**
- `Module not found: Can't resolve 'tldraw/tldraw.css'` error
- File shows correct imports but error persists

**Solution:**
```bash
# Clear Next.js cache and restart
rm -rf .next
npm run dev
```

### 3. **Environment Configuration**

**Required Environment Variables:**
Create `.env.local` file with:
```env
# LiveKit Configuration
NEXT_PUBLIC_LK_SERVER_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
LIVEKIT_URL=wss://your-livekit-server.com

# Tambo AI
NEXT_PUBLIC_TAMBO_API_KEY=your-tambo-key

# Other configurations...
```

### 4. **Multiple tldraw Instances Warning**

**Symptoms:**
- Console warning about multiple tldraw library instances
- Performance issues with canvas

**Solution:**
Already configured in `next.config.ts` with webpack aliases. The warning should be reduced with console filtering.

### 5. **JSON Parsing Errors**

**Symptoms:**
- "Failed to parse JSON chunk, skipping" in console
- Canvas components not loading properly

**Solution:**
These are typically related to:
- Fast Refresh during development
- Large component data being transferred
- Network connectivity issues

**Fixed by:**
- Improved error boundaries
- Better debouncing in canvas components
- Enhanced console warning suppression

## 🐛 Debugging Steps

### Step 1: Check LiveKit Connection
1. Open browser dev tools
2. Look for these console messages:
   ```
   🎯 [LiveKitConnector-tambo-canvas-room] Fetching token...
   🔑 [LiveKitConnector-tambo-canvas-room] Token received, connecting to room...
   🔌 [LiveKitConnector-tambo-canvas-room] Calling room.connect() with URL: wss://...
   ✅ [LiveKitConnector-tambo-canvas-room] Room.connect() called successfully
   ```

### Step 2: Verify Environment Variables
Check that all required variables are set:
```bash
echo $NEXT_PUBLIC_LK_SERVER_URL
echo $LIVEKIT_API_KEY
echo $LIVEKIT_API_SECRET
```

### Step 3: Test Token API
Visit: `http://localhost:3000/api/token?roomName=test&username=testuser`

Should return:
```json
{
  "identity": "testuser",
  "accessToken": "jwt-token-here"
}
```

### Step 4: Clear All Caches
```bash
# Clear Next.js cache
rm -rf .next

# Clear npm cache (if needed)
npm cache clean --force

# Restart development server
npm run dev
```

## 📊 Performance Optimizations Applied

1. **Console Warning Suppression**: Reduced noise from development warnings
2. **Debounced Component Updates**: Prevented excessive re-renders
3. **Error Boundaries**: Graceful handling of tldraw validation errors
4. **Custom External Content Handlers**: Fixed image drop validation issues

## 🚀 Next Steps

1. **Verify LiveKit Server**: Ensure your LiveKit server is running and accessible
2. **Test Connection**: Try connecting with the LiveKit room connector
3. **Monitor Console**: Check for the success messages listed above
4. **Test Features**: Try voice/video features once connected

## 🔍 Additional Debugging

If issues persist:

1. **Check Network**: Ensure WebSocket connections are allowed
2. **Firewall**: Check that WebSocket ports are open
3. **CORS**: Verify CORS settings on LiveKit server
4. **SSL**: Ensure HTTPS/WSS certificates are valid

## 📱 Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Full support  
- **Safari**: Some WebRTC limitations possible
- **Mobile**: Limited by device capabilities

---

*Last updated: Generated automatically with fixes applied* 