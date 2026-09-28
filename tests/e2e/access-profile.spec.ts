import { test, expect, type Page } from '@playwright/test';
const note = (page: Page) => page.locator('.tl-note__container').first();
async function editNote(page: Page, text: string) {
  await note(page).dblclick({ position: { x: 90, y: 80 } });
  await note(page).locator('[contenteditable="true"]').fill(text);
  await page.keyboard.press('Escape');
}
test('owner creates, editor joins/edits/reconnects, viewer is denied, revoke closes, template navigates', async ({ browser, baseURL }, info) => {
  const ownerContext = await browser.newContext({ baseURL }), guestContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage(), guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await owner.goto('/');
    await expect(owner.getByRole('heading', { name: 'Make room.' })).toBeVisible();
    await owner.getByRole('button', { name: 'Create a room', exact: true }).click();
    await expect(owner).toHaveURL(/\/r\/[a-f0-9]{48}$/);
    await expect(owner.getByText('here, together', { exact: true })).toBeVisible();
    const roomURL = owner.url(), roomId = roomURL.split('/').pop()!;
    await owner.getByRole('button', { name: 'Invite', exact: true }).click();
    await owner.getByRole('button', { name: 'Create invite', exact: true }).click();
    const editorLink = await owner.getByLabel('Room link', { exact: true }).inputValue();
    await guest.goto(editorLink);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest).toHaveURL(roomURL);
    await expect(guest.getByText('here, together', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Close room panel' }).click();
    await owner.getByRole('button', { name: 'Leave a thought' }).click();
    await editNote(owner, 'Shared native edit');
    await expect(note(guest).locator('.tl-text-content')).toContainText('Shared native edit');
    await editNote(guest, 'Editor native reply');
    await expect(note(owner).locator('.tl-text-content')).toContainText('Editor native reply');
    await guest.reload();
    await expect(note(guest).locator('.tl-text-content')).toContainText('Editor native reply');
    await owner.getByRole('button', { name: 'Invite', exact: true }).click();
    // Opening the panel anew intentionally clears the one-time displayed token, but persisted invite IDs remain manageable.
    await owner.getByText('Manage access', { exact: true }).click();
    await owner.getByRole('button', { name: 'Remove participant', exact: true }).click();
    await expect(guest.getByText('Your room access has ended. Ask the owner for help.')).toBeVisible();
    expect((await guest.request.get(`/api/room/${roomId}`)).status()).toBe(403);
    // Reuse the same isolated guest browser context as a fresh anonymous identity for the viewer leg.
    await guestContext.clearCookies();
    await owner.getByLabel('Can', { exact: true }).selectOption('viewer');
    await owner.getByRole('button', { name: 'Create invite', exact: true }).click();
    const viewerLink = await owner.getByLabel('Room link', { exact: true }).inputValue();
    await guest.goto(viewerLink);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByText('View only · You can explore the canvas and listen', { exact: false })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Create with agent' })).toHaveCount(0);
    expect((await guest.request.post(`/api/room/${roomId}/operation`, { headers: { origin: baseURL! }, data: { actor: 'forged-owner', requestId: 'viewer-write', operation: { type: 'rename', title: 'Forbidden' } } })).status()).toBe(403);
    await owner.getByLabel('Reusable template name').fill('Private smoke layout');
    await owner.getByRole('button', { name: 'Save this layout' }).click();
    await expect(owner.getByText('Private smoke layout', { exact: true })).toBeVisible();
    const before = owner.url();
    await owner.getByRole('listitem').filter({ hasText: 'Focus · one thought' }).getByRole('button', { name: 'Use', exact: true }).click();
    await expect(owner).not.toHaveURL(before);
    await expect(owner.getByText('here, together', { exact: true })).toBeVisible();
    await expect(note(owner)).toBeVisible();
    await editNote(owner, 'Fresh editable template');
    await expect(note(owner).locator('.tl-text-content')).toContainText('Fresh editable template');
    const screenshot = await owner.screenshot({ fullPage: false });
    await info.attach('fresh-template', { body: screenshot, contentType: 'image/png' });
    expect(errors).toEqual([]);
  } finally { await ownerContext.close(); await guestContext.close(); }
});
