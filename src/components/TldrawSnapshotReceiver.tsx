"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "tldraw";
import { useRoomContext } from "@livekit/components-react";
import { createLiveKitBus } from "@/lib/livekit/livekit-bus";

type Props = { editor?: Editor | null };

export default function TldrawSnapshotReceiver({ editor: propEditor }: Props) {
	const room = useRoomContext();
	const bus = useMemo(() => createLiveKitBus(room), [room]);
	const [editor, setEditor] = useState<Editor | null>(propEditor ?? null);
	const lastAppliedRef = useRef<number>(0);

	// Capture editor by prop, global, or event
	useEffect(() => {
		if (propEditor && editor !== propEditor) {
			setEditor(propEditor);
			return;
		}
		if (editor) return;
		try {
			const maybe = (window as any).__present?.tldrawEditor as
				| Editor
				| undefined;
			if (maybe) setEditor(maybe);
		} catch {}
		const handler = (e: Event) => {
			const ed = (e as CustomEvent).detail?.editor as Editor | undefined;
			if (ed) setEditor(ed);
		};
		window.addEventListener("present:editor-mounted", handler as EventListener);
		return () =>
			window.removeEventListener(
				"present:editor-mounted",
				handler as EventListener,
			);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [propEditor]);

	// Listen for incoming snapshots and apply them in a throttled, last-write-wins manner
	useEffect(() => {
		if (!editor) return;
		const off = bus.on("tldraw", (msg: any) => {
			try {
				if (!msg || msg.type !== "tldraw_snapshot") return;
				const ts =
					typeof msg.timestamp === "number" ? msg.timestamp : Date.now();
				if (ts <= lastAppliedRef.current) return;
				if (!msg.data) return;
				editor.loadSnapshot(msg.data);
				lastAppliedRef.current = ts;
			} catch {
				// ignore
			}
		});
		return off;
	}, [bus, editor]);

	return null;
}
