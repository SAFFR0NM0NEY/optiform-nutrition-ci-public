import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOOD_SEARCH_CACHE_MAXIMUM,
  FOOD_SEARCH_CACHE_TTL_MS,
  FOOD_SEARCH_PROVIDER_URL,
  FoodSearchGatewayError,
  FoodSearchMemoryCache,
  createFoodSearchGateway,
} from './gateway.js';

const payload = {
  contractVersion: 'nutrition-food-text-search-v1',
  query: 'whole milk',
  languageCodes: ['en'],
};
const providerResponse = {
  hits: [{ code: '12345678', product_name: 'Whole milk', brands: 'Example' }],
};

function setup(fetcher: typeof fetch = vi.fn(async () => Response.json(providerResponse))) {
  let time = 1_000;
  const reserve = vi.fn(async () => undefined);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const gateway = createFoodSearchGateway({
    fetcher,
    rateGate: { reserve },
    cache: new FoodSearchMemoryCache(),
    userAgent: 'Optiform-Test/1.0 (tests@example.invalid)',
    now: () => time,
    logger,
  });
  return { gateway, reserve, logger, setTime: (value: number) => (time = value) };
}

describe('open-food-facts-search-gateway-beta-v1', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requires authentication before provider or gate access', async () => {
    const { gateway, reserve } = setup();
    await expect(gateway(null, payload)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('uses the fixed POST endpoint, bounded fields, user agent and sanitized response', async () => {
    const fetcher = vi.fn(async () => Response.json(providerResponse));
    const { gateway, reserve, logger } = setup(fetcher);
    await expect(gateway('uid-a', payload)).resolves.toEqual({
      contractVersion: 'nutrition-food-text-search-v1',
      transportContractVersion: 'open-food-facts-search-gateway-beta-v1',
      results: [
        {
          productCode: '12345678',
          name: 'Whole milk',
          brand: 'Example',
          provider: 'open-food-facts',
        },
      ],
    });
    expect(reserve).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      FOOD_SEARCH_PROVIDER_URL,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    const init = fetcher.mock.calls[0][1];
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Optiform-Test/1.0 (tests@example.invalid)',
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      q: 'whole milk',
      fields: ['code', 'product_name', 'brands'],
      page: 1,
      page_size: 10,
      boost_phrase: true,
      langs: ['en'],
    });
    const serializedLog = JSON.stringify(logger.info.mock.calls);
    expect(serializedLog).not.toContain('whole milk');
    expect(serializedLog).not.toContain('12345678');
    expect(serializedLog).not.toContain('Whole milk');
  });

  it('uses only a bounded short-lived process-memory cache and bypasses the global gate on hits', async () => {
    const fetcher = vi.fn(async () => Response.json(providerResponse));
    const { gateway, reserve, setTime } = setup(fetcher);
    await gateway('uid-a', payload);
    await gateway('uid-b', payload);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledOnce();
    setTime(1_000 + FOOD_SEARCH_CACHE_TTL_MS + 1);
    await gateway('uid-a', payload);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(2);

    const cache = new FoodSearchMemoryCache();
    for (let index = 0; index <= FOOD_SEARCH_CACHE_MAXIMUM; index += 1)
      cache.put(String(index), [], index);
    expect(cache.size).toBe(FOOD_SEARCH_CACHE_MAXIMUM);
    expect(cache.get('0', FOOD_SEARCH_CACHE_MAXIMUM + 1)).toBeUndefined();
  });

  it('keeps language hints in the transient cache key', async () => {
    const fetcher = vi.fn(async () => Response.json(providerResponse));
    const { gateway, reserve } = setup(fetcher);
    await gateway('uid-a', payload);
    await gateway('uid-a', { ...payload, languageCodes: ['fr', 'en'] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, 'rate-limited'],
    [400, 'invalid-request'],
    [422, 'invalid-request'],
    [503, 'provider-unavailable'],
    [500, 'provider-unavailable'],
  ])('maps provider status %s without exposing provider bodies', async (status, code) => {
    const { gateway } = setup(vi.fn(async () => new Response('private body', { status })));
    await expect(gateway('uid-a', payload)).rejects.toMatchObject({ code });
  });

  it('maps network, timeout and malformed responses to unavailable', async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw new Error('network details');
      }),
      vi.fn(async () => Response.json({ hits: { invalid: true } })),
    ]) {
      const { gateway } = setup(fetcher);
      await expect(gateway('uid-a', payload)).rejects.toMatchObject({
        code: 'provider-unavailable',
      });
    }
  });

  it('aborts a provider request at the eight-second gateway timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    const { gateway } = setup(fetcher as typeof fetch);
    const pending = gateway('uid-a', payload);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'provider-unavailable' });
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    vi.useRealTimers();
  });

  it('fails closed when the required deployment user agent is absent', async () => {
    const gateway = createFoodSearchGateway({
      fetcher: vi.fn(),
      rateGate: { reserve: vi.fn() },
      cache: new FoodSearchMemoryCache(),
      userAgent: '',
    });
    await expect(gateway('uid-a', payload)).rejects.toMatchObject({
      code: 'provider-unavailable',
    });
  });

  it('reports a bounded retry delay without logging query, user or product data', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const gateway = createFoodSearchGateway({
      fetcher: vi.fn(),
      rateGate: {
        reserve: vi.fn(async () => {
          throw new FoodSearchGatewayError('rate-limited', 7);
        }),
      },
      cache: new FoodSearchMemoryCache(),
      userAgent: 'Optiform-Test/1.0 (tests@example.invalid)',
      logger,
    });
    await expect(
      gateway('sensitive-uid', {
        contractVersion: 'nutrition-food-text-search-v1',
        query: 'private query',
        languageCodes: ['en'],
      }),
    ).rejects.toMatchObject({ code: 'rate-limited', retryAfterSeconds: 7 });
    const serialized = JSON.stringify(logger.warn.mock.calls);
    expect(serialized).not.toContain('private query');
    expect(serialized).not.toContain('sensitive-uid');
    expect(serialized).not.toContain('12345678');
    expect(logger.warn).toHaveBeenCalledWith(
      'food_search_gateway_failed',
      expect.objectContaining({ outcome: 'rate-limited' }),
    );
  });
});
