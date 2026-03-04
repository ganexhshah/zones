import { MatchStatus } from '@prisma/client';
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(8).max(20).optional(),
  password: z.string().min(8),
  name: z.string().min(2).max(80).optional(),
}).refine((v) => Boolean(v.email || v.phone), {
  message: 'Either email or phone is required',
});

export const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(8).max(20).optional(),
  password: z.string().min(8),
}).refine((v) => Boolean(v.email || v.phone), {
  message: 'Either email or phone is required',
});

export const createMatchSchema = z.object({
  entryFee: z.number().positive().max(100000),
  gameName: z.string().min(2).max(50).default('Free Fire'),
  roomType: z.enum(['CUSTOM_ROOM', 'LONE_WOLF']).default('CUSTOM_ROOM'),
  matchType: z.enum(['1v1', '2v2', '3v3', '4v4']).default('1v1'),
  rounds: z.number().int().min(1).max(99).default(7),
  defaultCoin: z.number().int().min(0).max(99999).default(9950),
  throwableLimit: z.boolean().default(false),
  characterSkill: z.boolean().default(false),
  allSkillsAllowed: z.boolean().default(true),
  selectedSkills: z.array(z.string().min(1).max(40)).max(60).default([]),
  headshotOnly: z.boolean().default(true),
  gunAttributes: z.boolean().default(false),
  platformFeePercent: z.number().min(0).max(100).default(5),
});

export const listMatchesSchema = z.object({
  status: z.preprocess(
    (value) => {
      if (value == null) return undefined;
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized || normalized.toLowerCase() == 'null' || normalized.toLowerCase() == 'undefined') {
          return undefined;
        }
        return normalized;
      }
      return value;
    },
    z.nativeEnum(MatchStatus).optional(),
  ),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const submitRoomSchema = z.object({
  roomId: z.string().min(1).max(128),
  roomPassword: z.string().min(1).max(128),
});

export const reviewJoinRequestSchema = z.object({
  action: z.enum(['accept', 'reject']),
  roomId: z.string().min(1).max(128).optional(),
  roomPassword: z.string().min(1).max(128).optional(),
}).refine(
  (data) => {
    if (data.action === 'accept') {
      return Boolean(data.roomId && data.roomPassword);
    }
    return true;
  },
  {
    message: 'roomId and roomPassword are required when accepting',
  }
);


export const submitResultSchema = z.object({
  winnerUserId: z.string().min(1),
  note: z.string().max(500).optional(),
  proofUrl: z.string().url().max(1000).optional(),
});

export const reportMatchSchema = z.object({
  reason: z.string().min(3).max(200),
  details: z.string().max(1000).optional(),
  proofUrl: z.string().url().max(1000).optional(),
});

export const verifyResultSchema = z.object({
  winnerUserId: z.string().min(1),
  platformFeePercent: z.number().min(0).max(100).default(5),
});

export const sendChatSchema = z.object({
  message: z.string().min(1).max(1000),
});

export function parseOrThrow<T>(schema: z.Schema<T>, payload: unknown): T {
  return schema.parse(payload);
}
