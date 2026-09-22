import { createHash } from 'node:crypto';
/** Preserve both the setup and terminal command in bounded execution receipts. */
export function describeCommand(command: string, cwd: string) {
  const normalized = command.replaceAll(cwd, '.').replace(/[\p{Cc}\p{Cf}]/gu, ' ');
  return { command: normalized.length <= 300 ? normalized : `${normalized.slice(0, 125)} …[middle omitted]… ${normalized.slice(-150)}`,
    truncated: normalized.length > 300, commandSha256: createHash('sha256').update(command).digest('hex') };
}
