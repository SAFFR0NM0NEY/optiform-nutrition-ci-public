import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  FoodSearchGatewayError,
  FoodSearchMemoryCache,
  createFoodSearchGateway,
  createFoodSearchRateGate,
  emulatorFoodSearchFetch,
} from './food-search/gateway.js';

const app = getApps()[0] ?? initializeApp();
const db = getFirestore(app);
const openFoodFactsUserAgent = defineString('OPEN_FOOD_FACTS_USER_AGENT', { default: '' });
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
const foodSearchCache = new FoodSearchMemoryCache();

export const searchOpenFoodFactsBeta = onCall(
  {
    region: 'africa-south1',
    timeoutSeconds: 15,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 1,
    enforceAppCheck: !emulator,
  },
  async (request) => {
    const gateway = createFoodSearchGateway({
      fetcher: emulator ? emulatorFoodSearchFetch() : fetch,
      rateGate: createFoodSearchRateGate(db),
      cache: foodSearchCache,
      userAgent: emulator
        ? 'Optiform-Emulator/1.0 (tests@example.invalid)'
        : openFoodFactsUserAgent.value(),
    });
    try {
      return await gateway(request.auth?.uid ?? null, request.data);
    } catch (error) {
      const gatewayError =
        error instanceof FoodSearchGatewayError
          ? error
          : new FoodSearchGatewayError('provider-unavailable');
      if (gatewayError.code === 'unauthenticated')
        throw new HttpsError('unauthenticated', 'Sign in to search foods.');
      if (gatewayError.code === 'invalid-request')
        throw new HttpsError('invalid-argument', 'The food search request is invalid.');
      if (gatewayError.code === 'rate-limited')
        throw new HttpsError(
          'resource-exhausted',
          'Food search is temporarily limited. Please retry shortly.',
          { retryAfterSeconds: gatewayError.retryAfterSeconds ?? 8 },
        );
      throw new HttpsError('unavailable', 'Food search is temporarily unavailable.');
    }
  },
);
