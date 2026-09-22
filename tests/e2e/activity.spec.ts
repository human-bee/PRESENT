import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("audience suggestions are moderated, voted, brought on air and retained across reconnects", async ({
	browser,
	baseURL,
}, info) => {
	const roomId = randomBytes(16).toString("hex");
	const hostContext = await browser.newContext({
		baseURL,
		viewport: { width: 1440, height: 1000 },
		recordVideo: { dir: info.outputPath("host") },
	});
	const audienceContext = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		recordVideo: { dir: info.outputPath("audience") },
	});
	const host = await hostContext.newPage(),
		viewer = await audienceContext.newPage();
	try {
		await host.goto(`/r/${roomId}`);
		await expect(host.locator(".room-status")).toHaveText("here, together");
		await host
			.getByRole("button", { name: "◈ Activities", exact: true })
			.click();
		await host
			.locator(".activity-template-grid button")
			.filter({ has: host.getByText("Live room", { exact: true }) })
			.click();
		const state = await (
			await host.request.get(`/api/activity/state?roomId=${roomId}`)
		).json();
		await viewer.goto(`/r/${roomId}?audience=${state.activeId}`);
		const v = viewer.getByRole("dialog"),
			h = host.getByRole("dialog");
		await v
			.getByLabel("Display name", { exact: true })
			.fill("Fixture audience participant");
		await v.getByLabel("Your suggestion").fill("Let’s play a geography game.");
		await v.getByLabel("Suggestion type").selectOption("game");
		await v.getByRole("button", { name: "Send to the host ↗" }).click();
		const incoming = h
			.locator(".audience-inbox>article")
			.filter({ hasText: "Let’s play a geography game." });
		await expect(incoming).toContainText("Fixture audience participant");
		await incoming.getByRole("button", { name: "Add to next up" }).click();
		await v.getByRole("button", { name: "↑ 0", exact: true }).click();
		await expect(h.locator(".audience-queue-card")).toContainText("↑ 1");
		await h.getByRole("button", { name: "Bring on air ↗" }).click();
		await expect(v.locator(".audience-onair")).toContainText(
			"Let’s play a geography game.",
		);
		await audienceContext.setOffline(true);
		await h.getByRole("button", { name: "Finish this segment ✓" }).click();
		await audienceContext.setOffline(false);
		await expect(v.locator(".audience-onair")).toContainText(
			"The stage is yours.",
		);
		await viewer.reload();
		await expect(
			viewer.getByRole("dialog").locator(".audience-onair"),
		).toContainText("The stage is yours.");
		await host.screenshot({ path: info.outputPath("audience-host.png") });
		await viewer.screenshot({ path: info.outputPath("audience-mobile.png") });
	} finally {
		await Promise.all([hostContext.close(), audienceContext.close()]);
	}
});

test("two participants instantly launch, take opposing seats, correct claims and reload the same native activity", async ({
	browser,
	baseURL,
}, info) => {
	const roomId = randomBytes(16).toString("hex");
	const contexts = await Promise.all(
		["Alice", "Bob"].map(async (name) => {
			const context = await browser.newContext({
				baseURL,
				viewport: { width: 1440, height: 1000 },
				recordVideo: {
					dir: info.outputPath(name),
					size: { width: 1440, height: 1000 },
				},
			});
			await context.addInitScript((name) => {
				localStorage.setItem("present:name", name);
				navigator.mediaDevices.getUserMedia = async () => {
					throw new Error("Physical devices are disabled for this test.");
				};
			}, name);
			return context;
		}),
	);
	const [alice, bob] = await Promise.all(contexts.map((c) => c.newPage()));
	const errors: string[] = [];
	for (const page of [alice, bob])
		page.on("pageerror", (e) => errors.push(e.message));
	try {
		await Promise.all([alice.goto(`/r/${roomId}`), bob.goto(`/r/${roomId}`)]);
		await expect(alice.locator(".room-status")).toHaveText("here, together");
		await alice
			.getByRole("button", { name: "◈ Activities", exact: true })
			.click();
		const started = Date.now();
		await alice.getByRole("button", { name: "↔ Debate Take a side." }).click();
		const a = alice.getByRole("dialog", { name: "Debate room" });
		await expect(
			a.getByRole("heading", { name: "A good disagreement" }),
		).toBeVisible();
		const setupMs = Date.now() - started;
		await a.getByRole("button", { name: "Adapt activity" }).click();
		await a.getByLabel("Room topic").fill("How should we cross the river?");
		await a.getByLabel("Follow the conversation").uncheck();
		await a.getByRole("button", { name: "Save adaptation" }).click();
		await bob.getByRole("button", { name: "Open Debate", exact: true }).click();
		const b = bob.getByRole("dialog", { name: "Debate room" });
		await expect(
			b.getByRole("heading", { name: "How should we cross the river?" }),
		).toBeVisible();
		await Promise.all([
			a
				.getByRole("region", { name: "For side", exact: true })
				.getByRole("button", { name: "Take a seat" })
				.click(),
			b
				.getByRole("region", { name: "Against side", exact: true })
				.getByRole("button", { name: "Take a seat" })
				.click(),
		]);
		await Promise.all([
			a
				.getByRole("textbox", { name: "Add to the conversation" })
				.fill("Every bridge is made of steel."),
			b
				.getByRole("textbox", { name: "Add to the conversation" })
				.fill("Stone bridges offer a counterexample."),
		]);
		await Promise.all([
			a.getByRole("button", { name: "Add thought ↗" }).click(),
			b.getByRole("button", { name: "Add thought ↗" }).click(),
		]);
		await expect(a.getByRole("log")).toContainText(
			"Stone bridges offer a counterexample.",
		);
		await expect(b.getByRole("log")).toContainText(
			"Every bridge is made of steel.",
		);
		await a
			.locator(".conversation-entry")
			.filter({ hasText: "Every bridge is made of steel." })
			.getByRole("button", { name: "Capture claim" })
			.click();
		const card = b
			.locator(".claim-card")
			.filter({ hasText: "Every bridge is made of steel." });
		await card.getByRole("button", { name: "Correct / discuss" }).click();
		await card
			.getByLabel("Claim wording", { exact: true })
			.fill("Some bridges are made of steel.");
		await card
			.getByLabel("Reason")
			.fill("Stone and concrete bridges are counterexamples.");
		await card.getByRole("button", { name: "Save correction" }).click();
		await expect(a.locator(".claim-proposition")).toHaveText(
			"Some bridges are made of steel.",
		);
		await expect(a.locator(".claim-meta")).toContainText("v2");
		await alice.screenshot({
			path: info.outputPath("debate-two-participants.png"),
		});
		await Promise.all([alice.reload(), bob.reload()]);
		await expect(
			alice.getByRole("dialog").locator(".claim-proposition"),
		).toHaveText("Some bridges are made of steel.");
		await expect(bob.getByRole("dialog").getByRole("log")).toContainText(
			"Every bridge is made of steel.",
		);
		expect(errors).toEqual([]);
		await info.attach("setup timing", {
			body: JSON.stringify({
				setupMs,
				boundary:
					"button click through first visible activity heading; no provider call",
				roomId,
			}),
			contentType: "application/json",
		});
	} finally {
		await Promise.all(contexts.map((c) => c.close()));
	}
});
