import { describe, expect, it } from 'vitest';
import { DEFAULT_WIDTH, MIN_WIDTH, clampWidth, maxWidthFor, parseStoredWidth } from '../client/src/chat/useResizableWidth';

describe('maxWidthFor', () => {
  it('caps at 900px or 70% of the viewport, whichever is smaller', () => {
    expect(maxWidthFor(2000)).toBe(900);
    expect(maxWidthFor(1000)).toBe(700);
  });
  it('never drops below the minimum on narrow windows', () => {
    expect(maxWidthFor(300)).toBe(MIN_WIDTH);
  });
});

describe('clampWidth', () => {
  it('keeps widths inside [MIN_WIDTH, maxWidthFor(viewport)]', () => {
    expect(clampWidth(500, 1600)).toBe(500);
    expect(clampWidth(100, 1600)).toBe(MIN_WIDTH);
    expect(clampWidth(5000, 1600)).toBe(900);
    expect(clampWidth(800, 1000)).toBe(700);
  });
  it('rounds to whole pixels and treats NaN as the default', () => {
    expect(clampWidth(450.6, 1600)).toBe(451);
    expect(clampWidth(Number.NaN, 1600)).toBe(DEFAULT_WIDTH);
  });
});

describe('parseStoredWidth', () => {
  it('reads a saved number and clamps it', () => {
    expect(parseStoredWidth('560', 1600)).toBe(560);
    expect(parseStoredWidth('5000', 1600)).toBe(900);
  });
  it('falls back to the default for missing or corrupt values', () => {
    expect(parseStoredWidth(null, 1600)).toBe(DEFAULT_WIDTH);
    expect(parseStoredWidth('wide', 1600)).toBe(DEFAULT_WIDTH);
    expect(parseStoredWidth('', 1600)).toBe(DEFAULT_WIDTH);
  });
  it('clamps the default itself on a narrow window', () => {
    expect(parseStoredWidth(null, 400)).toBe(MIN_WIDTH);
  });
});
