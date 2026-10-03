import { describe, expect, it } from 'vitest';
import { analyzeLayout, findBoundsIssues, findNarrowChannels, findOverlaps, findPlacementBlockers } from '../src/domain';
import type { ExpoElement } from '../src/types';

const item = (id: string, x: number, y: number, width = 4, height = 3): ExpoElement => ({ id, kind: 'booth', name: id, x, y, width, height, rotation: 0 });

describe('layout domain rules', () => {
  it('detects overlap area between two elements', () => {
    expect(findOverlaps([item('a', 1, 1), item('b', 3, 2)])).toEqual([{ firstId: 'a', secondId: 'b', amount: 4 }]);
  });

  it('detects field overflow and rotated bounds', () => {
    const rotated = { ...item('rotated', 8, 2, 2, 5), rotation: 90 };
    expect(findBoundsIssues({ width: 10, height: 10 }, [rotated])).toEqual([{ elementId: 'rotated', overflow: 3 }]);
  });

  it('flags a pass narrower than the minimum channel', () => {
    expect(findNarrowChannels([item('a', 1, 1), item('b', 5.5, 1)])).toEqual([{ firstId: 'a', secondId: 'b', gap: 0.5 }]);
  });

  it('returns a path when entrance and focus area exist', () => {
    const analysis = analyzeLayout({ version: 1, title: 'x', field: { width: 20, height: 12 }, elements: [{ ...item('entry', 1, 5, 2, 1), kind: 'entrance' }, { ...item('stage', 10, 2, 5, 3), kind: 'stage' }] });
    expect(analysis.path?.points).toHaveLength(3);
    expect(analysis.path?.distance).toBeGreaterThan(0);
  });
});

describe('placement blockers', () => {
  it('blocks a candidate that would squeeze a channel below the minimum', () => {
    const elements = [item('a', 1, 1), item('b', 12, 1), item('c', 1, 8)];
    expect(findPlacementBlockers(elements, { ...elements[2], x: 5.6, y: 1 })).toEqual([{ otherId: 'a', gap: 0.6 }]);
  });

  it('does not lock pairs that already violate the channel rule', () => {
    const elements = [item('a', 1, 1), item('b', 5.5, 1)];
    expect(findPlacementBlockers(elements, { ...elements[1], y: 1.5 })).toEqual([]);
    expect(findPlacementBlockers(elements, { ...elements[1], x: 8 })).toEqual([]);
  });

  it('treats pairs already overlapping as pre-existing problems', () => {
    const elements = [item('a', 1, 1), item('b', 3, 2)];
    expect(findPlacementBlockers(elements, { ...elements[1], x: 5.6, y: 1 })).toEqual([]);
  });

  it('judges rotated footprints with the same occupied range', () => {
    const elements = [item('a', 1, 1, 2, 5), item('b', 6.6, 1, 2, 5)];
    expect(findPlacementBlockers(elements, elements[0])).toEqual([]);
    expect(findPlacementBlockers(elements, { ...elements[0], rotation: 90 })).toEqual([{ otherId: 'b', gap: 0.6 }]);
  });
});
