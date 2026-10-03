import {describe, expect, it} from 'vitest';
import {DEFAULT_SOURCE_URL, sourceLabel, sourceUrl} from '../src/shared/source';

describe('source link', () => {
  it('uses SOURCE_URL when it is an http(s) address', () => {
    expect(sourceUrl('https://example.org/fork/mars-ledger')).toBe('https://example.org/fork/mars-ledger');
    expect(sourceUrl(' http://192.0.2.10/src ')).toBe('http://192.0.2.10/src');
  });
  it('falls back to the default when unset, empty or not a web address', () => {
    for (const v of [undefined, '', '   ', 'javascript:alert(1)', 'ftp://x/y']) expect(sourceUrl(v)).toBe(DEFAULT_SOURCE_URL);
  });
  it('reads without the scheme', () => {
    expect(sourceLabel('https://example.org/fork/')).toBe('example.org/fork');
  });
});
