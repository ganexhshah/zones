import { prisma } from '@/lib/prisma';

export type CustomMatchMode = '1v1' | '2v2' | '3v3' | '4v4';

export type CustomOdds = Record<CustomMatchMode, number>;

export const DEFAULT_CUSTOM_ODDS: CustomOdds = {
  '1v1': 1.8,
  '2v2': 1.8,
  '3v3': 1.8,
  '4v4': 1.8,
};

function clampOdds(value: number) {
  if (!Number.isFinite(value)) return 1.8;
  return Math.min(2, Math.max(1, value));
}

export async function getCustomMatchOdds(): Promise<CustomOdds> {
  const row = await prisma.appConfig.findUnique({
    where: { id: 'global' },
    select: {
      customOdd1v1: true,
      customOdd2v2: true,
      customOdd3v3: true,
      customOdd4v4: true,
    },
  });

  if (!row) return DEFAULT_CUSTOM_ODDS;

  return {
    '1v1': clampOdds(Number(row.customOdd1v1 ?? DEFAULT_CUSTOM_ODDS['1v1'])),
    '2v2': clampOdds(Number(row.customOdd2v2 ?? DEFAULT_CUSTOM_ODDS['2v2'])),
    '3v3': clampOdds(Number(row.customOdd3v3 ?? DEFAULT_CUSTOM_ODDS['3v3'])),
    '4v4': clampOdds(Number(row.customOdd4v4 ?? DEFAULT_CUSTOM_ODDS['4v4'])),
  };
}

export async function saveCustomMatchOdds(input: Partial<CustomOdds>): Promise<CustomOdds> {
  const current = await getCustomMatchOdds();
  const odds: CustomOdds = {
    '1v1': clampOdds(input['1v1'] == null ? current['1v1'] : Number(input['1v1'])),
    '2v2': clampOdds(input['2v2'] == null ? current['2v2'] : Number(input['2v2'])),
    '3v3': clampOdds(input['3v3'] == null ? current['3v3'] : Number(input['3v3'])),
    '4v4': clampOdds(input['4v4'] == null ? current['4v4'] : Number(input['4v4'])),
  };

  await prisma.appConfig.upsert({
    where: { id: 'global' },
    update: {
      customOdd1v1: odds['1v1'],
      customOdd2v2: odds['2v2'],
      customOdd3v3: odds['3v3'],
      customOdd4v4: odds['4v4'],
    },
    create: {
      id: 'global',
      minDepositAmount: 100,
      minWithdrawalAmount: 100,
      systemSetupBalance: 50000,
      autoApprovePayments: false,
      customOdd1v1: odds['1v1'],
      customOdd2v2: odds['2v2'],
      customOdd3v3: odds['3v3'],
      customOdd4v4: odds['4v4'],
    },
  });

  return odds;
}

export function getModeOdd(odds: CustomOdds, mode: CustomMatchMode) {
  return odds[mode] ?? DEFAULT_CUSTOM_ODDS[mode];
}
