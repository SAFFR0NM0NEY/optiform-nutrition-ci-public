import { describe, expect, it } from 'vitest';
import { membershipEntitlementKey, validateOfferInput, validatePostInput } from './contracts.js';

describe('creator membership contracts', () => {
  it('keeps creator membership entitlement separate', () => {
    expect(membershipEntitlementKey('creator-a')).toBe('creator-membership:creator-a');
    expect(membershipEntitlementKey('creator-a')).not.toBe('creator-program:creator-a');
  });
  it('accepts bounded plain-text offer and post content', () => {
    expect(
      validateOfferInput({
        title: 'Training notes',
        description: '',
        benefits: ['Weekly notes'],
        status: 'active',
      }),
    ).toMatchObject({ status: 'active' });
    expect(
      validatePostInput({ title: 'Week one', body: 'Train with intent.\nRecover well.' }),
    ).toMatchObject({ title: 'Week one' });
  });
  it.each([
    { title: 'https://bad.example', description: '', benefits: ['Notes'], status: 'active' },
    { title: 'Offer', description: '<b>bad</b>', benefits: ['Notes'], status: 'active' },
    { title: 'Offer', description: '', benefits: ['Same', 'Same'], status: 'active' },
  ])('rejects unsafe offers', (value) =>
    expect(() => validateOfferInput(value)).toThrow('invalid-request'),
  );
  it('rejects unsafe posts', () =>
    expect(() => validatePostInput({ title: 'Post', body: 'javascript:alert(1)' })).toThrow(
      'invalid-request',
    ));
});
