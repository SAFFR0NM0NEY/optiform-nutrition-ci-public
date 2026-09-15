import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  FOOD_TEXT_SEARCH_CONTRACT_VERSION,
  FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION,
  parseFoodSearchRequest,
  parseSearchALiciousResponse,
  providerSearchBody,
  type FoodSearchResponse,
  type FoodSearchSummary,
} from './contracts.js';

export const FOOD_SEARCH_PROVIDER_URL = 'https://search.openfoodfacts.org/search';
export const FOOD_SEARCH_PROVIDER_INTERVAL_MS = 8_000;
export const FOOD_SEARCH_PROVIDER_TIMEOUT_MS = 8_000;
export const FOOD_SEARCH_CACHE_TTL_MS = 60_000;
export const FOOD_SEARCH_CACHE_MAXIMUM = 50;
export const FOOD_SEARCH_RATE_LIMIT_PATH = 'systemFoodSearchGateway/rateLimit';

export type FoodSearchGatewayCode =
  'unauthenticated' | 'invalid-request' | 'rate-limited' | 'provider-unavailable';

export class FoodSearchGatewayError extends Error {
  constructor(
    public readonly code: FoodSearchGatewayCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

type CacheEntry = { expiresAt: number; results: FoodSearchSummary[] };

export class FoodSearchMemoryCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string, now: number) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.results.map((result) => ({ ...result }));
  }

  put(key: string, results: FoodSearchSummary[], now: number) {
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: now + FOOD_SEARCH_CACHE_TTL_MS,
      results: results.map((result) => ({ ...result })),
    });
    while (this.entries.size > FOOD_SEARCH_CACHE_MAXIMUM) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  get size() {
    return this.entries.size;
  }
}

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

type SafeLogger = {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
};

type GatewayDependencies = {
  fetcher: typeof fetch;
  rateGate: { reserve(now: number): Promise<void> };
  cache: FoodSearchMemoryCache;
  userAgent: string;
  now?: () => number;
  logger?: SafeLogger;
};

function cacheKey(query: string, languageCodes: readonly string[]) {
  return JSON.stringify([query, ...languageCodes]);
}

function validUserAgent(value: string) {
  const normalized = value.trim();
  return normalized.length >= 8 && normalized.length <= 256 && !/[\r\n\0]/.test(normalized);
}

async function fetchProvider(
  fetcher: typeof fetch,
  request: ReturnType<typeof parseFoodSearchRequest>,
  userAgent: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FOOD_SEARCH_PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetcher(FOOD_SEARCH_PROVIDER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': userAgent.trim(),
      },
      body: JSON.stringify(providerSearchBody(request)),
    });
    if (response.status === 429) throw new FoodSearchGatewayError('rate-limited', 8);
    if (response.status === 400 || response.status === 422)
      throw new FoodSearchGatewayError('invalid-request');
    if (response.status === 503 || response.status >= 500)
      throw new FoodSearchGatewayError('provider-unavailable');
    if (!response.ok) throw new FoodSearchGatewayError('provider-unavailable');
    try {
      return parseSearchALiciousResponse(await response.json());
    } catch (error) {
      if (error instanceof FoodSearchGatewayError) throw error;
      throw new FoodSearchGatewayError('provider-unavailable');
    }
  } catch (error) {
    if (error instanceof FoodSearchGatewayError) throw error;
    throw new FoodSearchGatewayError('provider-unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export function createFoodSearchGateway(dependencies: GatewayDependencies) {
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;
  return async (uid: string | null, payload: unknown): Promise<FoodSearchResponse> => {
    const started = now();
    let cacheHit = false;
    let providerStatusClass = 'not-called';
    try {
      if (!uid) throw new FoodSearchGatewayError('unauthenticated');
      let request: ReturnType<typeof parseFoodSearchRequest>;
      try {
        request = parseFoodSearchRequest(payload);
      } catch {
        throw new FoodSearchGatewayError('invalid-request');
      }
      if (!validUserAgent(dependencies.userAgent))
        throw new FoodSearchGatewayError('provider-unavailable');
      const key = cacheKey(request.query, request.languageCodes);
      let results = dependencies.cache.get(key, now());
      if (results) cacheHit = true;
      else {
        await dependencies.rateGate.reserve(now());
        providerStatusClass = 'attempted';
        results = await fetchProvider(dependencies.fetcher, request, dependencies.userAgent);
        providerStatusClass = 'success';
        dependencies.cache.put(key, results, now());
      }
      logger.info('food_search_gateway_complete', {
        outcome: 'success',
        cacheHit,
        resultCount: results.length,
        providerStatusClass,
        durationMs: Math.max(0, now() - started),
      });
      return {
        contractVersion: FOOD_TEXT_SEARCH_CONTRACT_VERSION,
        transportContractVersion: FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION,
        results,
      };
    } catch (error) {
      const gatewayError =
        error instanceof FoodSearchGatewayError
          ? error
          : new FoodSearchGatewayError('provider-unavailable');
      logger.warn('food_search_gateway_failed', {
        outcome: gatewayError.code,
        cacheHit,
        providerStatusClass,
        durationMs: Math.max(0, now() - started),
      });
      throw gatewayError;
    }
  };
}

export function emulatorFoodSearchFetch(): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { q?: string };
    const scenario = body.q;
    if (scenario === 'emulator429') return new Response('{}', { status: 429 });
    if (scenario === 'emulator503') return new Response('{}', { status: 503 });
    if (scenario === 'emulator400') return new Response('{}', { status: 400 });
    if (scenario === 'emulatorMalformed') return Response.json({ hits: { invalid: true } });
    if (scenario === 'emulatorEmpty') return Response.json({ hits: [] });
    return Response.json({
      hits: [{ code: '12345678', product_name: 'Emulator food result', brands: 'Synthetic brand' }],
      page: 1,
      page_size: 10,
      page_count: 1,
      count: 1,
      timed_out: false,
      took: 1,
      is_count_exact: true,
    });
  };
}
