/**
 * KeysRequiredBanner
 *
 * Displayed when BYOK mode is enabled and the canvas owner has not configured
 * the required provider keys yet.
 */

'use client';

import { z } from 'zod';

export const keysRequiredBannerSchema = z.object({
  title: z
    .string()
    .optional()
    .default('Model keys required')
    .describe('Headline for the banner'),
  message: z
    .string()
    .optional()
    .default('AI features are disabled until the canvas owner adds model keys.')
    .describe('Supporting message'),
  href: z
    .string()
    .optional()
    .default('/settings/keys')
    .describe('Link to the settings page where keys can be configured'),
  missingProviders: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Providers that are missing a required key'),
});

export type KeysRequiredBannerProps = z.infer<typeof keysRequiredBannerSchema>;

export function KeysRequiredBanner(props: Partial<KeysRequiredBannerProps>) {
  const parsed = keysRequiredBannerSchema.safeParse(props);
  const title = parsed.success ? parsed.data.title : 'Model keys required';
  const message = parsed.success ? parsed.data.message : 'AI features are disabled until the canvas owner adds model keys.';
  const href = parsed.success ? parsed.data.href : '/settings/keys';
  const missingProviders = parsed.success ? parsed.data.missingProviders : [];

  return (
    <div className="w-[520px] max-w-full rounded-xl border border-amber-300/70 bg-amber-50/90 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-200/70 text-amber-900">
          !
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-900">{title}</div>
          <div className="mt-1 text-xs leading-5 text-amber-900/80">{message}</div>

          {missingProviders.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {missingProviders.map((provider) => (
                <span
                  key={provider}
                  className="rounded-full border border-amber-300/60 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
                >
                  {provider}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <a
              href={href}
              className="inline-flex items-center rounded-md bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-800"
            >
              Configure keys
            </a>
            <span className="text-[11px] text-amber-900/70">This only needs to be done once per account.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

