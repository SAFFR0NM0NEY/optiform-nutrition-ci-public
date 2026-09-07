import { describe, expect, it } from 'vitest';
import {
  validCommunityComment,
  validCommunityDescription,
  validCommunityGroupName,
  validCommunityPost,
} from './gymCommunity';
describe('P38C client validation', () => {
  it('accepts bounded plain text', () => {
    expect(validCommunityGroupName('General')).toBe(true);
    expect(validCommunityDescription('')).toBe(true);
    expect(validCommunityPost('Training today\nWho is in?')).toBe(true);
    expect(validCommunityComment('Nice work')).toBe(true);
  });
  it('rejects links, markup, controls and boundary overflow', () => {
    expect(validCommunityPost('www.example.test')).toBe(false);
    expect(validCommunityComment('<b>no</b>')).toBe(false);
    expect(validCommunityGroupName('line\nbreak')).toBe(false);
    expect(validCommunityComment('x'.repeat(501))).toBe(false);
  });
});
