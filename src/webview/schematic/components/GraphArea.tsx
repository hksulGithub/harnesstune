import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TopologyState } from '../../../types/topology';
import { TopologyNodeComponent } from './TopologyNodeComponent';
import { TopologyEdgeComponent } from './TopologyEdgeComponent';
import { Minimap } from './Minimap';

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface GraphAreaProps {
  topology: TopologyState;
  selectedNodeId: string | null;
  viewTransform: ViewTransform;
  fitToViewCounter: number;
  onSelectNode: (sessionId: string | null) => void;
  onViewTransformChange: (transform: ViewTransform) => void;
}

const NODE_W = 140;
const NODE_H = 44;
const PADDING = 24; // xl token

export function GraphArea({
  topology,
  selectedNodeId,
  viewTransform,
  fitToViewCounter,
  onSelectNode,
  onViewTransformChange,
}: GraphAreaProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 });

  // Check prefers-reduced-motion once (stable — no listener needed for this use case)
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Track SVG dimensions for fit-to-view and minimap viewport indicator
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSvgSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Fit-to-view algorithm
  const fitToView = useCallback(() => {
    const { nodes } = topology;
    if (nodes.length === 0) return;

    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + NODE_W));
    const maxY = Math.max(...nodes.map(n => n.y + NODE_H));

    const graphW = maxX - minX;
    const graphH = maxY - minY;

    const w = svgSize.width - PADDING * 2;
    const h = svgSize.height - PADDING * 2;
    const scaleX = w / graphW;
    const scaleY = h / graphH;
    const newScale = Math.min(scaleX, scaleY, 3.0);
    const clampedScale = Math.max(0.2, newScale);

    const cx = minX + graphW / 2;
    const cy = minY + graphH / 2;
    const newX = svgSize.width / 2 - cx * clampedScale;
    const newY = svgSize.height / 2 - cy * clampedScale;

    onViewTransformChange({ x: newX, y: newY, scale: clampedScale });
  }, [topology, svgSize, onViewTransformChange]);

  // Respond to fitToViewCounter changes
  useEffect(() => {
    if (fitToViewCounter > 0) {
      fitToView();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToViewCounter]);

  // Keyboard handler on SVG root
  const handleSvgKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      switch (e.key) {
        case '+':
        case '=':
          onViewTransformChange({
            ...viewTransform,
            scale: Math.min(3.0, +(viewTransform.scale * 1.1).toFixed(4)),
          });
          e.preventDefault();
          break;
        case '-':
          onViewTransformChange({
            ...viewTransform,
            scale: Math.max(0.2, +(viewTransform.scale / 1.1).toFixed(4)),
          });
          e.preventDefault();
          break;
        case '0':
          onViewTransformChange({ ...viewTransform, scale: 1.0 });
          e.preventDefault();
          break;
        case 'f':
        case 'F':
          fitToView();
          e.preventDefault();
          break;
        case 'Escape':
          onSelectNode(null);
          e.preventDefault();
          break;
        default:
          break;
      }
    },
    [viewTransform, onViewTransformChange, fitToView, onSelectNode],
  );

  // Node keyboard handler
  const handleNodeKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGGElement>, sessionId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        onSelectNode(sessionId);
        e.preventDefault();
        e.stopPropagation();
      }
      // Arrow key navigation between nodes
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const { nodes } = topology;
        const current = nodes.find(n => n.sessionId === sessionId);
        if (!current) return;

        let target: typeof current | undefined;

        if (e.key === 'ArrowUp') {
          // Navigate to parent
          target = current.parentSessionId
            ? nodes.find(n => n.sessionId === current.parentSessionId)
            : undefined;
        } else if (e.key === 'ArrowDown') {
          // Navigate to first child
          target = nodes.find(n => n.parentSessionId === sessionId);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          // Navigate to siblings
          if (current.parentSessionId) {
            const siblings = nodes.filter(n => n.parentSessionId === current.parentSessionId);
            const idx = siblings.findIndex(n => n.sessionId === sessionId);
            if (e.key === 'ArrowLeft' && idx > 0) {
              target = siblings[idx - 1];
            } else if (e.key === 'ArrowRight' && idx < siblings.length - 1) {
              target = siblings[idx + 1];
            }
          }
        }

        if (target) {
          e.preventDefault();
          e.stopPropagation();
          // Focus the target node element
          const el = svgRef.current?.querySelector(`[data-session-id="${target.sessionId}"]`) as HTMLElement | null;
          el?.focus();
        }
      }
    },
    [topology, onSelectNode],
  );

  // Wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      const newScale = Math.min(3.0, Math.max(0.2, +(viewTransform.scale * factor).toFixed(4)));
      onViewTransformChange({ ...viewTransform, scale: newScale });
    },
    [viewTransform, onViewTransformChange],
  );

  // Pan: mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Only pan on primary button click on background (not on nodes)
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest('.node')) return;

      setIsDragging(true);
      dragStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        panX: viewTransform.x,
        panY: viewTransform.y,
      };
      e.preventDefault();
    },
    [viewTransform],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isDragging || !dragStart.current) return;
      const dx = e.clientX - dragStart.current.mouseX;
      const dy = e.clientY - dragStart.current.mouseY;
      onViewTransformChange({
        ...viewTransform,
        x: dragStart.current.panX + dx,
        y: dragStart.current.panY + dy,
      });
    },
    [isDragging, viewTransform, onViewTransformChange],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStart.current = null;
  }, []);

  // Click on SVG background deselects
  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const target = e.target as Element;
      if (!target.closest('.node')) {
        onSelectNode(null);
      }
    },
    [onSelectNode],
  );

  const { nodes, edges } = topology;

  return (
    <div className="graph-area">
      {nodes.length === 0 ? (
        <div className="empty-state">
          <h2>Topology will render once at least one agent is connected.</h2>
          <p>Schematic will render once an agent reports its task graph.</p>
        </div>
      ) : (
        <>
          <svg
            ref={svgRef}
            className={`graph-svg${isDragging ? ' dragging' : ''}`}
            width="100%"
            height="100%"
            role="application"
            aria-label="Agent topology graph"
            tabIndex={0}
            onKeyDown={handleSvgKeyDown}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleSvgClick}
          >
            <g
              className="viewport"
              transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.scale})`}
            >
              {/* Render edges first (below nodes) */}
              {edges.map(edge => {
                const src = nodes.find(n => n.sessionId === edge.sourceSessionId);
                const tgt = nodes.find(n => n.sessionId === edge.targetSessionId);
                if (!src || !tgt) return null;
                return (
                  <TopologyEdgeComponent
                    key={edge.id}
                    edge={edge}
                    sourceNode={src}
                    targetNode={tgt}
                    reducedMotion={reducedMotion}
                  />
                );
              })}

              {/* Render nodes on top */}
              {nodes.map(node => (
                <TopologyNodeComponent
                  key={node.sessionId}
                  node={node}
                  isSelected={node.sessionId === selectedNodeId}
                  onClick={onSelectNode}
                  onKeyDown={handleNodeKeyDown}
                />
              ))}
            </g>
          </svg>

          <Minimap
            nodes={nodes}
            viewTransform={viewTransform}
            svgWidth={svgSize.width}
            svgHeight={svgSize.height}
          />
        </>
      )}
    </div>
  );
}
