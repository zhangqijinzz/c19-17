import { createElement, createStarterDocument, analyzeLayout, findElement, findPlacementBlockers, getBoundingBox, MIN_CHANNEL, normalizeRotation } from './domain';
import type { LayoutRepository } from './repository';
import type { Analysis, ChannelBlocker, ElementKind, ExpoElement, LayoutDocument, LayoutMode, Notice, RenderElement, ViewPhase } from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedElement: RenderElement | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  channelGuard: boolean;
  lastSavedAt: number | null;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedId: 'stage-1',
    selectedElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    channelGuard: true,
    lastSavedAt: null,
  };

  constructor(private readonly repository: LayoutRepository) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const document = await this.repository.load();
      this.commit({ document, selectedId: document.elements[0]?.id ?? null, phase: 'ready', notice: { tone: 'success', message: '布局已就绪，可开始编辑' } });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  selectElement(id: string) { this.commit({ selectedId: id }); }

  setMode(mode: LayoutMode) { this.commit({ mode, notice: { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' } }); }

  toggleChannelGuard() {
    const channelGuard = !this.stateValue.channelGuard;
    this.commit({
      channelGuard,
      notice: {
        tone: 'info',
        message: channelGuard ? `通道约束已开启：编辑模式拖动将守住 ≥ ${MIN_CHANNEL} m 的通道` : '通道约束已临时放开：可自由摆放，调整完记得恢复并检查',
      },
    });
  }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedId: element.id, notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    if (!this.stateValue.selectedId) return;
    const removed = findElement(this.stateValue.document, this.stateValue.selectedId);
    const elements = this.stateValue.document.elements.filter((element) => element.id !== this.stateValue.selectedId);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    const element = findElement(this.stateValue.document, id);
    if (!element) return;
    const candidate: ExpoElement = { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    if (this.isGuardActive()) {
      const blockers = findPlacementBlockers(this.stateValue.document.elements, candidate);
      if (blockers.length > 0) {
        this.commit({ notice: { tone: 'warning', message: this.describeBlockers(candidate, blockers) } });
        return;
      }
    }
    const elements = this.stateValue.document.elements.map((item) => (item.id === id ? candidate : item));
    const patch: Partial<ExpoSketchState> = { document: { ...this.stateValue.document, elements } };
    if (this.stateValue.notice.tone === 'warning') patch.notice = { tone: 'info', message: '位置已更新，通道未受影响' };
    this.commitAndPersist(patch);
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    if (!id) return;
    const element = findElement(this.stateValue.document, id);
    if (!element) return;
    const candidate: ExpoElement = { ...element, rotation: normalizeRotation(element.rotation + 90) };
    if (this.isGuardActive()) {
      const blockers = findPlacementBlockers(this.stateValue.document.elements, candidate);
      if (blockers.length > 0) {
        this.commit({ notice: { tone: 'warning', message: this.describeBlockers(candidate, blockers) } });
        return;
      }
    }
    const elements = this.stateValue.document.elements.map((item) => (item.id === id ? candidate : item));
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, notice: { tone: 'info', message: '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    void this.persist();
  }

  private isGuardActive() {
    return this.stateValue.channelGuard && this.stateValue.mode === 'edit';
  }

  private describeBlockers(candidate: ExpoElement, blockers: ChannelBlocker[]) {
    const tightest = blockers.reduce((min, item) => (item.gap < min.gap ? item : min), blockers[0]);
    const otherName = findElement(this.stateValue.document, tightest.otherId)?.name ?? '相邻元素';
    const base = `已拦住：「${candidate.name}」与「${otherName}」之间通道将仅剩 ${tightest.gap} m（要求 ≥ ${MIN_CHANNEL} m）`;
    return blockers.length > 1 ? `${base}，另有 ${blockers.length - 1} 处通道受限` : base;
  }

  private async persist() {
    try {
      await this.repository.save(this.stateValue.document);
      this.commit({ lastSavedAt: Date.now() });
    } catch {
      this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
    }
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const renderElements = toRenderElements(next.document);
    this.stateValue = { ...next, renderElements, selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null, analysis: analyzeLayout(next.document) };
    this.listeners.forEach((listener) => listener());
  }
}
