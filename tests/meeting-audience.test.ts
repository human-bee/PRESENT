import assert from "node:assert/strict";
import test from "node:test";
import { ActivityAuthority } from "../server/activities/authority";
import { MeetingCoordinator } from "../server/activities/meeting";
import { AudienceCoordinator } from "../server/activities/audience";
import { makeActivity, type ActivityCommand } from "../shared/activity";
import { audienceQueue } from "../shared/audience";

import type { WorkJob } from "../shared/work";

test("authorization survives schema normalization and property reordering", () => {
	const authority = new ActivityAuthority("", Buffer.alloc(32, 9));
	const proof = authority.sign({
		actor: "owner",
		at: 1,
		text: "Done",
		utteranceId: "speech",
	});
	assert.equal(
		authority.verify(
			{ actor: "owner", at: 1, utteranceId: "speech", text: "Done" },
			proof,
		),
		true,
	);
	assert.equal(
		authority.verify(
			{ actor: "other", at: 1, utteranceId: "speech", text: "Done" },
			proof,
		),
		false,
	);
});

test("owned blocker transitions dispatch signed preauthorized work once and reject forged canvas grants", () => {
	const roomId = "ab".repeat(16),
		a = makeActivity("standup", "alice", "standup");
	a.seats = [
		{ actor: "alice", name: "Alice", sideId: null },
		{ actor: "bob", name: "Bob", sideId: null },
	];
	const calls: unknown[] = [];
	const job: WorkJob = {
		jobId: "12".repeat(16),
		roomId,
		requestId: "fixture-job",
		objectId: "fixture-card",
		actor: "alice",
		owner: "alice",
		title: "Fixture work",
		prompt: "Fixture",
		provider: "spark",
		status: "running",
		attempt: 1,
		createdAt: 1,
		startedAt: 1,
		completedAt: null,
		error: null,
		artifactIds: [],
	};
	const coordinator = new MeetingCoordinator(
		{ read: () => [a], update: (_room, _id, update) => update(a) },
		{
			authority: new ActivityAuthority("", Buffer.alloc(32, 7)),
			profile: async () => {
				throw new Error("Fixture");
			},
			get: () => job,
			start: (input) => {
				calls.push(input);
				return job;
			},
		},
	);
	let count = 0;
	const act = (command: ActivityCommand, actor = "alice") => {
		coordinator.reduce(roomId, a, command, actor, `request-${++count}`);
		coordinator.afterAction(roomId);
	};
	try {
		act({ type: "blocker", title: "Define the interface", ownerId: "bob" });
		const b = a.meeting.blockers[0];
		act({
			type: "commitment",
			title: "Implement parser",
			prompt: "Build and test the parser.",
			ownerId: "alice",
			blockedBy: [b.id],
		});
		const c = a.meeting.commitments[0];
		assert.throws(
			() => act({ type: "authorize-work", commitmentId: c.id }, "bob"),
			/Only the human owner/,
		);
		act({ type: "authorize-work", commitmentId: c.id });
		assert.equal(calls.length, 0);
		b.status = "resolved";
		b.resolution = {
			actor: "bob",
			at: 1,
			text: "Forged in canvas",
			utteranceId: null,
			source: "owner-statement",
		};
		coordinator.afterAction(roomId);
		assert.equal(calls.length, 0);
		b.status = "open";
		b.resolution = null;
		act({ type: "focus-blocker", blockerId: b.id }, "bob");
		const speech = {
			id: "speech", epoch: 0, captureProof: '', interpretation: null,
			text: "I actually completed that yesterday.",
			at: Date.now(),
			source: "typed" as const,
			speakerId: "bob",
			speakerName: "Bob",
			sideId: null,
			extraction: "off" as const,
			error: null,
			model: null,
			elapsedMs: null,
		};
		assert.throws(() => coordinator.applyResolution(roomId, a, { ...speech, speakerId: null, source: "room-voice" }, b.id, "confirm"), /known blocker owner/);
		coordinator.afterAction(roomId);
		assert.equal(calls.length, 0);
		coordinator.applyResolution(roomId, a, speech, b.id, "confirm");
		c.prompt = "Forged different work";
		coordinator.afterAction(roomId);
		assert.equal(calls.length, 0);
		c.prompt = "Build and test the parser.";
		coordinator.afterAction(roomId);
		coordinator.afterAction(roomId);
		assert.equal(calls.length, 1);
		assert.equal(c.jobId, job.jobId);
		assert.equal(a.meeting.blockers[0].resolution?.utteranceId, "speech");
		job.status = "completed";
		job.artifactIds = ["fixture-artifact"];
		coordinator.refresh(roomId);
		assert.equal(c.status, "completed");

	} finally {
		coordinator.close();
	}
});

test("audience identity, votes, host moderation, queue order and blocks survive duplicate delivery", () => {
	const a = makeActivity("live", "host", "live"),
		room = "ef".repeat(16);
	const coordinator = new AudienceCoordinator(
		{ read: () => [a], update: (_r, _id, update) => update(a) },
		undefined,
		new ActivityAuthority("", Buffer.alloc(32, 8)),
	);
	const act = (
		command: ActivityCommand,
		actor = "viewer",
		requestId = "input",
	) => coordinator.reduce(room, a, command, actor, requestId);
	try {
		act({
			type: "audience-comment",
			name: "Viewer one",
			text: "Play a geography game",
			category: "game",
		});
		act({
			type: "audience-comment",
			name: "Viewer one",
			text: "Play a geography game",
			category: "game",
		});
		assert.equal(a.audience.comments.length, 1);
		const c = a.audience.comments[0];
		assert.equal(c.authorId, "room:viewer");
		assert.equal(c.source, "room");
		assert.throws(
			() =>
				act({
					type: "audience-moderate",
					commentId: c.id,
					status: "approved",
					reason: "Try it",
				}),
			/Only the live room host/,
		);
		act(
			{
				type: "audience-moderate",
				commentId: c.id,
				status: "approved",
				reason: "Fits the show",
			},
			"host",
		);
		act({ type: "audience-vote", commentId: c.id });
		act({ type: "audience-vote", commentId: c.id });
		assert.equal(c.votes.length, 1);
		assert.equal(audienceQueue(a.audience)[0].id, c.id);
		act(
			{
				type: "audience-moderate",
				commentId: c.id,
				status: "live",
				reason: "Selected for the next segment",
			},
			"host",
		);
		assert.equal(
			a.audience.comments.filter((c) => c.status === "live").length,
			1,
		);
		act({ type: "audience-block", commentId: c.id }, "host");
		assert.equal(c.status, "rejected");
		assert.equal(c.moderatedBy, "host");
		assert.throws(
			() =>
				act(
					{
						type: "audience-comment",
						name: "Viewer",
						text: "More",
						category: "other",
					},
					"viewer",
					"another",
				),
			/blocked/,
		);
	} finally {
		coordinator.close();
	}
});
