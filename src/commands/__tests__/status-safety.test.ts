import { describe, expect, test } from 'bun:test';
import { formatSafetyStatus } from '../status.js';

describe('status safety summary', () => {
  test('identifies a live exchange with the kill switch off', () => {
    const lines = formatSafetyStatus(false, false);
    expect(lines.join('\n')).toContain('LIVE EXCHANGE');
    expect(lines.join('\n')).toContain('Kill switch inactive');
  });

  test('identifies demo mode and preserves the halt reason', () => {
    const lines = formatSafetyStatus(true, true, 'operator pause');
    expect(lines.join('\n')).toContain('DEMO EXCHANGE');
    expect(lines.join('\n')).toContain('Kill switch ACTIVE — operator pause');
    expect(lines.join('\n')).toContain('new orders blocked');
  });
});
