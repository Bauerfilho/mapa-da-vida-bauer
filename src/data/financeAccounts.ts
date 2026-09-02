export const CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID = {
  "seed-finance-mercado-pago": "Mercado Pago",
  "seed-finance-banco-do-brasil": "Banco do Brasil",
  "seed-finance-picpay": "PicPay",
} as const;

export type CanonicalFinanceAccountId =
  keyof typeof CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID;

export type CanonicalFinanceAccountProvider =
  (typeof CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID)[CanonicalFinanceAccountId];

export function canonicalFinanceAccountProvider(
  entityId: string,
): CanonicalFinanceAccountProvider | null {
  return Object.hasOwn(CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID, entityId)
    ? CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID[entityId as CanonicalFinanceAccountId]
    : null;
}
