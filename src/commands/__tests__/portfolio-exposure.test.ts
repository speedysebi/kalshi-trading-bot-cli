import { describe, expect, test } from 'bun:test';
import { exposureRatio, formatPortfolioHuman, type PortfolioData } from '../portfolio.js';
import { formatPortfolioForWhatsApp } from '../../gateway/commands/wa-formatters.js';

describe('portfolio exposure share', () => {
  test('uses venue portfolio value and preserves over-100% exposure', () => {
    expect(exposureRatio(25_000, 100_000)).toBeCloseTo(0.25);
    expect(exposureRatio(120_000, 100_000)).toBeCloseTo(1.2);
  });

  test('does not divide by missing or zero portfolio value', () => {
    expect(exposureRatio(0, 0)).toBeNull();
    expect(exposureRatio(100, Number.NaN)).toBeNull();
  });

  test('shows the same share in terminal and WhatsApp summaries', () => {
    const data: PortfolioData = {
      positions: [],
      accountSummary: {
        cashBalance: 100_000,
        portfolioValue: 100_000,
        openExposure: 25_000,
        exposureRatio: 0.25,
        available: 75_000,
        positionsCount: 1,
      },
      riskSnapshot: null,
    };
    expect(formatPortfolioHuman(data)).toContain('Exposure Share:  25.0%');
    expect(formatPortfolioForWhatsApp(data)).toContain('Exposure share: 25.0%');
  });
});
