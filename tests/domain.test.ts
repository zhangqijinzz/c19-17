import { describe, expect, it } from 'vitest';
import { analyzeLayout, evaluatePlacement, findBoundsIssues, findNarrowChannels, findOverlaps, getBoundingBox } from '../src/domain';
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

  describe('evaluatePlacement', () => {
    const field = { width: 20, height: 12 };

    it('accepts a placement that keeps the minimum channel gap', () => {
      // a 右边缘 5，b 左边缘 6.2 → 间距 1.2，恰好达标
      expect(evaluatePlacement(item('b', 6.2, 1), [item('a', 1, 1)], field)).toEqual([]);
    });

    it('reports which channel is squeezed and the remaining gap', () => {
      const issues = evaluatePlacement(item('b', 5.5, 1), [item('a', 1, 1)], field);
      expect(issues).toEqual([{ kind: 'channel', otherId: 'a', gap: 0.5 }]);
    });

    it('reports overlap rather than channel when boxes intersect', () => {
      const issues = evaluatePlacement(item('b', 3, 2), [item('a', 1, 1)], field);
      expect(issues).toHaveLength(1);
      expect(issues[0].kind).toBe('overlap');
      expect(issues[0].amount).toBe(4);
    });

    it('reports field overflow for a candidate', () => {
      const issues = evaluatePlacement(item('b', 17.5, 1, 4, 3), [item('a', 1, 1)], field);
      expect(issues).toContainEqual(expect.objectContaining({ kind: 'bounds', overflow: 1.5 }));
    });

    it('judges a rotated element by its actual occupied AABB', () => {
      // 旋转后的实际占地为 3(宽) × 4(高)，左上角仍是 (x, y)
      const rotated = { ...item('r', 5.5, 1, 4, 3), rotation: 90 };
      expect(getBoundingBox(rotated)).toMatchObject({ left: 5.5, top: 1, right: 8.5, bottom: 5, width: 3, height: 4 });
      const issues = evaluatePlacement(rotated, [item('a', 1, 1)], field);
      expect(issues).toEqual([{ kind: 'channel', otherId: 'a', gap: 0.5 }]);
    });

    it('reaches the same channel verdict for side-by-side elements in either orientation', () => {
      // 竖放 3×4 与横放 4×3 在同一 y、间距 0.5 时都应判为窄通道，
      // 不能出现横着放能过、换方向又能过的情况。
      const neighbor = item('n', 1, 1);
      const horizontal = item('h', 5.5, 1, 4, 3);
      const vertical = { ...item('v', 5.5, 1, 3, 4), rotation: 90 };
      expect(getBoundingBox(vertical)).toMatchObject({ width: 4, height: 3 });
      expect(evaluatePlacement(horizontal, [neighbor], field)[0]).toMatchObject({ kind: 'channel', gap: 0.5 });
      expect(evaluatePlacement(vertical, [neighbor], field)[0]).toMatchObject({ kind: 'channel', gap: 0.5 });
    });
  });
});
