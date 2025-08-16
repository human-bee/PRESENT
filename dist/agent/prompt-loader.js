import { promises as fs } from 'fs';
import path from 'path';
const cache = {};
export async function getPrompt(name) {
    if (cache[name])
        return cache[name];
    // Attempt server-side file read first
    try {
        const filePath = path.join(process.cwd(), 'public', 'prompts', `${name}.txt`);
        const data = await fs.readFile(filePath, 'utf-8');
        cache[name] = data;
        return data;
    }
    catch {
        // Fallback to client-side fetch if running in browser
        const res = await fetch(`/prompts/${name}.txt`);
        const txt = await res.text();
        cache[name] = txt;
        return txt;
    }
}
//# sourceMappingURL=prompt-loader.js.map