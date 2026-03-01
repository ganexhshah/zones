import { prisma } from '@/lib/prisma';

export type SystemSettings = {
  minDepositAmount: number;
  minWithdrawalAmount: number;
  autoApprovePayments: boolean;
};

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  minDepositAmount: 100,
  minWithdrawalAmount: 100,
  autoApprovePayments: false,
};

export async function getSystemSettings(): Promise<SystemSettings> {
  const row = await prisma.appConfig.findUnique({
    where: { id: 'global' },
  });

  if (!row) return DEFAULT_SYSTEM_SETTINGS;

  return {
    minDepositAmount: Number(row.minDepositAmount ?? DEFAULT_SYSTEM_SETTINGS.minDepositAmount),
    minWithdrawalAmount: Number(
      row.minWithdrawalAmount ?? DEFAULT_SYSTEM_SETTINGS.minWithdrawalAmount
    ),
    autoApprovePayments: Boolean(row.autoApprovePayments),
  };
}

export async function saveSystemSettings(
  input: Partial<SystemSettings>
): Promise<SystemSettings> {
  const current = await getSystemSettings();

  const minDepositAmount =
    input.minDepositAmount == null ? current.minDepositAmount : Number(input.minDepositAmount);
  const minWithdrawalAmount =
    input.minWithdrawalAmount == null
      ? current.minWithdrawalAmount
      : Number(input.minWithdrawalAmount);
  const autoApprovePayments =
    input.autoApprovePayments == null
      ? current.autoApprovePayments
      : Boolean(input.autoApprovePayments);

  const row = await prisma.appConfig.upsert({
    where: { id: 'global' },
    update: {
      minDepositAmount,
      minWithdrawalAmount,
      autoApprovePayments,
    },
    create: {
      id: 'global',
      minDepositAmount,
      minWithdrawalAmount,
      autoApprovePayments,
    },
  });

  return {
    minDepositAmount: Number(row.minDepositAmount),
    minWithdrawalAmount: Number(row.minWithdrawalAmount),
    autoApprovePayments: Boolean(row.autoApprovePayments),
  };
}
