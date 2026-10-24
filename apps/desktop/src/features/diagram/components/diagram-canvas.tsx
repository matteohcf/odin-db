import { commands, type DatabaseDiagram } from "@odin-db/bindings";
import { useTheme } from "@odin-db/ui/components/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import {
  Background,
  BackgroundVariant,
  type Edge,
  getNodesBounds,
  getViewportForBounds,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { ClipboardCopy, ImageDown, LayoutGrid, Map as MapIcon, Maximize } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconAction } from "@/components/icon-action";
import { call, errorMessage } from "@/lib/ipc";
import { buildGraph, type FieldMode } from "../lib/diagram-graph";
import { toMermaid } from "../lib/mermaid";
import { usePositions } from "../store/positions-store";
import { DiagramActions } from "./diagram-actions";
import { type DiagramCollectionNode, DiagramCollectionNodeView } from "./diagram-collection-node";
import { DiagramSearch } from "./diagram-search";

const nodeTypes = { collection: DiagramCollectionNodeView };
const EDGE_STROKE = "color-mix(in oklab, var(--muted-foreground) 60%, transparent)";

// React Flow's own variables, pointed at the design tokens so it follows theme and accent.
const flowStyle = {
  "--xy-background-color": "var(--background)",
  "--xy-background-pattern-color": "color-mix(in oklab, var(--muted-foreground) 25%, transparent)",
  "--xy-edge-stroke-selected": "var(--primary)",
  "--xy-minimap-background-color": "var(--card)",
  "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--background) 70%, transparent)",
  "--xy-minimap-node-background-color": "var(--muted)",
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;

interface DiagramCanvasProps {
  diagram: DatabaseDiagram;
  database: string;
  /** `profileId/database`, under which dragged positions are kept. */
  storageKey: string;
  onOpen: (collection: string) => void;
}

/**
 * The collections of a database as cards, joined by the references found between them.
 * Needs a `ReactFlowProvider` above it.
 */
export function DiagramCanvas({ diagram, database, storageKey, onOpen }: DiagramCanvasProps) {
  const { t } = useTranslation("diagram");
  const { theme } = useTheme();
  const flow = useReactFlow();
  const [mode, setMode] = useState<FieldMode>("all");
  const [minimap, setMinimap] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const saved = usePositions((s) => s.byDatabase[storageKey]);
  const move = usePositions((s) => s.move);
  const reset = usePositions((s) => s.reset);

  const graph = useMemo(() => buildGraph(diagram, mode, saved), [diagram, mode, saved]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramCollectionNode>([]);
  useEffect(() => {
    setNodes((current) =>
      graph.nodes.map((node) => ({
        ...node,
        type: "collection" as const,
        selected: current.find((other) => other.id === node.id)?.selected ?? false,
      })),
    );
  }, [graph, setNodes]);

  // The hovered or selected collection lights up its references; the rest steps back.
  const lit = focus ?? nodes.find((node) => node.selected)?.id ?? null;
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((edge) => {
        const active = lit !== null && (edge.source === lit || edge.target === lit);
        const { link } = edge.data;
        return {
          ...edge,
          type: "smoothstep",
          animated: active,
          label: active ? `${link.field}${link.many ? " · 1:N" : ""}` : undefined,
          labelStyle: { fontSize: 11, fill: "var(--foreground)" },
          labelBgStyle: { fill: "var(--card)" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: {
            strokeWidth: active ? 2 : 1.25,
            // Explicit, not inherited from the canvas, so the saved image keeps the lines.
            stroke: active ? "var(--primary)" : EDGE_STROKE,
            opacity: lit === null || active ? 1 : 0.25,
          },
        };
      }),
    [graph.edges, lit],
  );

  const matchIds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? diagram.collections.filter((c) => c.name.toLowerCase().includes(needle)).map((c) => c.name)
      : [];
  }, [diagram, query]);
  const [current, setCurrent] = useState(0);
  // While searching, everything but the matches steps back.
  const shownNodes = useMemo(() => {
    if (query.trim() === "") return nodes;
    const matched = new Set(matchIds);
    return nodes.map((node) =>
      matched.has(node.id) ? node : { ...node, className: "opacity-30 transition-opacity" },
    );
  }, [nodes, matchIds, query]);
  async function saveImage() {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) return;
    // The whole diagram at a readable scale, whatever is on screen right now.
    const bounds = getNodesBounds(flow.getNodes());
    const width = Math.min(Math.ceil(bounds.width + 96), 6000);
    const height = Math.min(Math.ceil(bounds.height + 96), 6000);
    const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.1, 1, 0.04);
    try {
      const png = await toPng(viewport, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue(
          "--background",
        ),
        width,
        height,
        pixelRatio: 2,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        },
      });
      const path = await call(commands.saveDiagramImage(png, database));
      if (path) toast.success(t("saved", { path }));
    } catch (error) {
      toast.error(t("saveFailed", { message: errorMessage(error) }));
    }
  }

  function focusMatch(index: number) {
    const id = matchIds[index];
    if (!id) return;
    setCurrent(index);
    setNodes((list) => list.map((node) => ({ ...node, selected: node.id === id })));
    void flow.fitView({ nodes: [{ id }], duration: 250, maxZoom: 1.2 });
  }
  // The first match comes into view as soon as the query finds one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new list of matches moves the view.
  useEffect(() => {
    if (matchIds.length > 0) focusMatch(0);
  }, [matchIds]);

  return (
    <DiagramActions.Provider value={{ onOpen }}>
      <ReactFlow
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => move(storageKey, node.id, node.position)}
        onNodeMouseEnter={(_, node) => setFocus(node.id)}
        onNodeMouseLeave={() => setFocus(null)}
        onNodeDoubleClick={(_, node) => onOpen(node.id)}
        colorMode={theme}
        style={flowStyle}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        edgesFocusable={false}
        // A diagram only shows the database: no key removes anything from it.
        deleteKeyCode={null}
        onlyRenderVisibleElements
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        {minimap && <MiniMap pannable zoomable className="!rounded-md !border" />}
        <Panel position="top-left" className="!m-3 flex items-center gap-2">
          <DiagramSearch
            query={query}
            onQueryChange={setQuery}
            matches={matchIds.length}
            current={current}
            onStep={(direction) =>
              focusMatch((current + direction + matchIds.length) % Math.max(matchIds.length, 1))
            }
          />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(value) => value && setMode(value as FieldMode)}
            aria-label={t("fields.label")}
            className="bg-card shadow-xs"
          >
            <ToggleGroupItem value="all" className="px-3">
              {t("fields.all")}
            </ToggleGroupItem>
            <ToggleGroupItem value="keys" className="px-3">
              {t("fields.keys")}
            </ToggleGroupItem>
          </ToggleGroup>
        </Panel>
        <Panel
          position="top-right"
          className="!m-3 flex items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-xs"
        >
          <IconAction
            label={t("layout")}
            onClick={() => {
              reset(storageKey);
              requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 300 }));
            }}
          >
            <LayoutGrid />
          </IconAction>
          <IconAction
            label={t("fit")}
            onClick={() => void flow.fitView({ padding: 0.15, duration: 300 })}
          >
            <Maximize />
          </IconAction>
          <IconAction
            label={t("copyMermaid")}
            onClick={() => {
              void navigator.clipboard.writeText(toMermaid(diagram));
              toast.success(t("mermaidCopied"));
            }}
          >
            <ClipboardCopy />
          </IconAction>
          <IconAction label={t("saveImage")} onClick={() => void saveImage()}>
            <ImageDown />
          </IconAction>
          <IconAction
            label={t("minimap")}
            onClick={() => setMinimap((value) => !value)}
            className={minimap ? "bg-accent text-foreground" : undefined}
          >
            <MapIcon />
          </IconAction>
        </Panel>
        {diagram.links.length === 0 && diagram.collections.length > 1 && (
          <Panel position="bottom-center" className="!mb-4">
            <p className="rounded-md border bg-card px-3 py-1.5 text-muted-foreground text-xs shadow-xs">
              {t("noLinks")}
            </p>
          </Panel>
        )}
      </ReactFlow>
    </DiagramActions.Provider>
  );
}
