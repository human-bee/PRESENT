export function normalizeTranscript(transcript) {
    const trimmed = transcript.trim();
    const lower = trimmed.toLowerCase();
    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    return {
        raw: transcript,
        trimmed,
        lower,
        wordCount,
    };
}
//# sourceMappingURL=normalize.js.map