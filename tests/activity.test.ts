import { emptyPlan } from '../shared/conversation-plan';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActivityEngine } from "../server/activities/engine";
import { RoomStore } from "../server/room-store";
import { readRoomOS, type ActivityCommand } from "../shared/activity";
import type { EvidenceReport } from "../shared/evidence";

const roomId = "b7".repeat(16);
const evidence = (question: string): EvidenceReport => ({
	question,
	status: "model-assessment",
	coverage: "cited-sources",
	model: "fixture",
	responseId: "fixture-response",
	retrievedAt: 1,
	modelAssessment: {
		text: "Fixture research.",
		citations: [{ sourceId: "1", startIndex: 0, endIndex: 7 }],
	},
	sources: [
		{ id: "1", title: "Fixture source", url: "https://example.com/source" },
	],
	consultedSources: [],
});
function setup(
	overrides: Partial<ConstructorParameters<typeof ActivityEngine>[1]> = {},
) {
	const directory = mkdtempSync(join(tmpdir(), "present-activity-"));
	const store = new RoomStore({ directory, debounceMs: 100000 });
	const calls = { extract: 0, research: 0, images: 0 };
	const providers: NonNullable<
		ConstructorParameters<typeof ActivityEngine>[1]
	> = {
		extract: async (_a, u) => {
			calls.extract++;
			return {
				plan: { ...emptyPlan(), contributions: [{ kind: 'claim', text: u.text, quote: u.text, subject: null, replacesClaimId: null }] },
				model: "fixture",
				responseId: "fixture-extract",
			};
		},
		research: async (text) => {
			calls.research++;
			return evidence(text);
		},
		images: async () => {
			calls.images++;
			return [];
		},
		...overrides,
	};
	const engine = new ActivityEngine(store, providers);
	const launch = {
		roomId,
		actor: "alice",
		requestId: "launch",
		kind: "debate" as const,
	};
	const { activityId } = engine.launch(launch);
	const act = (
		command: ActivityCommand,
		actor = "alice",
		requestId: string = randomUUID(),
	) => engine.act({ roomId, activityId, actor, requestId, command });
	const activity = () => engine.read(roomId).activities[0];
	const close = async () => {
		engine.close();
		await engine.settled();
		store.close();
		rmSync(directory, { recursive: true, force: true });
	};
	return {
		directory,
		engine,
		store,
		calls,
		providers,
		launch,
		activityId,
		act,
		activity,
		close,
	};
}

test("launch is immediate, idempotent and entirely native; unrelated native writes survive activity mutations", async () => {
	const s = setup();
	try {
		assert.equal(s.engine.launch(s.launch).activityId, s.activityId);
		assert.equal(s.engine.read(roomId).activities.length, 1);
		assert.deepEqual(s.calls, { extract: 0, research: 0, images: 0 });
		s.store.applyOperation(
			roomId,
			{ type: "rename", title: "Our native room" },
			"bob",
		);
		s.act({ type: "seat", name: "Alice", sideId: s.activity().sides[0].id });
		s.act(
			{ type: "seat", name: "Bob", sideId: s.activity().sides[1].id },
			"bob",
		);
		assert.equal(s.activity().seats.length, 2);
		assert.equal(s.store.getRoom(roomId).title, "Our native room");
		const shape = s.store
			.getRoom(roomId)
			.objects.find((o) => o.id === s.activityId);
		assert.equal(shape?.data.capability, "activity-stage");
		assert.ok(JSON.stringify(shape).length < 1000);
		s.store.flush();
		const restored = new RoomStore({ directory: s.directory });
		assert.deepEqual(
			readRoomOS(restored.getCanvasRecords(roomId)),
			s.engine.read(roomId),
		);
		restored.close();
		assert.throws(
			() => s.engine.launch({ ...s.launch, kind: "standup" }),
			/different operation/,
		);
	} finally {
		await s.close();
	}
});

test("typed speech follows its seat; repeated utterances deduplicate; mixed audio never inherits the listener", async () => {
	const s = setup();
	try {
		const side = s.activity().sides[0].id;
		s.act({ type: "seat", name: "Alice", sideId: side });
		s.act({ type: "say", text: "A triangle is rigid." }, "alice", "typed-once");
		s.act({ type: "say", text: "A triangle is rigid." }, "alice", "typed-once");
		s.engine.ingestVoice(roomId, "voice-session", {
			id: "caption-one",
			text: "The audio mixes two people.",
			role: "user",
		});
		s.engine.ingestVoice(roomId, "voice-session", {
			id: "caption-one",
			text: "The audio mixes two people.",
			role: "user",
		});
		s.engine.ingestVoice(roomId, "voice-session", {
			id: "assistant-caption",
			text: "Assistant output.",
			role: "assistant",
		});
		await s.engine.settled();
		const [typed, voice] = s.activity().utterances;
		assert.equal(s.activity().utterances.length, 2);
		assert.equal(typed.speakerId, "alice");
		assert.equal(typed.sideId, side);
		assert.equal(voice.speakerId, null);
		assert.equal(voice.sideId, null);
		assert.equal(s.activity().claims[1].speakerId, null);
		assert.equal(s.calls.extract, 2);
		s.act({
			type: "attribute",
			utteranceId: voice.id,
			speakerId: "alice",
			sideId: side,
		});
		assert.equal(s.activity().claims[1].speakerId, "alice");
		assert.equal(s.activity().utterances[1].text, voice.text);
	} finally {
		await s.close();
	}
});

test("late research cannot overwrite a corrected proposition or claim version", async () => {
	let finish: (value: EvidenceReport) => void = () => {};
	const s = setup({
		research: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	});
	try {
		s.act({
			type: "claim",
			text: "Every bridge is steel.",
			sideId: null,
			utteranceId: null,
		});
		const id = s.activity().claims[0].id;
		s.act({ type: "research", claimId: id });
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(s.activity().claims[0].research.status, "running");
		s.act({
			type: "correct",
			claimId: id,
			text: "Some bridges use steel.",
			sideId: null,
			reason: "The original was too broad.",
		});
		finish(evidence("Every bridge is steel."));
		await s.engine.settled();
		assert.equal(s.activity().claims[0].version, 2);
		assert.equal(s.activity().claims[0].evidence, null);
		assert.equal(s.activity().claims[0].research.status, "idle");
		assert.equal(
			s.activity().claims[0].corrections[0].text,
			"Every bridge is steel.",
		);
	} finally {
		await s.close();
	}
});

test("provider failure preserves raw speech and explicit retry does not duplicate existing claims", async () => {
	let attempts = 0;
	const s = setup({
		extract: async (_a, u) => {
			attempts++;
			if (attempts === 1) throw new Error("Fixture provider outage");
			return {
				plan: { ...emptyPlan(), contributions: [{ kind: 'claim', text: u.text, quote: u.text, subject: null, replacesClaimId: null }] },
				model: "fixture",
				responseId: "retry",
			};
		},
	});
	try {
		s.act({ type: "say", text: "A truss distributes load." });
		await s.engine.settled();
		const u = s.activity().utterances[0];
		assert.equal(u.extraction, "failed");
		assert.equal(u.text, "A truss distributes load.");
		s.act({ type: "extract", utteranceId: u.id });
		await s.engine.settled();
		s.act({ type: "extract", utteranceId: u.id });
		await s.engine.settled();
		assert.equal(attempts, 3);
		assert.equal(s.activity().claims.length, 1);
	} finally {
		await s.close();
	}
});

test("retention is bounded with an omitted count and background calls stop when capture is disabled", async () => {
	const s = setup();
	try {
		s.act({
			type: "configure",
			topic: "Retention",
			ambient: false,
			autoResearch: false,
		});
		for (let i = 0; i < 90; i++)
			s.act({ type: "say", text: `${i}: ${"x".repeat(1000)}` });
		await s.engine.settled();
		assert.equal(s.activity().utterances.length + s.activity().omitted, 90);
		assert.ok(s.activity().utterances.length <= 60);
		assert.ok(s.activity().events.length <= 80);
		assert.equal(s.calls.extract, 0);
		assert.ok(
			Buffer.byteLength(JSON.stringify(s.activity().utterances)) <= 64000,
		);
	} finally {
		await s.close();
	}
});

test("recovery marks orphaned enrichment for explicit retry and makes no paid calls", async () => {
	const s = setup();
	try {
		s.act({ type: "say", text: "Interrupted speech" });
		// Simulate process loss before the effect microtask dispatches.
		s.engine.close();
		await s.engine.settled();
		s.store.flush();
		const restoredStore = new RoomStore({ directory: s.directory });
		const restored = new ActivityEngine(restoredStore, s.providers);
		restored.recover(roomId);
		await restored.settled();
		assert.equal(
			restored.read(roomId).activities[0].utterances[0].extraction,
			"failed",
		);
		assert.equal(s.calls.extract, 0);
		restored.close();
		restoredStore.close();
	} finally {
		await s.close();
	}
});
