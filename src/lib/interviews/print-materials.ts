import type { InterviewAsset } from '@present/contracts/interview-studio';
import type { BriefSnapshot } from '@present/contracts/interviews';

export const escapeBriefHtml = (value: string) => value.replace(/[&<>"']/g,(char) => ({ '&': '&amp;','<': '&lt;','>': '&gt;','"': '&quot;',"'": '&#39;' }[char]!));
export function renderPrintMaterials(snapshot: BriefSnapshot, loadFile?: (asset: InterviewAsset) => Uint8Array) {
  const assets = snapshot.studio.assets.filter((asset) => asset.included);
  if (!assets.length) return '';
  let bytes = 0;
  const content = assets.map((asset) => {
    let source = asset.url || '';
    if (asset.fileId && asset.mime && loadFile) {
      const file = loadFile(asset); bytes += file.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error('Included materials exceed the 16 MB export limit.');
      source = `data:${asset.mime};base64,${Buffer.from(file).toString('base64')}`;
    }
    const image = asset.kind === 'image' && source ? `<img alt="${escapeBriefHtml(asset.caption || asset.title)}" src="${escapeBriefHtml(source)}">` : '';
    const link = source ? `<a href="${escapeBriefHtml(source)}" ${asset.fileId ? `download="${escapeBriefHtml(asset.title)}"` : 'target="_blank" rel="noreferrer"'}>${asset.fileId ? 'Open original file' : escapeBriefHtml(asset.url || '')}</a>` : '';
    return `<figure><h3>${escapeBriefHtml(asset.title)}</h3>${image}${asset.text ? `<p>${escapeBriefHtml(asset.text)}</p>` : ''}${asset.caption ? `<figcaption>${escapeBriefHtml(asset.caption)}</figcaption>` : ''}${link}</figure>`;
  }).join('');
  return `<section class="materials"><h2>Work samples & materials</h2>${content}</section>`;
}
