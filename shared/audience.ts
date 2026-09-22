import { z } from "zod";
const id = z.string().min(1).max(120);
export const audienceCommentSchema = z.object({
	id,
	text: z.string().min(1).max(1500),
	authorId: id,
	authorName: z.string().min(1).max(100),
	source: z.enum(["room", "youtube", "fixture"]),
	sourceUrl: z.string().max(2048),
	sourceId: id,
	at: z.number(),
	receivedAt: z.number(),
	category: z.enum(["game", "topic", "question", "other"]),
	status: z.enum(["pending", "approved", "live", "done", "rejected"]),
	votes: z.array(id).max(100),
	moderatedBy: id.nullable(),
	moderationReason: z.string().max(200),
});
export const audienceSchema = z.object({
	comments: z.array(audienceCommentSchema).max(100),
	omitted: z.number().int().min(0),
	blockedAuthors: z.array(id).max(100),
	connection: z
		.object({
			liveChatId: z.string().max(500),
			status: z.enum(["off", "connecting", "connected", "failed", "ended"]),
			requestedBy: id,
			sourceUrl: z.string().max(2048),
			cursor: z.string().max(4000),
			nextAt: z.number(),
			lastAt: z.number(),
			error: z.string().max(250).nullable(),
			proof: z.string(),
		})
		.nullable(),
});
export type Audience = z.infer<typeof audienceSchema>;
export type AudienceComment = z.infer<typeof audienceCommentSchema>;
export const audienceCommands = [
	z.object({
		type: z.literal("audience-comment"),
		text: z.string().trim().min(1).max(1500),
		name: z.string().trim().min(1).max(100),
		category: audienceCommentSchema.shape.category,
	}),
	z.object({ type: z.literal("audience-vote"), commentId: id }),
	z.object({
		type: z.literal("audience-moderate"),
		commentId: id,
		status: audienceCommentSchema.shape.status,
		reason: z.string().trim().min(1).max(200),
	}),
	z.object({ type: z.literal("audience-block"), commentId: id }),
	z.object({
		type: z.literal("audience-connect"),
		liveChatId: z.string().regex(/^[\w-]{10,500}$/),
		videoId: z.string().regex(/^[\w-]{11}$/),
	}),
	z.object({ type: z.literal("audience-stop") }),
] as const;
export const emptyAudience = (): Audience => ({
	comments: [],
	omitted: 0,
	blockedAuthors: [],
	connection: null,
});
export function audienceQueue(audience: Audience) {
	return audience.comments
		.filter((c) => c.status === "approved")
		.sort(
			(a, b) =>
				b.votes.length - a.votes.length ||
				a.at - b.at ||
				a.id.localeCompare(b.id),
		);
}
export function retainAudience(audience: Audience) {
	while (
		audience.comments.length > 100 ||
		new TextEncoder().encode(JSON.stringify(audience.comments)).length > 150000
	) {
		const removable = audience.comments.findIndex((c) =>
			["rejected", "done", "pending"].includes(c.status),
		);
		if (removable < 0)
			throw new Error(
				"Audience queue is full. Complete a queued item before adding more.",
			);
		audience.comments.splice(removable, 1);
		audience.omitted++;
	}
}
