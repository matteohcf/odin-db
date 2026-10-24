import type { DatabaseDiagram } from "@odin-db/bindings";
import { useTheme } from "@odin-db/ui/components/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import {
  Background,
  BackgroundVariant,
  type Edge,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid, Map as MapIcon, Maximize, Search } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import { buildGraph, type FieldMode } from "../lib/diagram-graph";
import { usePositions } from "../store/positions-store";
import { DiagramActions } from "./diagram-actions";
import { type DiagramCollectionNode, DiagramCollectionNodeView } from "./diagram-collection-node";

const nodeTypes = { collection: DiagramCollectionNodeView };

// React Flow's own variables, pointed at the design tokens so it follows theme and accent.
const flowStyle = {
  "--xy-background-color": "var(--background)",
  "--xy-background-pattern-color": "color-mix(in oklab, var(--muted-foreground) 25%, transparent)",
  "--xy-edge-stroke": "color-mix(in oklab, var(--muted-foreground) 60%, transparent)",
  "--xy-edge-stroke-selected": "var(--primary)",
  "--xy-minimap-background-color": "var(--card)",
  "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--background) 70%, transparent)",
  "--xy-minimap-node-background-color": "var(--muted)",
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;

interface DiagramCanvasProps {
  diagram: DatabaseDiagram;
  /** `profileId/database`, under which dragged positions are kept. */
  storageKey: string;
  onOpen: (collection: string) => void;
}

/**
 * The collections of a database as cards, joined by the references found between them.
 * Needs a `ReactFlowProvider` above it.
 */
export function DiagramCanvas({ diagram, storageKey, onOpen }: DiagramCanvasProps) {
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
  const edges: Edge[] = graph.edges.map((edge) => {
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
        stroke: active ? "var(--primary)" : undefined,
        opacity: lit === null || active ? 1 : 0.25,
      },
    };
  });

  const matches = query.trim()
    ? diagram.collections.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  function findCollection() {
    const [first] = matches;
    if (!first) return;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === first.name })));
    void flow.fitView({ nodes: [{ id: first.name }], duration: 300, maxZoom: 1.2 });
  }

  return (
    <DiagramActions.Provider value={{ onOpen }}>
      <ReactFlow
        nodes={nodes}
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
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        {minimap && <MiniMap pannable zoomable className="!rounded-md !border" />}
        <Panel position="top-left" className="!m-3 flex items-center gap-2">
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              findCollection();
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              list={`${storageKey}-collections`}
              className="h-8 w-56 rounded-md border bg-card pr-2 pl-8 text-[13px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <datalist id={`${storageKey}-collections`}>
              {matches.slice(0, 20).map((collection) => (
                <option key={collection.name} value={collection.name} />
              ))}
            </datalist>
          </form>
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
