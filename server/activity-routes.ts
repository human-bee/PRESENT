import { authorizedActivityEngine } from './access/activities';
import { roomAuthorization } from './access/context';
import { AccessError } from './access/store';
import { fetchLinearProfile } from './activities/linear';
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { json } from "./http";
import { RoomError, validRoomId } from "./room-store";
import { AgentError } from "./agents/contract";
import { activityEngine } from "./activities/engine";

export async function handleActivityRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", "http://localhost");
	if (!url.pathname.startsWith("/api/activity/")) return false;
	try {
    if (req.method === 'GET' && url.pathname === '/api/activity/linear-viewer') { const profile = await fetchLinearProfile('viewer', 'viewer', AbortSignal.timeout(20000)); json(res, 200, { name: profile.name, team: profile.team, avatarUrl: profile.avatarUrl, sourceUrl: profile.sourceUrl }); return true; }
		if (req.method === "GET" && url.pathname === "/api/activity/connectors") {
			json(res, 200, {
				linear: { configured: Boolean(process.env.LINEAR_API_KEY) },
				youtube: { configured: Boolean(process.env.YOUTUBE_API_KEY) },
			});
			return true;
		}
		if (req.method === "GET" && url.pathname === "/api/activity/state") {
			const roomId = url.searchParams.get("roomId") ?? "";
			if (!validRoomId(roomId)) throw new RoomError("Invalid room link.");
			if (roomAuthorization()?.check().role !== 'viewer') authorizedActivityEngine().recover(roomId);
			if (roomAuthorization()?.check().role !== 'viewer') authorizedActivityEngine().meetings.refresh(roomId);
			json(res, 200, authorizedActivityEngine().read(roomId));
			return true;
		}
		if (req.method !== "POST")
			throw new RoomError("Use POST for activity actions.", 405);
		const parts: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			const bytes = Buffer.from(chunk);
			size += bytes.length;
			if (size > 16000)
				throw new RoomError("This activity action is too large.", 413);
			parts.push(bytes);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
		} catch {
			throw new RoomError("Invalid activity action.");
		}
		if (url.pathname === "/api/activity/launch")
			json(res, 201, authorizedActivityEngine().launch(raw));
		else if (url.pathname === "/api/activity/action")
			json(res, 202, authorizedActivityEngine().act(raw));
		else throw new RoomError("Unknown activity action.", 404);
	} catch (error) {
		json(
			res,
			error instanceof RoomError || error instanceof AgentError || error instanceof AccessError
				? error.status
				: error instanceof z.ZodError
					? 400
					: 500,
			{
				error:
					error instanceof RoomError || error instanceof AgentError || error instanceof AccessError
						? error.message
						: error instanceof z.ZodError
							? "Check the activity fields and try again."
							: "The activity action could not be completed.",
			},
		);
	}
	return true;
}
