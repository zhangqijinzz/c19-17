import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument, findElement } from '../src/domain';
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
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
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

describe('channel guard', () => {
  it('blocks a drag that would narrow a channel and names the affected pair', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('seating-1', 9.5, 2);
    expect(findElement(vm.state.document, 'seating-1')?.x).toBe(10);
    expect(vm.state.notice.tone).toBe('warning');
    expect(vm.state.notice.message).toContain('休息座席');
    expect(vm.state.notice.message).toContain('香氛展位');
    expect(vm.state.notice.message).toContain('0.5 m');
  });

  it('clears the block warning once a later drop respects the channel', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('seating-1', 9.5, 2);
    expect(vm.state.notice.tone).toBe('warning');
    vm.moveElement('seating-1', 10, 11);
    expect(vm.state.notice.tone).toBe('info');
  });

  it('lets the same drop through when the guard is temporarily lifted', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.toggleChannelGuard();
    vm.moveElement('seating-1', 9.5, 2);
    expect(findElement(vm.state.document, 'seating-1')?.x).toBe(9.5);
  });

  it('never locks a layout that already violates the channel rule', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 9.5, 1.5);
    expect(findElement(vm.state.document, 'stage-1')?.x).toBe(9.5);
  });

  it('leaves inspect mode free for probing tight spots', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.setMode('inspect');
    vm.moveElement('seating-1', 9.5, 2);
    expect(findElement(vm.state.document, 'seating-1')?.x).toBe(9.5);
  });

  it('blocks a rotation whose new footprint would squeeze a channel', async () => {
    const document: LayoutDocument = {
      version: 1,
      title: 't',
      field: { width: 20, height: 12 },
      elements: [
        { id: 'a', kind: 'booth', name: '甲展位', x: 1, y: 1, width: 2, height: 5, rotation: 0 },
        { id: 'b', kind: 'booth', name: '乙展位', x: 6.6, y: 1, width: 2, height: 5, rotation: 0 },
      ],
    };
    const vm = new ExpoSketchViewModel(fakeRepository(document));
    await vm.initialize();
    vm.rotateSelected();
    expect(findElement(vm.state.document, 'a')?.rotation).toBe(0);
    expect(vm.state.notice.tone).toBe('warning');
    expect(vm.state.notice.message).toContain('乙展位');
    vm.toggleChannelGuard();
    vm.rotateSelected();
    expect(findElement(vm.state.document, 'a')?.rotation).toBe(90);
  });
});
