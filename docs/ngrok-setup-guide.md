# Beginner's Guide: Running PRESENT on MacBook & iPad with Ngrok

This guide will help you run the PRESENT app on your MacBook and access it from your iPad using ngrok tunnels.

## Prerequisites

1. **Ngrok Account**: Sign up at [ngrok.com](https://ngrok.com) (free tier works)
2. **Ngrok Installed**: Install via Homebrew: `brew install ngrok`
3. **Ngrok Auth Token**: Get your auth token from [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)

## One-Time Setup

### 1. Configure Ngrok Auth Token

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
```

Replace `YOUR_AUTH_TOKEN_HERE` with your actual token from the ngrok dashboard.

### 2. Verify Ngrok Configuration

The project already has an `ngrok.yml` file configured. You can view it:

```bash
cat ngrok.yml
```

It should show two tunnels:
- `next-dev` (port 3000) - Main Next.js app
- `tldraw-sync` (port 3100) - Tldraw sync server

## Running the App

### Single Command Setup

In your terminal, run:

```bash
npm run stack:share
```

That's it! The script will:
1. ✅ Stop any existing servers
2. ✅ Create ngrok tunnels
3. ✅ Get the sync URL
4. ✅ **Auto-configure `.env.local`**
5. ✅ Start all servers (Next.js, Sync, Agents, LiveKit)
6. ✅ Display your iPad URL

### What You'll See

The script output will look like:

```
[stack:share] stopping existing servers...
[stack:share] launching ngrok tunnels...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 Configuring sync URL...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Added NEXT_PUBLIC_TLDRAW_SYNC_URL=https://xyz.ngrok-free.app
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[stack:share] starting development servers with configured sync URL...
[Next dev] pid=12345 log=logs/next-dev.log
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Stack is ready! Tunnels available:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 - Next.js dev (:3000): https://abc123.ngrok-free.app
 - TLDraw sync (:3100): https://def456.ngrok-free.app

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 Use this URL on your iPad:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   https://abc123.ngrok-free.app

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Access on iPad

1. **Copy the iPad URL** from the terminal
2. **Open Safari** on your iPad
3. **Navigate to the URL**
4. Click "Visit Site" if you see an ngrok warning
5. **Done!** The app is ready to use

## What Changed?

The script now handles everything in the correct order:

**Before**: Start servers → Get URLs → Update config → **Restart needed** ❌

**Now**: Get URLs → Update config → Start servers → **Ready immediately** ✅

No restart needed!

## Troubleshooting

### "Tunnel not found" or Connection Issues

**Problem**: The sync server URL isn't being picked up correctly.

**Solution**: 
1. Stop all servers (Ctrl+C)
2. Update `.env.local`:
   ```
   NEXT_PUBLIC_TLDRAW_SYNC_URL=https://your-sync-url.ngrok-free.app
   ```
3. Restart: `npm run stack:share`

### iPad Shows Blank Screen or Infinite Loading

**Problem**: The canvas might be stuck in a loading state.

**Solution**:
1. Try creating a new canvas by changing the URL to `/canvas?id=test-123`
2. Hard refresh on iPad (pull down from top of Safari)
3. Check MacBook terminal for any error messages

### Ngrok Free Tier Limitations

**Problem**: Free tier only allows 1 ngrok process with up to 3 tunnels.

**Current Setup**: Uses 2 tunnels (Next.js + Sync server), which fits within the free tier.

**Note**: If you see "ERR_NGROK_108" or similar, you may have another ngrok process running. Stop it with:
```bash
pkill ngrok
```

### URLs Change Every Time

**Problem**: Ngrok free tier generates new random URLs on each restart.

**Solution**: 
- Upgrade to ngrok paid plan for static domains, OR
- Just use the new URLs each time (they're displayed when you run `npm run stack:share`)

## Stopping the Servers

Press `Ctrl+C` in the terminal where `npm run stack:share` is running.

Or, to force-stop all servers:

```bash
# Stop Next.js and sync servers
lsof -ti:3000,3100 | xargs kill

# Stop ngrok
pkill ngrok
```

## Quick Reference Commands

| Task | Command |
|------|---------|
| Start everything | `npm run stack:share` |
| Stop everything | `Ctrl+C` (in the terminal) |
| Check running servers | `lsof -i:3000,3100` |
| View ngrok config | `cat ngrok.yml` |
| Kill all servers | `lsof -ti:3000,3100 \| xargs kill` |

## Tips for Best Experience

1. **Keep Terminal Open**: Don't close the terminal window while using the app
2. **Bookmark URLs**: Save the ngrok URLs in your iPad's Safari bookmarks for the session
3. **WiFi Recommended**: Use WiFi on iPad for best performance (cellular works but may be slower)
4. **Development Mode**: Remember this is a dev server, so expect some console logs and debug info

## What's Happening Behind the Scenes?

1. **Next.js Server** (port 3000): Serves your React app
2. **Tldraw Sync Server** (port 3100): Handles real-time canvas collaboration
3. **Ngrok Tunnels**: Create secure public URLs that route to your localhost
4. **iPad**: Connects to the public ngrok URLs, which tunnel back to your MacBook

## Need Help?

- Check the terminal output for error messages
- Verify ngrok is running: `ps aux | grep ngrok`
- Ensure ports 3000 and 3100 aren't blocked by firewall
- Try accessing the local URLs first on MacBook: `http://localhost:3000`
