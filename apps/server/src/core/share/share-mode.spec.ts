import {
  ShareMode,
  normalizeShareMode,
  shareModeAllows,
} from './share-mode';

describe('share-mode capability model', () => {
  it('normalizes null/undefined/unknown to view (legacy rows)', () => {
    expect(normalizeShareMode(null)).toBe(ShareMode.VIEW);
    expect(normalizeShareMode(undefined)).toBe(ShareMode.VIEW);
    expect(normalizeShareMode('')).toBe(ShareMode.VIEW);
    expect(normalizeShareMode('garbage')).toBe(ShareMode.VIEW);
    expect(normalizeShareMode('view')).toBe(ShareMode.VIEW);
    expect(normalizeShareMode('comment')).toBe(ShareMode.COMMENT);
    expect(normalizeShareMode('edit')).toBe(ShareMode.EDIT);
  });

  it('view allows only view', () => {
    expect(shareModeAllows('view', ShareMode.VIEW)).toBe(true);
    expect(shareModeAllows('view', ShareMode.COMMENT)).toBe(false);
    expect(shareModeAllows('view', ShareMode.EDIT)).toBe(false);
  });

  it('comment allows view + comment, not edit', () => {
    expect(shareModeAllows('comment', ShareMode.VIEW)).toBe(true);
    expect(shareModeAllows('comment', ShareMode.COMMENT)).toBe(true);
    expect(shareModeAllows('comment', ShareMode.EDIT)).toBe(false);
  });

  it('edit implies comment and view', () => {
    expect(shareModeAllows('edit', ShareMode.VIEW)).toBe(true);
    expect(shareModeAllows('edit', ShareMode.COMMENT)).toBe(true);
    expect(shareModeAllows('edit', ShareMode.EDIT)).toBe(true);
  });

  it('null mode (legacy row) behaves as view everywhere', () => {
    expect(shareModeAllows(null, ShareMode.VIEW)).toBe(true);
    expect(shareModeAllows(null, ShareMode.COMMENT)).toBe(false);
    expect(shareModeAllows(null, ShareMode.EDIT)).toBe(false);
  });
});
