import { backupData, createBackupKey, restoreData } from '../server/operations/data-backup';

const [command, ...args] = process.argv.slice(2);
const values = new Map<string, string>();
try {
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--key', '--data', '--archive', '--destination'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error('Use keygen --key FILE; backup --data DIR --archive FILE --key FILE; restore --archive FILE --destination NEW_DIR --key FILE.');
    values.set(flag, value);
  }
  const requireValue = (flag: string) => { const value = values.get(flag); if (!value) throw new Error(`Missing ${flag}.`); return value; };
  if (command === 'keygen' && values.size === 1) { createBackupKey(requireValue('--key')); process.stdout.write('Created a private 32-byte backup key. Store it separately from the archive.\n'); }
  else if (command === 'backup' && values.size === 3) process.stdout.write(`${JSON.stringify(backupData(requireValue('--data'), requireValue('--archive'), requireValue('--key')))}\n`);
  else if (command === 'restore' && values.size === 3) process.stdout.write(`${JSON.stringify(restoreData(requireValue('--archive'), requireValue('--destination'), requireValue('--key')))}\n`);
  else throw new Error('Use keygen, backup or restore with the documented flags.');
} catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Backup operation failed.'}\n`); process.exitCode = 1; }
