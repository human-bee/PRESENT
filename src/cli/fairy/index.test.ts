import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from './index';

describe('fairy CLI', () => {
  let tmpDir: string;
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fairy-cli-test-'));
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates and persists a session', async () => {
    const code = await runCli(
      ['sessions', 'create', '--room', 'canvas-abc', '--baseUrl', 'http://127.0.0.1:3000', '--json'],
      tmpDir,
    );

    expect(code).toBe(0);
    const raw = await fs.readFile(path.join(tmpDir, '.fairy-cli', 'state.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.currentSessionId).toBe(parsed.sessions[0].id);
    expect(parsed.sessions[0].room).toBe('canvas-abc');
  });

  it('returns failed exit code on unknown command group', async () => {
    const code = await runCli(['banana', '--json'], tmpDir);
    expect(code).toBe(20);
  });
});
