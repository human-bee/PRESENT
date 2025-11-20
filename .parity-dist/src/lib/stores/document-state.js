// Lightweight in-memory document state with naive word-diffing.
function diffWords(oldText, newText) {
    const diffs = [];
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
        const a = (oldLines[i] || '').split(/\s+/).filter(Boolean);
        const b = (newLines[i] || '').split(/\s+/).filter(Boolean);
        const len = Math.max(a.length, b.length);
        for (let j = 0; j < len; j++) {
            if (a[j] !== b[j]) {
                if (a[j] && !b[j]) {
                    diffs.push({ type: 'removed', content: a[j], lineNumber: i + 1, wordIndex: j });
                }
                else if (!a[j] && b[j]) {
                    diffs.push({ type: 'added', content: b[j], lineNumber: i + 1, wordIndex: j });
                }
                else if (a[j] && b[j]) {
                    // changed: mark removal and addition
                    diffs.push({ type: 'removed', content: a[j], lineNumber: i + 1, wordIndex: j });
                    diffs.push({ type: 'added', content: b[j], lineNumber: i + 1, wordIndex: j });
                }
            }
        }
    }
    return diffs;
}
export function generateWordDiff(oldText, newText) {
    return diffWords(oldText || '', newText || '');
}
class DocumentState {
    constructor() {
        this.docs = [];
        this.listeners = new Set();
    }
    getDocuments() {
        return this.docs;
    }
    subscribe(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    updateDocument(id, content) {
        const idx = this.docs.findIndex((d) => d.id === id);
        if (idx === -1) {
            const doc = { id, content, originalContent: content, diffs: [] };
            this.docs.push(doc);
        }
        else {
            const current = this.docs[idx];
            const original = current.originalContent ?? current.content;
            const diffs = generateWordDiff(original, content);
            this.docs[idx] = { ...current, content, diffs };
        }
        this.emit();
    }
    emit() {
        const snap = [...this.docs];
        this.listeners.forEach((cb) => {
            try {
                cb(snap);
            }
            catch { }
        });
    }
}
export const documentState = new DocumentState();
//# sourceMappingURL=document-state.js.map