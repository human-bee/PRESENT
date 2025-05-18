import type { AccessTokenOptions, VideoGrant } from "livekit-server-sdk";
import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

// Do not cache endpoint result
export const revalidate = 0;

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

const createToken = async (userInfo: AccessTokenOptions, grant: VideoGrant) => {
  if (!apiKey) {
    throw new Error("Server misconfigured: missing LIVEKIT_API_KEY");
  }

  if (!apiSecret) {
    throw new Error("Server misconfigured: missing LIVEKIT_API_SECRET");
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, userInfo);
    at.addGrant(grant);
    return await at.toJwt();
  } catch (error) {
    console.error("Token creation error:", error);
    throw new Error(`Failed to create token: ${(error as Error).message}`);
  }
};

export async function GET(req: NextRequest) {
  try {
    // Add debug logging
    console.log(
      "Token request params:",
      Object.fromEntries(req.nextUrl.searchParams)
    );
    console.log("Environment check:", {
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret,
      hasLivekitUrl: !!process.env.LIVEKIT_URL,
    });

    // Update parameter names to match what's being sent by useToken
    const roomName =
      req.nextUrl.searchParams.get("roomName") ||
      req.nextUrl.searchParams.get("room");
    const identity =
      req.nextUrl.searchParams.get("identity") ||
      req.nextUrl.searchParams.get("username");
    const name = req.nextUrl.searchParams.get("name");
    const metadata = req.nextUrl.searchParams.get("metadata");

    if (!roomName) {
      return NextResponse.json(
        { error: 'Missing "roomName" or "room" query parameter' },
        { status: 400 }
      );
    }

    if (!identity) {
      return NextResponse.json(
        { error: 'Missing "identity" or "username" query parameter' },
        { status: 400 }
      );
    }

    const wsUrl = process.env.LIVEKIT_URL;
    if (!wsUrl) {
      return NextResponse.json(
        {
          error:
            "Server misconfigured: missing LIVEKIT_URL environment variable",
        },
        { status: 500 }
      );
    }

    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canUpdateOwnMetadata: true,
    };

    const token = await createToken(
      {
        identity,
        name: name || undefined,
        metadata: metadata || undefined,
      },
      grant
    );

    return NextResponse.json(
      { identity, accessToken: token },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("Token generation error:", e);
    return NextResponse.json(
      {
        error: (e as Error).message,
        stack:
          process.env.NODE_ENV === "development"
            ? (e as Error).stack
            : undefined,
      },
      { status: 500 }
    );
  }
}
