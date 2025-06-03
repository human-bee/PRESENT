# TLDraw with Supabase Setup Guide

This guide shows you how to set up TLDraw with Supabase authentication and database - much simpler than NextAuth!

## 🚀 Why Supabase?

- ✅ Built-in Google OAuth (no separate Google Cloud setup needed!)
- ✅ Database included
- ✅ Real-time features
- ✅ Much simpler configuration
- ✅ No complex environment variables

## 📋 Quick Setup (5 minutes!)

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click "New Project"
3. Choose a name and password
4. Wait for your project to be created (1-2 minutes)

### 2. Get Your API Keys

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **Anon/Public Key** (long string starting with `eyJ...`)

### 3. Set Up Environment Variables

Copy `example.env.local` to `.env.local`:
```bash
cp example.env.local .env.local
```

Update your `.env.local`:
```env
# Your Supabase project URL and anon key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Keep your existing Tambo/LiveKit variables
NEXT_PUBLIC_TAMBO_API_KEY=your-tambo-key
# ... etc
```

### 4. Create Database Tables

Go to **SQL Editor** in your Supabase dashboard and run this:

```sql
-- Create canvases table
CREATE TABLE canvases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  document JSONB NOT NULL,
  conversation_key TEXT,
  thumbnail TEXT,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;

-- Create policy so users can only see their own canvases
CREATE POLICY "Users can view their own canvases" ON canvases
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own canvases" ON canvases
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own canvases" ON canvases
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own canvases" ON canvases
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_canvases_user_id ON canvases(user_id);
CREATE INDEX idx_canvases_conversation_key ON canvases(conversation_key);
```

### 5. Enable Google OAuth (Optional)

1. In Supabase dashboard, go to **Authentication** → **Providers**
2. Find **Google** and click the toggle to enable it
3. Supabase will provide you with redirect URLs to use in Google Cloud Console
4. Or just use email/password auth - it's already working!

That's it! 🎉

## 🎨 Usage

### Sign Up/Sign In
- Navigate to `/auth/signin` or `/auth/signup`
- Use email/password or click "Sign in with Google"

### Canvas Features
- Auto-save every 3 seconds
- Manual save with Ctrl+S or Save button
- Canvas gallery at `/canvases`
- Export as SVG
- Linked to Tambo conversations

## 🔧 Key Benefits Over NextAuth

| Feature | NextAuth | Supabase |
|---------|----------|----------|
| Setup time | 30+ minutes | 5 minutes |
| Environment variables | 6+ variables | 2 variables |
| Database setup | Prisma + migrations | Built-in |
| Google OAuth setup | Manual Google Cloud | One toggle |
| Real-time features | Need separate service | Built-in |
| User management | Custom implementation | Built-in dashboard |

## 🚨 Troubleshooting

### "Invalid API key" error
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct
- Make sure you copied the **anon/public** key, not the service key

### Can't sign in with Google
- Make sure Google provider is enabled in Supabase dashboard
- Check the redirect URLs are set up correctly in Google Cloud Console

### Canvases not saving
- Check browser console for errors
- Verify the database tables were created correctly
- Make sure Row Level Security policies are in place

That's it! Much simpler than the previous NextAuth setup. 🚀 

# Supabase Setup Guide

This guide will help you set up Supabase authentication for your TLDraw application.

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create an account
2. Create a new project
3. Wait for the project to be set up (this may take a few minutes)

## 2. Get Your Project Credentials

1. Go to your project dashboard
2. Navigate to **Settings** → **API**
3. Copy the following values:
   - **Project URL** (starts with `https://`)
   - **Anon public key** (starts with `eyJ`)

## 3. Configure Environment Variables

Update your `.env.local` file with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url-here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

## 4. Set Up Database Tables

Run the following SQL in your Supabase SQL editor (Dashboard → SQL Editor):

```sql
-- Create profiles table
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Create canvases table
CREATE TABLE canvases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  document JSONB NOT NULL,
  conversation_key TEXT,
  thumbnail TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create policies for canvases
CREATE POLICY "Users can view own canvases" ON canvases
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create canvases" ON canvases
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own canvases" ON canvases
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own canvases" ON canvases
  FOR DELETE USING (auth.uid() = user_id);

-- Create function to handle user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## 5. Configure Google OAuth (CRITICAL STEP)

This step is **essential** to fix the "redirect_uri_mismatch" error:

### 5.1 Set up Google OAuth in Supabase

1. Go to your Supabase dashboard
2. Navigate to **Authentication** → **Providers**
3. Find **Google** and click **Configure**
4. Enable Google authentication
5. You'll need to set up a Google OAuth app first (see step 5.2)

### 5.2 Create Google OAuth Application

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API:
   - Go to **APIs & Services** → **Library**
   - Search for "Google+ API" and enable it
4. Create OAuth 2.0 credentials:
   - Go to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **OAuth 2.0 Client IDs**
   - Choose **Web application**
   - Add these **Authorized redirect URIs**:
     ```
     https://your-project-ref.supabase.co/auth/v1/callback
     http://localhost:3000/auth/callback
     ```
   - Replace `your-project-ref` with your actual Supabase project reference
5. Copy the **Client ID** and **Client Secret**

### 5.3 Configure Google OAuth in Supabase

1. Back in Supabase, go to **Authentication** → **Providers** → **Google**
2. Enable Google authentication
3. Enter your Google **Client ID** and **Client Secret**
4. **IMPORTANT**: Add these redirect URLs in the **Site URL** section:
   - Go to **Authentication** → **URL Configuration**
   - Set **Site URL** to: `http://localhost:3000` (for development)
   - Add **Redirect URLs**:
     ```
     http://localhost:3000/auth/callback
     https://your-production-domain.com/auth/callback
     ```

### 5.4 Update Your Environment Variables

Add your Google OAuth credentials to `.env.local` (optional, as they're configured in Supabase):

```env
# These are optional since they're configured in Supabase dashboard
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

## 6. Test Your Setup

1. Start your development server: `npm run dev`
2. Navigate to `http://localhost:3000/auth/signin`
3. Try signing in with Google
4. If you get a redirect URI mismatch error, double-check:
   - Your Google OAuth app has the correct redirect URIs
   - Your Supabase project has the correct Site URL and Redirect URLs
   - The URLs match exactly (including http/https)

## 7. Production Deployment

When deploying to production:

1. Update your Google OAuth app with your production domain redirect URI:
   ```
   https://your-domain.com/auth/callback
   ```
2. Update Supabase URL configuration:
   - Set **Site URL** to your production domain
   - Add your production redirect URL to **Redirect URLs**

## Troubleshooting

### "redirect_uri_mismatch" Error

This error occurs when the redirect URI in your OAuth request doesn't match what's configured in Google Cloud Console. To fix:

1. Check the exact redirect URI in the error message
2. Make sure it's added to your Google OAuth app's **Authorized redirect URIs**
3. Ensure the Supabase **Site URL** and **Redirect URLs** are correctly configured
4. Clear your browser cache and try again

### "Invalid request" Error

This usually means:
- Your Google Client ID/Secret are incorrect
- Your Supabase project configuration is wrong
- The OAuth app isn't properly enabled

### Authentication Not Working

1. Check your environment variables are correct
2. Verify your database tables were created successfully
3. Check the browser console for any JavaScript errors
4. Verify your Supabase project is active and not paused

## Additional Features

### Email Authentication

Email/password authentication is already configured and working. Users can:
- Sign up with email/password
- Sign in with email/password
- Reset their password (if you enable email templates in Supabase)

### Profile Management

The setup includes a profiles table that automatically creates a profile when a user signs up. You can extend this to include additional user information.

### Canvas Persistence

The canvases table is set up to store TLDraw documents with:
- User ownership (via Row Level Security)
- Conversation keys for Tambo integration
- Thumbnails for preview
- Public/private sharing options

## Next Steps

1. Customize the authentication UI to match your design
2. Add password reset functionality
3. Implement profile editing
4. Add canvas sharing features
5. Set up email templates in Supabase for better user experience 