import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const delayMs = 120;
const sentence = 'Every shared thought deserves every character, even when the network takes its time. The dragon still likes tea.';
type Sample = { event: string; atMs: number; expected: string; actual: string; shared: unknown; focused: boolean };
type DocumentWindow = Window & {
  __documentTypingProof: { typed: number; samples: Sample[] };
  present: { getState(): { markdown?: unknown } };
};

async function delayNativeMessages(page: Page) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const deliveries: number[] = [];
  await page.routeWebSocket(url => url.pathname === '/connect', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const queuedAt = Date.now();
      const timer = setTimeout(() => {
        timers.delete(timer);
        deliveries.push(Date.now() - queuedAt);
        socket.send(message);
      }, delayMs);
      timers.add(timer);
    });
  });
  return { deliveries, stop: () => { for (const timer of timers) clearTimeout(timer); timers.clear(); } };
}

test('fast shared-document typing preserves every character through delayed native sync and reload', async ({ browser, baseURL }, info) => {
  const roomId = randomBytes(16).toString('hex');
  const a = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await a.addInitScript(() => { if (window === window.top) localStorage.setItem('present:name', 'Document writer'); });
  await b.addInitScript(() => { if (window === window.top) localStorage.setItem('present:name', 'Document reader'); });
  const [writer, reader] = await Promise.all([a.newPage(), b.newPage()]);
  const [writerLag, readerLag] = await Promise.all([delayNativeMessages(writer), delayNativeMessages(reader)]);
  const report: Record<string, unknown> = { roomId, at: new Date().toISOString(), sentence, nativeMessageDelayMs: delayMs, typingDelayMs: 15 };
  try {
    await Promise.all([writer.goto(`/r/${roomId}`), reader.goto(`/r/${roomId}`)]);
    await expect(writer.locator('.room-status')).toHaveText('here, together');
    await expect(reader.locator('.room-status')).toHaveText('here, together');
    await writer.getByRole('button', { name: 'Add to room', exact: true }).click();
    await writer.getByRole('button', { name: 'Shared document Write Markdown, preview it and save versions.' }).click();
    const localFrame = writer.frameLocator('iframe[title="Shared document"]');
    const remoteFrame = reader.frameLocator('iframe[title="Shared document"]');
    const local = localFrame.getByRole('textbox', { name: 'Document Markdown' });
    const remote = remoteFrame.getByRole('textbox', { name: 'Document Markdown' });
    await expect(local).toHaveValue('');
    await expect(remote).toHaveValue('');
    // Observe genuine input/state/blur events without writing any editor or widget state.
    await local.evaluate((element, text) => {
      const input = element as HTMLTextAreaElement;
      const view = input.ownerDocument.defaultView as unknown as DocumentWindow;
      const proof = { typed: 0, samples: [] as Sample[] };
      view.__documentTypingProof = proof;
      const startedAt = performance.now();
      const record = (event: string) => proof.samples.push({ event, atMs: Math.round(performance.now() - startedAt),
        expected: text.slice(0, proof.typed), actual: input.value, shared: view.present.getState().markdown,
        focused: input.ownerDocument.activeElement === input });
      input.addEventListener('beforeinput', event => { if ((event as InputEvent).inputType === 'insertText') proof.typed += (event as InputEvent).data?.length ?? 0; });
      input.addEventListener('input', () => record('input'));
      input.addEventListener('blur', () => record('blur'));
      view.addEventListener('present:state', () => record('shared-state'));
    }, sentence);
    await local.pressSequentially(sentence, { delay: 15 });
    report.localAfterTyping = await local.inputValue();
    // A real click away must not replace just-typed characters with an older acknowledgement.
    await localFrame.getByRole('heading', { name: 'Shared document', exact: true }).click();
    report.localAfterBlur = await local.inputValue();
    expect.soft(report.localAfterTyping).toBe(sentence);
    expect.soft(report.localAfterBlur).toBe(sentence);
    await expect.soft(remote).toHaveValue(sentence);
    await expect.soft(local).toHaveValue(sentence);
    report.localAfterSync = await local.inputValue();
    report.remoteAfterSync = await remote.inputValue();
    const canonicalMarkdown = async () => {
      const response = await writer.request.get(`/api/room/${roomId}`);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      return payload.room.objects.find((object: { data?: { capability?: string } }) => object.data?.capability === 'document')?.data.state.markdown;
    };
    await expect.soft.poll(canonicalMarkdown).toBe(sentence);
    report.canonicalMarkdown = await canonicalMarkdown();
    // Include acknowledgements after blur, so a later transient rollback also fails.
    const proof = await local.evaluate(element => (element.ownerDocument.defaultView as unknown as DocumentWindow).__documentTypingProof);
    report.samples = proof.samples;
    const firstLoss = proof.samples.find(sample => sample.actual !== sample.expected);
    if (firstLoss) {
      let commonPrefix = 0;
      while (commonPrefix < firstLoss.expected.length && firstLoss.expected[commonPrefix] === firstLoss.actual[commonPrefix]) commonPrefix++;
      report.firstLostCharacter = { ...firstLoss, characterIndex: commonPrefix + 1, expectedCharacter: firstLoss.expected[commonPrefix], expectedTail: firstLoss.expected.slice(commonPrefix), actualTail: firstLoss.actual.slice(commonPrefix) };
    }
    expect.soft(proof.typed, 'Every requested key must produce a real input event').toBe(sentence.length);
    expect.soft(proof.samples.filter(sample => sample.event === 'input').map(sample => sample.actual), 'Local input must preserve every typed prefix').toEqual([...sentence].map((_, index) => sentence.slice(0, index + 1)));
    expect.soft(firstLoss, 'A delayed acknowledgement must never erase a local character, including on blur').toBeUndefined();
    await writer.screenshot({ path: info.outputPath('native-document-after-typing.png') });
    await Promise.all([writer.reload(), reader.reload()]);
    await expect.soft(local).toHaveValue(sentence);
    await expect.soft(remote).toHaveValue(sentence);
    report.localAfterReload = await local.inputValue();
    report.remoteAfterReload = await remote.inputValue();
  } finally {
    writerLag.stop(); readerLag.stop();
    report.nativeDeliveryDelaysMs = { writer: writerLag.deliveries, reader: readerLag.deliveries };
    const path = info.outputPath('native-document-typing-proof.json');
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
    await info.attach('native-document-typing-proof', { path, contentType: 'application/json' });
    await Promise.all([a.close(), b.close()]);
  }
});

test('focused peers see alternating document edits and keep keyboard selection useful', async ({ browser, baseURL }) => {
  const roomId = randomBytes(16).toString('hex');
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await Promise.all(pages.map(page => page.goto(`/r/${roomId}`)));
    for (const page of pages) await expect(page.locator('.room-status')).toHaveText('here, together');
    await pages[0].getByRole('button', { name: 'Add to room', exact: true }).click();
    await pages[0].getByRole('button', { name: 'Shared document Write Markdown, preview it and save versions.' }).click();
    const fields = pages.map(page => page.frameLocator('iframe[title="Shared document"]').getByRole('textbox', { name: 'Document Markdown' }));
    for (let i = 0; i < 10; i++) {
      const actor = i % 2, other = 1 - actor, value = `Decision ${i}: preserve the shared correction.`;
      await fields[other].click();
      await fields[actor].fill(value);
      await expect(fields[other]).toHaveValue(value);
      await expect(fields[other]).toBeFocused();
    }
    await fields[0].fill('Hello world'); await expect(fields[1]).toHaveValue('Hello world');
    await fields[1].press('Home'); await fields[1].press('ArrowRight');
    await fields[0].press('End'); await fields[0].pressSequentially('!');
    await expect(fields[1]).toHaveValue('Hello world!');
    expect(await fields[1].evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(1);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
