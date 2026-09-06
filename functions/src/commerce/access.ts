import {
  COMMERCE_ACCESS_CONTRACT,
  type CommerceAccessSnapshot,
  type CommerceGrant,
} from './contracts.js';

export function deriveCommerceAccess(grants: CommerceGrant[], now: Date): CommerceAccessSnapshot {
  const grouped = new Map<string, CommerceGrant[]>();
  for (const grant of grants)
    grouped.set(grant.entitlementKey, [...(grouped.get(grant.entitlementKey) ?? []), grant]);
  const entitlements: CommerceAccessSnapshot['entitlements'] = [];
  for (const [key, items] of grouped) {
    const valid = items.filter((grant) => isValid(grant, now));
    const active = valid.filter((grant) => grant.state === 'active');
    const selected = active.length ? active : valid.filter((grant) => grant.state === 'grace');
    if (!selected.length) continue;
    const first = selected[0];
    const perpetual = selected.some((grant) => grant.accessModel === 'perpetual');
    const expirations = selected
      .map((grant) => grant.validUntil)
      .filter((value): value is string => Boolean(value))
      .sort();
    entitlements.push({
      entitlementKey: key,
      productKind: first.productKind,
      ...(first.resourceId ? { resourceId: first.resourceId } : {}),
      status: active.length ? 'active' : 'grace',
      ...(!perpetual && expirations.length ? { validUntil: expirations.at(-1) } : {}),
    });
  }
  entitlements.sort((a, b) => a.entitlementKey.localeCompare(b.entitlementKey));
  return {
    schemaVersion: 1,
    contractVersion: COMMERCE_ACCESS_CONTRACT,
    generatedAt: now.toISOString(),
    entitlements,
  };
}
function isValid(grant: CommerceGrant, now: Date) {
  if (!['active', 'grace'].includes(grant.state)) return false;
  if (grant.accessModel === 'perpetual') return grant.state === 'active';
  return Boolean(grant.validUntil && Date.parse(grant.validUntil) > now.getTime());
}
