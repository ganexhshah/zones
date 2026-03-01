import { MatchStatus } from '@prisma/client';

type MatchLike = {
  id: string;
  gameName: string;
  roomType?: string;
  matchType: string;
  rounds?: number;
  defaultCoin?: number;
  throwableLimit?: boolean;
  characterSkill?: boolean;
  allSkillsAllowed?: boolean;
  selectedSkills?: unknown;
  headshotOnly?: boolean;
  gunAttributes?: boolean;
  creatorId: string;
  joinerId: string | null;
  entryFee: unknown;
  prizePool: unknown;
  status: MatchStatus;
  expiresAt: Date | null;
  createdAt: Date;
  creator?: { id: string; name: string | null; avatar: string | null };
  joiner?: { id: string; name: string | null; avatar: string | null } | null;
};

function decimalToNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  if (v && typeof v === 'object' && 'toString' in (v as Record<string, unknown>)) {
    return Number((v as { toString(): string }).toString());
  }
  return 0;
}

export function toMatchResponse(match: MatchLike) {
  return {
    id: match.id,
    gameName: match.gameName,
    roomType: match.roomType ?? 'CUSTOM_ROOM',
    matchType: match.matchType,
    rounds: match.rounds ?? 7,
    defaultCoin: match.defaultCoin ?? 9950,
    throwableLimit: match.throwableLimit ?? false,
    characterSkill: match.characterSkill ?? false,
    allSkillsAllowed: match.allSkillsAllowed ?? true,
    selectedSkills: Array.isArray(match.selectedSkills) ? match.selectedSkills : [],
    headshotOnly: match.headshotOnly ?? true,
    gunAttributes: match.gunAttributes ?? false,
    creatorId: match.creatorId,
    joinerId: match.joinerId,
    entryFee: decimalToNumber(match.entryFee),
    prizePool: decimalToNumber(match.prizePool),
    status: match.status,
    expiresAt: match.expiresAt,
    createdAt: match.createdAt,
    creator: match.creator,
    joiner: match.joiner,
  };
}

export function mapFrontendStatus(status: MatchStatus) {
  if (status === MatchStatus.PENDING_APPROVAL) return 'REQUESTED';
  if (status === MatchStatus.CONFIRMED) return 'ACCEPTED';
  return status;
}
