// A healthy previous revision is not evidence that this commit is deployed.
const target = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(target ?? '')) throw new Error('A source revision is required.');
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch('https://present-native-production.up.railway.app/healthz', { signal: AbortSignal.timeout(10_000) });
    if (response.ok && (await response.json()).revision === target) { console.log(`Staging is serving ${target}.`); process.exit(0); }
  } catch { /* A volume-backed deploy can briefly interrupt service. */ }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error('Staging did not become healthy at the requested revision.');
