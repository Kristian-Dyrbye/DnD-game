import { describe, expect, it } from 'vitest';
import { tabIndicator } from './StatusIndicator';

describe('tab memory light', () => {
  it('warns above 600 MB and errors above 1 GB', () => {
    expect(tabIndicator(200).light).toBe('ok');
    expect(tabIndicator(700).light).toBe('warn');
    expect(tabIndicator(1200)).toMatchObject({ light: 'error', label: 'Game 1200 MB' });
  });
});
