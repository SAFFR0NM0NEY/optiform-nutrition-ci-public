export const COMMERCE_FOUNDATION_CONTRACT = 'commerce-foundation-v1' as const;
export const COMMERCE_ENTITLEMENT_GRANTS_CONTRACT = 'commerce-entitlement-grants-v1' as const;
export const COMMERCE_PROVIDER_EVENTS_CONTRACT = 'commerce-provider-events-v1' as const;
export const COMMERCE_ACCESS_SNAPSHOT_CONTRACT = 'commerce-access-snapshot-v1' as const;

export type CommerceAccessSnapshot = {
  schemaVersion: 1;
  contractVersion: typeof COMMERCE_ACCESS_SNAPSHOT_CONTRACT;
  generatedAt: string;
  entitlements: Array<{
    entitlementKey: string;
    productKind:
      | 'optiform-pro'
      | 'creator-program'
      | 'creator-membership'
      | 'trainer-package'
      | 'gym-business-plan';
    resourceId?: string;
    status: 'active' | 'grace';
    validUntil?: string;
  }>;
};

export const commerceFoundationEnabled = () =>
  import.meta.env.VITE_ENABLE_COMMERCE_FOUNDATION === 'true';

export function assertCommerceAccessSnapshot(
  value: unknown,
): asserts value is CommerceAccessSnapshot {
  const item = value as Partial<CommerceAccessSnapshot>;
  if (
    !item ||
    typeof item !== 'object' ||
    item.schemaVersion !== 1 ||
    item.contractVersion !== COMMERCE_ACCESS_SNAPSHOT_CONTRACT ||
    typeof item.generatedAt !== 'string' ||
    !Array.isArray(item.entitlements) ||
    item.entitlements.length > 100 ||
    item.entitlements.some(
      (entry) =>
        !entry ||
        typeof entry.entitlementKey !== 'string' ||
        ![
          'optiform-pro',
          'creator-program',
          'creator-membership',
          'trainer-package',
          'gym-business-plan',
        ].includes(entry.productKind) ||
        !['active', 'grace'].includes(entry.status) ||
        (entry.validUntil !== undefined && typeof entry.validUntil !== 'string'),
    )
  )
    throw new Error('Commerce access returned an invalid response.');
}

export function commerceProductLabel(
  kind: CommerceAccessSnapshot['entitlements'][number]['productKind'],
) {
  return (
    {
      'optiform-pro': 'Optiform Pro',
      'creator-program': 'Creator programme',
      'creator-membership': 'Creator membership',
      'trainer-package': 'Trainer package',
      'gym-business-plan': 'Gym business plan',
    } as const
  )[kind];
}
