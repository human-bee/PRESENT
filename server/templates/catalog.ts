import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getIndexAbove } from '@tldraw/utils';
import type { TLRecord } from '@tldraw/tlschema';
import { objectToShape } from '../../shared/tldraw-adapter';
import { makeObject } from '../../shared/room';
import { exportRoomTemplate, parseRoomTemplate, type RoomTemplate, type TemplateSummary } from '../../shared/room-template';

function arrangement(name: string, notes: number, minutes: number): RoomTemplate {
  const records: TLRecord[] = [{ id: 'page:page', typeName: 'page', name: 'Page', index: getIndexAbove(), meta: {} } as TLRecord];
  let index = getIndexAbove();
  for (let i = 0; i <= notes; i++) {
    const object = makeObject(i === notes ? 'timer' : 'note', '', { x: i === notes ? 820 : (i % 3) * 260, y: Math.floor(i / 3) * 260 }, i === notes ? { durationMs: minutes * 60_000 } : { color: ['mint', 'violet', 'blue'][i % 3] });
    object.w = i === notes ? 280 : 220; object.h = i === notes ? 230 : 220;
    records.push(objectToShape(object, { index })); index = getIndexAbove(index);
  }
  return exportRoomTemplate(records, name);
}
export const builtInTemplates: ReadonlyMap<string, RoomTemplate> = new Map([
  ['builtin-focus', arrangement('Focus · one thought, 25 minutes', 1, 25)],
  ['builtin-retro', arrangement('Retrospective · six thoughts, 15 minutes', 6, 15)],
  ['builtin-brainstorm', arrangement('Brainstorm · nine thoughts, 5 minutes', 9, 5)],
]);
/** Server-local catalog. The host must scope this directory to its authorized audience. */
export class TemplateCatalog {
  constructor(private directory: string) {}
  get(id: string): RoomTemplate | undefined {
    if (builtInTemplates.has(id)) return structuredClone(builtInTemplates.get(id)!);
    if (!/^[a-f0-9]{32}$/.test(id)) return undefined;
    try { return parseRoomTemplate(JSON.parse(readFileSync(join(this.directory, `${id}.json`), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  list(): TemplateSummary[] {
    let files: string[] = [];
    try { files = readdirSync(this.directory).filter(f => /^[a-f0-9]{32}\.json$/.test(f)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return [...builtInTemplates.keys(), ...files.map(f => f.slice(0, -5))].map(id => {
      const t = this.get(id)!;
      return { id, name: t.name, objects: t.records.filter(r => r.typeName === 'shape').length, omissions: t.notices.length };
    });
  }
  save(input: unknown): { id: string; template: RoomTemplate } {
    const template = parseRoomTemplate(input);
    if (!template.records.some(r => r.typeName === 'shape')) throw new Error('No reusable native instruments remain.');
    if (this.list().length >= 103) throw new Error('Template catalog is full.');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const id = randomBytes(16).toString('hex');
    writeFileSync(join(this.directory, `${id}.json`), JSON.stringify(template), { flag: 'wx', mode: 0o600 });
    return { id, template };
  }
}
