import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION } from './contracts.js';
import {
  FOOD_SEARCH_RATE_LIMIT_PATH,
  FOOD_SEARCH_PROVIDER_INTERVAL_MS,
  FoodSearchGatewayError,
} from './gatewayCore.js';
export * from './gatewayCore.js';

export function createFoodSearchRateGate(db: Firestore) {
  return {
    async reserve(now: number) {
      const ref = db.doc(FOOD_SEARCH_RATE_LIMIT_PATH);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists ? snapshot.data() : undefined;
        const next = data?.nextProviderRequestAt;
        if (snapshot.exists) {
          if (
            !data ||
            Object.keys(data).sort().join(',') !==
              'contractVersion,nextProviderRequestAt,schemaVersion,updatedAt' ||
            data.schemaVersion !== 1 ||
            data.contractVersion !== FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION ||
            !(next instanceof Timestamp) ||
            !(data.updatedAt instanceof Timestamp)
          )
            throw new FoodSearchGatewayError('provider-unavailable');
          const remaining = next.toMillis() - now;
          if (remaining > 0)
            throw new FoodSearchGatewayError(
              'rate-limited',
              Math.max(1, Math.min(60, Math.ceil(remaining / 1_000))),
            );
        }
        transaction.set(ref, {
          schemaVersion: 1,
          contractVersion: FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION,
          nextProviderRequestAt: Timestamp.fromMillis(now + FOOD_SEARCH_PROVIDER_INTERVAL_MS),
          updatedAt: Timestamp.fromMillis(now),
        });
      });
    },
  };
}
