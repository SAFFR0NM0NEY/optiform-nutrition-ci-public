import { describe, expect, it } from 'vitest';
import {
  escapeLuceneQuery,
  normalizeFoodSearchLanguages,
  normalizeFoodSearchQuery,
  parseFoodSearchRequest,
  parseSearchALiciousResponse,
  providerSearchBody,
} from './contracts.js';

describe('nutrition-food-text-search-v1 contracts', () => {
  it('normalizes Unicode and whitespace without stripping international text', () => {
    expect(normalizeFoodSearchQuery('  cafe\u0301\tau   lait  ')).toBe('café au lait');
    expect(normalizeFoodSearchQuery('  牛乳 チョコ  ')).toBe('牛乳 チョコ');
  });

  it('rejects short, long, hidden-control and malformed queries', () => {
    for (const value of ['a', '!', 'a\0b', `ok\u200bhidden`, 'a'.repeat(81), 42])
      expect(() => normalizeFoodSearchQuery(value)).toThrow('invalid-request');
  });

  it('escapes every supported Lucene reserved token', () => {
    expect(escapeLuceneQuery('+ - && || ! ( ) { } [ ] ^ " ~ * ? : \\ /')).toBe(
      '\\+ \\- \\&& \\|| \\! \\( \\) \\{ \\} \\[ \\] \\^ \\" \\~ \\* \\? \\: \\\\ \\/',
    );
  });

  it('normalizes at most three unique two-letter language codes', () => {
    expect(normalizeFoodSearchLanguages(['EN', 'fr', 'en'])).toEqual(['en', 'fr']);
    expect(normalizeFoodSearchLanguages([])).toEqual(['en']);
    expect(normalizeFoodSearchLanguages(['nl', 'af', 'de'])).toEqual(['nl', 'af', 'en']);
    expect(() => normalizeFoodSearchLanguages(['en', 'fr', 'de', 'nl'])).toThrow('invalid-request');
    expect(() => normalizeFoodSearchLanguages(['en-US'])).toThrow('invalid-request');
  });

  it('requires the exact callable payload and builds the minimal provider POST body', () => {
    const request = parseFoodSearchRequest({
      contractVersion: 'nutrition-food-text-search-v1',
      query: 'milk:whole',
      languageCodes: ['en', 'fr'],
    });
    expect(providerSearchBody(request)).toEqual({
      q: 'milk\\:whole',
      fields: ['code', 'product_name', 'brands'],
      page: 1,
      page_size: 10,
      boost_phrase: true,
      langs: ['en', 'fr'],
    });
    expect(() =>
      parseFoodSearchRequest({
        contractVersion: 'nutrition-food-text-search-v1',
        query: 'milk',
        languageCodes: ['en'],
        uid: 'forged',
      }),
    ).toThrow('invalid-request');
    expect(() =>
      parseFoodSearchRequest({
        contractVersion: 'nutrition-food-text-search-v2',
        query: 'milk',
        languageCodes: ['en'],
      }),
    ).toThrow('invalid-request');
  });

  it('parses current top-level hits, bounds fields, deduplicates codes and discards malformed hits', () => {
    const results = parseSearchALiciousResponse({
      hits: [
        { code: '12345678', product_name: ' Milk ', brands: ' Brand ' },
        { code: '12345678', product_name: 'Duplicate' },
        { code: 'not-a-barcode', product_name: 'Bad code' },
        { code: '87654321', product_name: 'Y'.repeat(140), brands: '' },
        null,
      ],
    });
    expect(results).toEqual([
      {
        productCode: '12345678',
        name: 'Milk',
        brand: 'Brand',
        provider: 'open-food-facts',
      },
      { productCode: '87654321', name: 'Y'.repeat(120), provider: 'open-food-facts' },
    ]);
    expect(() => parseSearchALiciousResponse({ hits: { hits: [] } })).toThrow('provider-malformed');
    expect(parseSearchALiciousResponse({ hits: [] })).toEqual([]);
    expect(
      parseSearchALiciousResponse({
        hits: Array.from({ length: 12 }, (_, index) => ({
          code: String(10_000_000 + index),
          product_name: `Food ${index}`,
        })),
      }),
    ).toHaveLength(10);
  });
});
