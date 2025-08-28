"use client";

import React, { useEffect, useCallback } from "react";
import { useRoomContext } from "@livekit/components-react";
import { createLiveKitBus } from "../lib/livekit/livekit-bus";

/**
 * CanvasSyncAdapter
 * -----------------
 * Wrap any canvas-aware component with this helper to get automatic
 * bidirectional synchronisation through LiveKit data-channels.
 *
 * Props:
 *   componentId   – unique id you already pass to useTamboComponentState.
 *   onRemotePatch – function(patch) => void  (called when a peer/AI sends update)
 *   getItemCount  – optional function returning number of items for heartbeat metrics
 *
 * Usage:
 *   <CanvasSyncAdapter componentId={id} onRemotePatch={applyPatch} getItemCount={() => items.length}>
 *      <YourComponent ... />
 *   </CanvasSyncAdapter>
 */
export interface CanvasSyncAdapterProps {
	componentId: string;
	onRemotePatch?: (patch: Record<string, unknown>) => void;
	/** Optional function returning number of items for heartbeat metrics */
	getItemCount?: () => number;
	children: React.ReactNode;
}

export function CanvasSyncAdapter({
	componentId,
	onRemotePatch,
	getItemCount,
	children,
}: CanvasSyncAdapterProps) {
	const room = useRoomContext();
	const bus = createLiveKitBus(room);

	const sendPatch = useCallback(
		(patch: Record<string, unknown>) => {
			bus.send("ui_update", {
				componentId,
				patch,
				timestamp: Date.now(),
			});
		},
		[bus, componentId],
	);

	// Expose sendPatch via custom event so inner components can call without prop-drilling
	useEffect(() => {
		const handler = (e: Event) => {
			const custom = e as CustomEvent<{
				componentId: string;
				patch: Record<string, unknown>;
			}>;
			if (custom.detail.componentId === componentId) {
				sendPatch(custom.detail.patch);
			}
		};
		window.addEventListener("tambo:canvasPatch", handler);
		return () => window.removeEventListener("tambo:canvasPatch", handler);
	}, [sendPatch, componentId]);

	// Listen for remote patches
	useEffect(() => {
		const off = bus.on("ui_update", (msg: any) => {
			if (msg?.componentId === componentId && msg?.patch) {
				onRemotePatch?.(msg.patch);
			}
		});
		return off;
	}, [bus, componentId, onRemotePatch]);

	// Reply to heartbeat pings with local stats
	useEffect(() => {
		const offPing = bus.on("state_ping", (msg: any) => {
			if (msg?.type === "state_ping") {
				bus.send("state_pong", {
					type: "state_pong",
					source: "canvas",
					componentId,
					itemCount: getItemCount?.() ?? 0,
					timestamp: Date.now(),
				});
			}
		});
		return offPing;
	}, [bus, componentId, getItemCount]);

	return <>{children}</>;
}
