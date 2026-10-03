import type {
  Analysis,
  BoundsIssue,
  ChannelIssue,
  ElementKind,
  ElementSpec,
  ExpoElement,
  FieldSize,
  LayoutDocument,
  PathPreview,
  PlacementIssueKind,
  OverlapIssue,
} from './types';

export const MIN_CHANNEL = 1.2;

export const ELEMENT_SPECS: Record<ElementKind, ElementSpec> = {
  booth: { kind: 'booth', label: '标准展位', eyebrow: 'BOOTH', icon: '▦', color: '#e7f0ff', width: 5, height: 3.5 },
  stage: { kind: 'stage', label: '主舞台', eyebrow: 'STAGE', icon: '✦', color: '#f2e9ff', width: 8, height: 4 },
  seating: { kind: 'seating', label: '观众座席', eyebrow: 'SEATING', icon: '▤', color: '#e6f7f2', width: 6, height: 3 },
  entrance: { kind: 'entrance', label: '入口', eyebrow: 'ENTRY', icon: '↗', color: '#fff2d8', width: 2.5, height: 1.5 },
};

export const createStarterDocument = (): LayoutDocument => ({
  version: 1,
  title: '春日创意市集 · A 区',
  field: { width: 28, height: 18 },
  elements: [
    { id: 'entry-1', kind: 'entrance', name: '主入口', x: 1, y: 8.25, width: 2.5, height: 1.5, rotation: 0 },
    { id: 'stage-1', kind: 'stage', name: '分享舞台', x: 10, y: 1.5, width: 8, height: 4, rotation: 0 },
    { id: 'booth-1', kind: 'booth', name: '香氛展位', x: 4, y: 2, width: 5, height: 3.5, rotation: 0 },
    { id: 'booth-2', kind: 'booth', name: '手作展位', x: 19, y: 2, width: 5, height: 3.5, rotation: 0 },
    { id: 'seating-1', kind: 'seating', name: '休息座席', x: 10, y: 11, width: 6, height: 3, rotation: 0 },
  ],
});

export const createElement = (kind: ElementKind, index: number, field: FieldSize): ExpoElement => {
  const spec = ELEMENT_SPECS[kind];
  const offset = Math.min(index * 0.65, 4);
  return {
    id: `${kind}-${Date.now()}-${index}`,
    kind,
    name: `${spec.label} ${index + 1}`,
    x: Math.max(0.5, Math.min(field.width - spec.width - 0.5, (field.width - spec.width) / 2 + offset)),
    y: Math.max(0.5, Math.min(field.height - spec.height - 0.5, (field.height - spec.height) / 2 + offset)),
    width: spec.width,
    height: spec.height,
    rotation: 0,
  };
};

export const normalizeRotation = (rotation: number): number => ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;

export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number; }

export const getBoundingBox = (element: ExpoElement): Box => {
  const isQuarterTurn = normalizeRotation(element.rotation) % 180 !== 0;
  const width = isQuarterTurn ? element.height : element.width;
  const height = isQuarterTurn ? element.width : element.height;
  return { left: element.x, top: element.y, right: element.x + width, bottom: element.y + height, width, height };
};

const intersectionSize = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

type PairRelation =
  | { kind: 'overlap'; amount: number }
  | { kind: 'channel'; gap: number }
  | { kind: 'none' };

// 两个 AABB 的唯一关系来源：重叠、窄通道（沿某一轴投影重叠、另一轴有间距）或无约束。
// 事后分析与拖动时的落点判断都走这里，避免两套几何结论不一致。
export const pairRelation = (first: Box, second: Box): PairRelation => {
  const overlapX = intersectionSize(first.left, first.right, second.left, second.right);
  const overlapY = intersectionSize(first.top, first.bottom, second.top, second.bottom);
  if (overlapX > 0 && overlapY > 0) return { kind: 'overlap', amount: overlapX * overlapY };
  const horizontalGap = first.right <= second.left ? second.left - first.right : second.right <= first.left ? first.left - second.right : 0;
  const verticalGap = first.bottom <= second.top ? second.top - first.bottom : second.bottom <= first.top ? first.top - second.bottom : 0;
  if (overlapY > 0 && horizontalGap > 0) return { kind: 'channel', gap: horizontalGap };
  if (overlapX > 0 && verticalGap > 0) return { kind: 'channel', gap: verticalGap };
  return { kind: 'none' };
};

export const findOverlaps = (elements: ExpoElement[]): OverlapIssue[] => {
  const issues: OverlapIssue[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const first = getBoundingBox(elements[i]);
    for (let j = i + 1; j < elements.length; j += 1) {
      const relation = pairRelation(first, getBoundingBox(elements[j]));
      if (relation.kind === 'overlap') {
        issues.push({ firstId: elements[i].id, secondId: elements[j].id, amount: Number(relation.amount.toFixed(1)) });
      }
    }
  }
  return issues;
};

export const findBoundsIssues = (field: FieldSize, elements: ExpoElement[]): BoundsIssue[] =>
  elements.flatMap((element) => {
    const overflow = boundsOverflow(getBoundingBox(element), field);
    return overflow > 0 ? [{ elementId: element.id, overflow: Number(overflow.toFixed(1)) }] : [];
  });

const boundsOverflow = (box: Box, field: FieldSize) =>
  Math.max(0, -box.left, -box.top, box.right - field.width, box.bottom - field.height);

export const findNarrowChannels = (elements: ExpoElement[]): ChannelIssue[] => {
  const issues: ChannelIssue[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const first = getBoundingBox(elements[i]);
    for (let j = i + 1; j < elements.length; j += 1) {
      const relation = pairRelation(first, getBoundingBox(elements[j]));
      if (relation.kind === 'channel' && relation.gap < MIN_CHANNEL) {
        issues.push({ firstId: elements[i].id, secondId: elements[j].id, gap: Number(relation.gap.toFixed(1)) });
      }
    }
  }
  return issues;
};

export interface PlacementIssue {
  kind: PlacementIssueKind;
  otherId: string | null;
  gap?: number;
  overflow?: number;
  amount?: number;
}

// 评估某个候选元素（基于旋转后的实际占地 AABB）相对其余元素和场地边界的落点。
// 返回的是候选落点自身引入/涉及的全部硬约束问题，是否允许落下由 view-model
// 结合"当前位置已有问题"做新旧对比后决定。
export const evaluatePlacement = (
  candidate: ExpoElement,
  others: ExpoElement[],
  field: FieldSize,
): PlacementIssue[] => {
  const issues: PlacementIssue[] = [];
  const candidateBox = getBoundingBox(candidate);
  const overflow = boundsOverflow(candidateBox, field);
  if (overflow > 0.05) issues.push({ kind: 'bounds', otherId: null, overflow: Number(overflow.toFixed(1)) });
  others.forEach((other) => {
    const relation = pairRelation(candidateBox, getBoundingBox(other));
    if (relation.kind === 'overlap') issues.push({ kind: 'overlap', otherId: other.id, amount: Number(relation.amount.toFixed(1)) });
    else if (relation.kind === 'channel') {
      const gap = Number(relation.gap.toFixed(1));
      if (gap < MIN_CHANNEL) issues.push({ kind: 'channel', otherId: other.id, gap });
    }
  });
  return issues.sort((first, second) => issueRank[first.kind] - issueRank[second.kind]);
};

const issueRank: Record<PlacementIssueKind, number> = { channel: 0, overlap: 1, bounds: 2 };

const distance = (first: { x: number; y: number }, second: { x: number; y: number }) => Math.hypot(second.x - first.x, second.y - first.y);

export const createPathPreview = (elements: ExpoElement[]): PathPreview | null => {
  const entrance = elements.find((element) => element.kind === 'entrance');
  const target = elements.find((element) => element.kind === 'stage') ?? elements.find((element) => element.kind !== 'entrance');
  if (!entrance || !target) return null;
  const startBox = getBoundingBox(entrance);
  const targetBox = getBoundingBox(target);
  const start = { x: startBox.left + startBox.width / 2, y: startBox.top + startBox.height / 2 };
  const end = { x: targetBox.left + targetBox.width / 2, y: targetBox.top + targetBox.height / 2 };
  const elbow = { x: end.x, y: start.y };
  return { points: [start, elbow, end], distance: Number((distance(start, elbow) + distance(elbow, end)).toFixed(1)), fromName: entrance.name, toName: target.name };
};

export const analyzeLayout = (document: LayoutDocument): Analysis => ({
  overlaps: findOverlaps(document.elements),
  bounds: findBoundsIssues(document.field, document.elements),
  channels: findNarrowChannels(document.elements),
  path: createPathPreview(document.elements),
});

export const findElement = (document: LayoutDocument, id: string | null) => document.elements.find((element) => element.id === id) ?? null;

export const formatArea = (field: FieldSize) => `${field.width} × ${field.height} m`;
