export const COMMERCE_FOUNDATION_CONTRACT = 'commerce-foundation-v1' as const;
export const COMMERCE_ENTITLEMENT_GRANTS_CONTRACT = 'commerce-entitlement-grants-v1' as const;
export const COMMERCE_PROVIDER_EVENTS_CONTRACT = 'commerce-provider-events-v1' as const;
export const COMMERCE_ACCESS_SNAPSHOT_CONTRACT = 'commerce-access-snapshot-v1' as const;
export const COMMERCIAL_PLAN_CATALOG_CONTRACT = 'commercial-plan-catalog-v1' as const;

export type CommercialPlanCatalog = {
  schemaVersion: 1;
  contractVersion: typeof COMMERCIAL_PLAN_CATALOG_CONTRACT;
  catalogVersion: string;
  plans: Array<{
    planId: string;
    audience: 'athlete' | 'trainer' | 'gym-business';
    displayName: string;
    productKind: CommerceAccessSnapshot['entitlements'][number]['productKind'];
    status: 'draft' | 'available' | 'retired';
    billingCadences: Array<'monthly' | 'annual' | 'one-time'>;
    priceConfiguration:
      { state: 'pending' } | { state: 'configured'; priceMinor: number; currency: string };
    includedTrainerClientSeats?: number;
  }>;
};

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

export function assertCommercialPlanCatalog(
  value: unknown,
): asserts value is CommercialPlanCatalog {
  const catalog = value as Partial<CommercialPlanCatalog>;
  if (
    !catalog ||
    typeof catalog !== 'object' ||
    catalog.schemaVersion !== 1 ||
    catalog.contractVersion !== COMMERCIAL_PLAN_CATALOG_CONTRACT ||
    typeof catalog.catalogVersion !== 'string' ||
    !Array.isArray(catalog.plans) ||
    catalog.plans.length > 20 ||
    catalog.plans.some((plan) => {
      if (
        !plan ||
        typeof plan.planId !== 'string' ||
        typeof plan.displayName !== 'string' ||
        !['athlete', 'trainer', 'gym-business'].includes(plan.audience) ||
        ![
          'optiform-pro',
          'creator-program',
          'creator-membership',
          'trainer-package',
          'gym-business-plan',
        ].includes(plan.productKind) ||
        !['draft', 'available', 'retired'].includes(plan.status) ||
        !Array.isArray(plan.billingCadences) ||
        plan.billingCadences.length < 1 ||
        plan.billingCadences.some(
          (cadence) => !['monthly', 'annual', 'one-time'].includes(cadence),
        ) ||
        (plan.includedTrainerClientSeats !== undefined &&
          (!Number.isSafeInteger(plan.includedTrainerClientSeats) ||
            plan.includedTrainerClientSeats < 1))
      )
        return true;
      const price = plan.priceConfiguration;
      return (
        !price ||
        (price.state === 'pending'
          ? Object.keys(price).length !== 1
          : price.state !== 'configured' ||
            !Number.isSafeInteger(price.priceMinor) ||
            price.priceMinor <= 0 ||
            !/^[A-Z]{3}$/.test(price.currency))
      );
    })
  )
    throw new Error('Commercial plans returned an invalid response.');
}
