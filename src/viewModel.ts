import { MIN_CHANNEL, createElement, createStarterDocument, analyzeLayout, evaluatePlacement, findElement, getBoundingBox, normalizeRotation } from './domain';
import type { PlacementIssue } from './domain';
import type { LayoutRepository } from './repository';
import type { Analysis, ElementKind, ExpoElement, LayoutDocument, LayoutMode, Notice, PlacementBlock, PlacementConflict, RenderElement, ViewPhase } from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedElement: RenderElement | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  lastSavedAt: number | null;
  constraintsRelaxed: boolean;
  placementBlock: PlacementBlock | null;
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
    lastSavedAt: null,
    constraintsRelaxed: false,
    placementBlock: null,
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

  selectElement(id: string) { this.commit({ selectedId: id, placementBlock: null }); }

  setMode(mode: LayoutMode) {
    const notice = mode === 'inspect'
      ? '检查模式已开启：拖动元素查看即时提示'
      : mode === 'path'
        ? '路径模式已开启：入口到重点区域的访问路线已生成'
        : '编辑模式已开启：落点会按最小通道约束检查';
    this.commit({ mode, placementBlock: null, notice: { tone: 'info', message: notice } });
  }

  setConstraintsRelaxed(relaxed: boolean) {
    this.commit({
      constraintsRelaxed: relaxed,
      placementBlock: null,
      notice: {
        tone: relaxed ? 'warning' : 'info',
        message: relaxed
          ? '已临时放开通道约束：仅本次编辑有效，违规摆法会保留并在检查中标出'
          : '通道约束已恢复：新的窄通道、重叠和越界落点会被挡住',
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
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, placementBlock: null, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    const current = findElement(this.stateValue.document, id);
    if (!current) return;
    const candidate = { ...current, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    if (this.stateValue.mode === 'edit') {
      this.applyCandidate(current, candidate);
      return;
    }
    // 检查/路径模式保持自由拖动，问题交给实时检查面板呈现。
    const elements = this.stateValue.document.elements.map((element) => (element.id === candidate.id ? candidate : element));
    this.commitDocumentWith(elements, { placementBlock: null });
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, placementBlock: null });
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    const current = id ? findElement(this.stateValue.document, id) : null;
    if (!current) return;
    const candidate = { ...current, rotation: normalizeRotation(current.rotation + 90) };
    // 旋转改变占地范围，必须与拖动使用同一个落点判断，避免换个朝向就能绕过通道约束。
    if (this.stateValue.mode === 'edit') {
      this.applyCandidate(current, candidate, { tone: 'info', message: '方向已旋转 90°' });
      return;
    }
    const elements = this.stateValue.document.elements.map((element) => (element.id === candidate.id ? candidate : element));
    this.commitDocumentWith(elements, { placementBlock: null, notice: { tone: 'info', message: '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, placementBlock: null, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', mode: 'edit', constraintsRelaxed: false, placementBlock: null, notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  private commitDocumentWith(updatedElements: ExpoElement[], patch: Partial<ExpoSketchState>) {
    this.commitAndPersist({ document: { ...this.stateValue.document, elements: updatedElements }, ...patch });
  }

  // 编辑模式的统一落点闸门，拖动和旋转共用。
  // 只拦截"相对当前位置新增或恶化的问题"：已存在的窄通道/重叠/越界不会锁死元素，
  // 用户可以把元素从错误位置朝改善方向挪出去。
  private applyCandidate(current: ExpoElement, candidate: ExpoElement, successNotice?: Notice) {
    const { field, elements } = this.stateValue.document;
    const others = elements.filter((element) => element.id !== candidate.id);
    const candidateIssues = evaluatePlacement(candidate, others, field);
    const baseline = evaluatePlacement(current, others, field);
    const blocked = candidateIssues.filter((issue) => this.blocksMovement(issue, baseline));

    if (blocked.length > 0 && !this.stateValue.constraintsRelaxed) {
      this.commit({ placementBlock: { elementId: candidate.id, relaxed: false, conflicts: blocked.map((issue) => this.describeConflict(issue)) } });
      return;
    }

    const nextElements = elements.map((element) => (element.id === candidate.id ? candidate : element));
    if (blocked.length > 0) {
      // 临时放开：落点照收，但保留警告，检查面板仍会列出这些问题。
      const conflicts = blocked.map((issue) => this.describeConflict(issue));
      const warning: Notice = { tone: 'warning', message: `已临时放开：${conflicts.map((conflict) => conflict.message).join('；')}` };
      const sameWarning = this.stateValue.notice.tone === 'warning' && this.stateValue.notice.message === warning.message;
      this.commitAndPersist({
        document: { ...this.stateValue.document, elements: nextElements },
        placementBlock: { elementId: candidate.id, relaxed: true, conflicts },
        ...(sameWarning ? {} : { notice: warning }),
      });
      return;
    }

    this.commitAndPersist({
      document: { ...this.stateValue.document, elements: nextElements },
      placementBlock: null,
      ...(successNotice ? { notice: successNotice } : {}),
    });
  }

  // 同一对元素的"净距"：分离时为通道宽度，侵入时用负重叠面积表示。
  // 这样从重叠里往外拖、最终落到窄通道也视为改善，不会被类型切换误挡。
  private pairClearance(issue: PlacementIssue): number {
    return issue.kind === 'channel' ? issue.gap ?? 0 : -(issue.amount ?? 0);
  }

  private blocksMovement(issue: PlacementIssue, baseline: PlacementIssue[]): boolean {
    if (issue.kind === 'bounds') {
      const currentOverflow = baseline.find((item) => item.kind === 'bounds')?.overflow ?? 0;
      return (issue.overflow ?? 0) > currentOverflow + 0.05;
    }
    const existing = baseline.find((item) => item.otherId !== null && item.otherId === issue.otherId && item.kind !== 'bounds');
    if (!existing) return this.pairClearance(issue) < MIN_CHANNEL - 0.05;
    return this.pairClearance(issue) < this.pairClearance(existing) - 0.05;
  }

  private describeConflict(issue: PlacementIssue): PlacementConflict {
    const other = issue.otherId ? findElement(this.stateValue.document, issue.otherId) : null;
    if (issue.kind === 'channel') {
      const gap = (issue.gap ?? 0).toFixed(1);
      return {
        kind: 'channel',
        otherId: issue.otherId,
        message: other
          ? `与「${other.name}」之间通道仅剩 ${gap} m（最小 ${MIN_CHANNEL} m）`
          : `通道仅剩 ${gap} m（最小 ${MIN_CHANNEL} m）`,
      };
    }
    if (issue.kind === 'overlap') {
      return { kind: 'overlap', otherId: issue.otherId, message: other ? `与「${other.name}」发生重叠` : '与其他元素发生重叠' };
    }
    return { kind: 'bounds', otherId: null, message: `超出场地边界 ${(issue.overflow ?? 0).toFixed(1)} m` };
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    void this.persist();
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
