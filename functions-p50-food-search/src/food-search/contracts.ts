export const FOOD_TEXT_SEARCH_CONTRACT_VERSION = 'nutrition-food-text-search-v1' as const;
export const FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION =
  'open-food-facts-search-gateway-beta-v1' as const;
export const FOOD_TEXT_SEARCH_MAX_RESULTS = 10;
export const FOOD_TEXT_SEARCH_MAX_QUERY_LENGTH = 80;
export const FOOD_TEXT_SEARCH_MAX_LANGUAGES = 3;

export type FoodSearchSummary = {
  productCode: string;
  name: string;
  brand?: string;
  provider: 'open-food-facts';
};

export type FoodSearchRequest = {
  contractVersion: typeof FOOD_TEXT_SEARCH_CONTRACT_VERSION;
  query: string;
  languageCodes: string[];
};

export type FoodSearchResponse = {
  contractVersion: typeof FOOD_TEXT_SEARCH_CONTRACT_VERSION;
  transportContractVersion: typeof FOOD_TEXT_SEARCH_PROVIDER_CONTRACT_VERSION;
  results: FoodSearchSummary[];
};

function hasUnexpectedControl(value: string) {
  for (const character of value) {
    if (/\p{Cf}/u.test(character)) return true;
    if (/\p{Cc}/u.test(character) && !['\t', '\n', '\r'].includes(character)) return true;
  }
  return false;
}

export function normalizeFoodSearchQuery(value: unknown) {
  if (typeof value !== 'string' || hasUnexpectedControl(value)) throw new Error('invalid-request');
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (
    !normalized ||
    [...normalized].length > FOOD_TEXT_SEARCH_MAX_QUERY_LENGTH ||
    (normalized.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 2
  )
    throw new Error('invalid-request');
  return normalized;
}

export function escapeLuceneQuery(value: string) {
  return value.replace(/&&|\|\||[+\-!(){}[\]^"~*?:\\/]/g, (reserved) => `\\${reserved}`);
}

export function normalizeFoodSearchLanguages(value: unknown) {
  if (!Array.isArray(value) || value.length > FOOD_TEXT_SEARCH_MAX_LANGUAGES)
    throw new Error('invalid-request');
  const languages: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !/^[a-z]{2}$/i.test(candidate))
      throw new Error('invalid-request');
    const normalized = candidate.toLowerCase();
    if (!languages.includes(normalized)) languages.push(normalized);
  }
  if (!languages.includes('en')) {
    if (languages.length === FOOD_TEXT_SEARCH_MAX_LANGUAGES) languages.pop();
    languages.push('en');
  }
  return languages;
}

export function parseFoodSearchRequest(value: unknown): FoodSearchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-request');
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 3 ||
    candidate.contractVersion !== FOOD_TEXT_SEARCH_CONTRACT_VERSION ||
    !Object.hasOwn(candidate, 'query') ||
    !Object.hasOwn(candidate, 'languageCodes')
  )
    throw new Error('invalid-request');
  return {
    contractVersion: FOOD_TEXT_SEARCH_CONTRACT_VERSION,
    query: normalizeFoodSearchQuery(candidate.query),
    languageCodes: normalizeFoodSearchLanguages(candidate.languageCodes),
  };
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== 'string' || hasUnexpectedControl(value)) return undefined;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) return undefined;
  return [...normalized].slice(0, maximum).join('');
}

export function parseSearchALiciousResponse(value: unknown): FoodSearchSummary[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('provider-malformed');
  const hits = (value as Record<string, unknown>).hits;
  if (!Array.isArray(hits)) throw new Error('provider-malformed');
  const results: FoodSearchSummary[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object' || Array.isArray(hit)) continue;
    const record = hit as Record<string, unknown>;
    const productCode = boundedText(record.code, 32);
    const name = boundedText(record.product_name, 120);
    if (!productCode || !/^\d{7,14}$/.test(productCode) || !name || seen.has(productCode)) continue;
    seen.add(productCode);
    const brand = boundedText(record.brands, 120);
    results.push({
      productCode,
      name,
      ...(brand ? { brand } : {}),
      provider: 'open-food-facts',
    });
    if (results.length === FOOD_TEXT_SEARCH_MAX_RESULTS) break;
  }
  return results;
}

export function providerSearchBody(request: FoodSearchRequest) {
  return {
    q: escapeLuceneQuery(request.query),
    fields: ['code', 'product_name', 'brands'],
    page: 1,
    page_size: FOOD_TEXT_SEARCH_MAX_RESULTS,
    boost_phrase: true,
    langs: request.languageCodes,
  };
}
