import { z } from 'zod';
const id = z.string().min(1).max(100);
export const memberProfileSchema = z.object({
  actor: id,
  avatarUrl: z.string().default(''),
  personalStrengths: z.array(z.string().max(160)).max(8).default([]),
  about: z.string().max(300).default(''),
  name: z.string().min(1).max(80),
  team: z.string().max(160),
  projects: z.array(z.string().max(160)).max(8),
  strengths: z.array(z.string().max(160)).max(8),
  source: z.enum(['self-described', 'linear']),
  sourceUrl: z.string().max(2048),
  fetchedAt: z.number(),
  linearId: z.string().nullable(),
  status: z.enum(['ready', 'pending', 'failed']),
  error: z.string().max(250).nullable(),
});
export const blockerSchema = z.object({
  id,
  title: z.string().min(1).max(180),
  ownerId: id,
  status: z.enum(['open', 'resolved']),
  resolution: z
    .object({
      actor: id,
      at: z.number(),
      utteranceId: id.nullable(),
      text: z.string().max(1500),
      source: z.literal('owner-statement'),
    })
    .nullable(),
  proof: z.string(),
});
export const commitmentSchema = z.object({
  id,
  title: z.string().min(1).max(180),
  prompt: z.string().min(1).max(4000),
  ownerId: id,
  blockedBy: z.array(id).min(1).max(8),
  authorizedDependencies: z
    .array(z.object({ id, title: z.string(), ownerId: id }))
    .max(8)
    .default([]),
  authorizedBy: id.nullable(),
  authorizedAt: z.number().nullable(),
  authorization: z.string(),
  status: z.enum(['blocked', 'ready', 'dispatching', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  jobId: id.nullable(),
  objectId: id.nullable(),
  error: z.string().max(250).nullable(),
});
export const meetingSchema = z.object({
  members: z.array(memberProfileSchema).max(24),
  blockers: z.array(blockerSchema).max(24),
  commitments: z.array(commitmentSchema).max(24),
  focus: z.record(id, id),
});
export type Meeting = z.infer<typeof meetingSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export const meetingCommands = [
  z.object({ type: z.literal('profile-self') }),
  z.object({
    type: z.literal('profile-strengths'),
    strengths: z.array(z.string().max(160)).max(8),
    about: z.string().max(300),
  }),
  z.object({
    type: z.literal('profile'),
    profile: memberProfileSchema.pick({
      name: true,
      team: true,
      projects: true,
      strengths: true,
      sourceUrl: true,
    }),
  }),
  z.object({ type: z.literal('profile-linear'), userId: z.string().uuid() }),
  z.object({
    type: z.literal('blocker'),
    title: z.string().trim().min(1).max(180),
    ownerId: id,
  }),
  z.object({ type: z.literal('focus-blocker'), blockerId: id }),
  z.object({
    type: z.literal('resolve-blocker'),
    blockerId: id,
    text: z.string().trim().min(1).max(1500),
  }),
  z.object({
    type: z.literal('commitment'),
    title: z.string().trim().min(1).max(180),
    prompt: z.string().trim().min(1).max(4000),
    ownerId: id,
    blockedBy: z.array(id).min(1).max(8),
  }),
  z.object({ type: z.literal('authorize-work'), commitmentId: id }),
  z.object({ type: z.literal('cancel-authorization'), commitmentId: id }),
  z.object({ type: z.literal('retry-dispatch'), commitmentId: id }),
] as const;
export const emptyMeeting = (): Meeting => ({
  members: [],
  blockers: [],
  commitments: [],
  focus: {},
});
