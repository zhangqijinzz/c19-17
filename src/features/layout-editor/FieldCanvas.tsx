import { useRef, useState } from 'react';
import { ELEMENT_SPECS, MIN_CHANNEL } from '../../domain';
import type { LayoutMode, PathPreview, PlacementBlock, RenderElement } from '../../types';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedId: string | null;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  constraintsRelaxed: boolean;
  placementBlock: PlacementBlock | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onToggleRelaxed: (relaxed: boolean) => void;
}

export function FieldCanvas({ field, elements, selectedId, mode, overlaps, bounds, channels, path, constraintsRelaxed, placementBlock, onSelect, onMove, onToggleRelaxed }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const issueIds = new Set(overlaps.flatMap((item) => [item.firstId, item.secondId]));
  const channelIds = new Set(channels.flatMap((item) => [item.firstId, item.secondId]));
  const boundsIds = new Set(bounds.map((item) => item.elementId));
  const blockNeighborIds = new Set((placementBlock?.conflicts ?? []).map((conflict) => conflict.otherId).filter((id): id is string => !!id));
  const canvasWidth = 100 / Math.max(1, field.width / (field.height * 1.35));

  const pointFromEvent = (event: React.PointerEvent) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) * field.width / box.width, y: (event.clientY - box.top) * field.height / box.height };
  };

  return <div className="canvas-wrap">
    <div className="canvas-ruler top-ruler"><span>0 m</span><span>{Math.round(field.width / 2)} m</span><span>{field.width} m</span></div>
    <div className="canvas-ruler side-ruler"><span>0</span><span>{Math.round(field.height / 2)} m</span><span>{field.height} m</span></div>
    <div className={`field-canvas mode-${mode}${constraintsRelaxed ? ' is-relaxed' : ''}`} ref={canvasRef} style={{ width: `${Math.min(100, canvasWidth)}%`, aspectRatio: `${field.width} / ${field.height}` }}>
      <div className="grid-overlay" />
      <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
      <button type="button" className={`relax-toggle ${constraintsRelaxed ? 'is-on' : ''}`} aria-pressed={constraintsRelaxed} onClick={() => onToggleRelaxed(!constraintsRelaxed)} title="临时放开后可先粗略摆放，稍后再统一调整">
        <span className="relax-glyph">{constraintsRelaxed ? '✓' : '⚠'}</span>
        <span className="relax-copy"><strong>{constraintsRelaxed ? '约束已临时放开' : `最小通道 ${MIN_CHANNEL} m 约束生效中`}</strong><small>{constraintsRelaxed ? '点击恢复通道约束' : '临时放开（先摆位置再统一调整）'}</small></span>
      </button>
      {path && mode === 'path' ? <svg className="path-layer" viewBox={`0 0 ${field.width} ${field.height}`} preserveAspectRatio="none"><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth="0.3" strokeDasharray="0.75 0.55" /><circle cx={path.points[0].x} cy={path.points[0].y} r="0.45" fill="#ef795f" /><circle cx={path.points[path.points.length - 1].x} cy={path.points[path.points.length - 1].y} r="0.45" fill="#ef795f" /></svg> : null}
      {elements.map((element) => {
        const spec = ELEMENT_SPECS[element.kind];
        const isBlocked = placementBlock !== null && placementBlock.elementId === element.id && !placementBlock.relaxed;
        const classes = [
          'canvas-element',
          selectedId === element.id ? 'is-selected' : '',
          issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '',
          channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '',
          boundsIds.has(element.id) ? 'is-out' : '',
          isBlocked ? 'is-blocked' : '',
          blockNeighborIds.has(element.id) ? 'is-block-neighbor' : '',
        ].filter(Boolean).join(' ');
        // 外壳始终使用旋转后的实际占地 AABB（与 getBoundingBox 完全一致），不做 CSS 旋转；
        // 内层 body 按元素自身尺寸旋转，保证"看到的占地"与"约束判断的占地"相同。
        return <button
          key={element.id}
          type="button"
          className={classes}
          style={{ left: `${element.x / field.width * 100}%`, top: `${element.y / field.height * 100}%`, width: `${element.displayWidth / field.width * 100}%`, height: `${element.displayHeight / field.height * 100}%`, background: spec.color }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const point = pointFromEvent(event); setDrag({ id: element.id, dx: point.x - element.x, dy: point.y - element.y }); onSelect(element.id); }}
          onPointerMove={(event) => { if (!drag || drag.id !== element.id) return; const point = pointFromEvent(event); onMove(element.id, point.x - drag.dx, point.y - drag.dy); }}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          <span className="element-body" style={{ width: `${element.width / element.displayWidth * 100}%`, height: `${element.height / element.displayHeight * 100}%`, transform: `translate(-50%, -50%) rotate(${element.rotation}deg)` }}>
            <span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.width.toFixed(1)} × {element.height.toFixed(1)} m</small>
          </span>
          {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
          {isBlocked ? <span className="block-dot">⊘</span> : null}
        </button>;
      })}
      {placementBlock && !placementBlock.relaxed ? <div className="placement-badge"><span className="placement-badge-glyph">⊘</span><div>{placementBlock.conflicts.slice(0, 2).map((conflict) => <p key={`${conflict.kind}-${conflict.otherId ?? 'field'}`}>{conflict.message}</p>)}{placementBlock.conflicts.length > 2 ? <small>另有 {placementBlock.conflicts.length - 2} 处冲突…</small> : null}<small className="placement-badge-hint">落点已挡住，可临时放开约束先摆位置</small></div></div> : null}
      {placementBlock?.relaxed ? <div className="placement-badge relaxed"><span className="placement-badge-glyph">⚠</span><div><p>已在违反通道约束的情况下放置，请在检查中统一调整</p></div></div> : null}
      <div className="axis-hint">{mode === 'edit' ? (constraintsRelaxed ? '约束已放开 · 可自由拖动' : '拖动元素 · 会压窄通道的落点会被挡住') : '拖动元素 · 点击选中'}</div>
    </div>
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span></div>
  </div>;
}
