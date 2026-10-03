import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async (_document) => {}),
});

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedId).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.setMode('inspect');
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('blocks an edit-mode drag that creates a new overlap and names the other element', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    const before = vm.state.document.elements.find((element) => element.id === 'stage-1');
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')).toEqual(before);
    expect(vm.state.placementBlock).not.toBeNull();
    expect(vm.state.placementBlock?.relaxed).toBe(false);
    expect(vm.state.placementBlock?.conflicts.some((conflict) => conflict.kind === 'overlap' && conflict.message.includes('香氛展位'))).toBe(true);
  });

  it('does not lock down an existing violation: pulling the element away is allowed', () => {
    // 初始示例中香氛展位(4,2) 与舞台(10,1.5,8x4) 间距仅 1.0 m，属既有窄通道。
    const vm = new ExpoSketchViewModel(fakeRepository());
    const channelPairs = vm.state.analysis.channels.map((issue) => `${issue.firstId}/${issue.secondId}`);
    expect(channelPairs).toContain('stage-1/booth-1');
    vm.selectElement('booth-1');
    // 向左拉开到 1.5 m，必须允许
    vm.moveElement('booth-1', 0.5, 2);
    expect(vm.state.document.elements.find((element) => element.id === 'booth-1')?.x).toBe(0.5);
    expect(vm.state.placementBlock).toBeNull();
    // 沿通道方向平移（间距不变）也允许；y=3 时与主入口上下不相交
    vm.moveElement('booth-1', 0.5, 3);
    expect(vm.state.document.elements.find((element) => element.id === 'booth-1')?.y).toBe(3);
  });

  it('blocks squeezing an existing channel narrower and identifies the channel', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectElement('booth-1');
    // 当前间距 1.0，继续向右压到 0.3
    vm.moveElement('booth-1', 4.7, 2);
    const booth = vm.state.document.elements.find((element) => element.id === 'booth-1');
    expect(booth?.x).toBe(4);
    const conflict = vm.state.placementBlock?.conflicts[0];
    expect(conflict?.kind).toBe('channel');
    expect(conflict?.otherId).toBe('stage-1');
    expect(conflict?.message).toContain('分享舞台');
    expect(conflict?.message).toContain('0.3');
  });

  it('lets a temporary override place an illegal layout and keeps warnings visible', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.setConstraintsRelaxed(true);
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')?.x).toBe(4.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
    expect(vm.state.placementBlock?.relaxed).toBe(true);
    expect(vm.state.notice.tone).toBe('warning');
    // 恢复约束后，继续把元素挪到左下角空旷区域（与所有元素斜向分离）
    vm.setConstraintsRelaxed(false);
    vm.moveElement('stage-1', 17.3, 12.5);
    expect(vm.state.placementBlock).toBeNull();
  });

  it('gates rotation with the same footprint-aware placement rule', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    // 先在检查模式自由摆放：booth-2(5×3.5) 位于舞台右侧，间距 1.3，通道达标
    vm.setMode('inspect');
    vm.selectElement('booth-2');
    vm.moveElement('booth-2', 19.3, 2);
    expect(vm.state.analysis.channels.find((issue) => issue.firstId === 'stage-1' && issue.secondId === 'booth-2')).toBeUndefined();
    // 旋转 90° 后占地变为 3.5 宽，右边保持 22.8，左边到 19.3，与舞台间距仍为 1.3 → 合法
    vm.setMode('edit');
    vm.rotateSelected();
    expect(vm.state.document.elements.find((element) => element.id === 'booth-2')?.rotation).toBe(90);
    expect(vm.state.placementBlock).toBeNull();
    // 再往左挪到与舞台间距 0.5（旋转状态下同样按 AABB 判断），应被挡住
    vm.moveElement('booth-2', 18.5, 2);
    expect(vm.state.document.elements.find((element) => element.id === 'booth-2')?.x).toBe(19.3);
    expect(vm.state.placementBlock?.conflicts[0]?.kind).toBe('channel');
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), save: vi.fn(async () => {}) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save: vi.fn(async () => { throw new Error('quota'); }) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.state.document.elements.some((element) => element.kind === 'stage' && element.id.startsWith('stage-'))).toBe(true);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('ignores invalid dimensions instead of corrupting the working selection', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    const before = vm.state.document.elements[0].width;
    vm.resizeSelected(0, 0);
    expect(vm.state.document.elements[0].width).toBe(before);
  });
});
