import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCommand } from '../server/agents/command-receipt';

test('long command receipts preserve the actual terminal command and mark omitted content', () => {
  const original = `cat > /work/example.cjs <<'EOF'\n${'source '.repeat(100)}\nEOF\nnode --test example.test.cjs`;
  const result = describeCommand(original, '/work');
  assert.ok(result.command.length <= 300); assert.ok(result.command.endsWith('node --test example.test.cjs'));
  assert.equal(result.truncated, true); assert.match(result.commandSha256, /^[a-f0-9]{64}$/);
  assert.equal(describeCommand('node --test example.test.cjs', '/work').truncated, false);
});
