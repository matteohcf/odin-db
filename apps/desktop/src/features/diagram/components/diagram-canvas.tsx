import { commands, type DatabaseDiagram } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { useTheme } from "@odin-db/ui/components/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import {
  Background,
  BackgroundVariant,
  type Connection,
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
import {
  ClipboardCopy,
  ImageDown,
  LayoutGrid,
  Map as MapIcon,
  Maximize,
  SquareDashed,
  StickyNote,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconAction } from "@/components/icon-action";
import { call, errorMessage } from "@/lib/ipc";
import { PROFILE_COLORS } from "@/lib/profile-colors";
import {
  AREA_SIZE,
  annotate,
  drawnLink,
  linkId,
  NO_ANNOTATIONS,
  NOTE_SIZE,
  nodesInside,
} from "../lib/annotations";
import { buildGraph, type FieldMode, HEADER_HANDLE } from "../lib/diagram-graph";
import { toMermaid } from "../lib/mermaid";
import { useAnnotations } from "../store/annotations-store";
import { usePositions } from "../store/positions-store";
import { DiagramActions } from "./diagram-actions";
import { AREA_HANDLE, type DiagramAreaNode, DiagramAreaNodeView } from "./diagram-area-node";
import { type DiagramCollectionNode, DiagramCollectionNodeView } from "./diagram-collection-node";
import { type DiagramEdge, DiagramEdgeView } from "./diagram-edge";
import { type DiagramNoteNode, DiagramNoteNodeView } from "./diagram-note-node";
import { DiagramSearch } from "./diagram-search";

const nodeTypes = {
  collection: DiagramCollectionNodeView,
  note: DiagramNoteNodeView,
  area: DiagramAreaNodeView,
};
type DiagramNode = DiagramCollectionNode | DiagramNoteNode | DiagramAreaNode;
const edgeTypes = { link: DiagramEdgeView };
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
 * The collections of a database as cards, joined by the references found between them, with
 * the references, notes and areas the user added. Needs a `ReactFlowProvider` above it.
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
  const moveMany = usePositions((s) => s.moveMany);
  const reset = usePositions((s) => s.reset);
  const annotations = useAnnotations((s) => s.byDatabase[storageKey]) ?? NO_ANNOTATIONS;
  const {
    addLink,
    removeLink,
    hideLink,
    showHidden,
    addNote,
    updateNote,
    removeNote,
    addArea,
    updateArea,
    removeArea,
  } = useAnnotations.getState();
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  // The note or area just added, which takes the keyboard.
  const [fresh, setFresh] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  // While an area is dragged: where it started, and the nodes inside it then.
  const carried = useRef<{
    start: { x: number; y: number };
    nodes: Map<string, { x: number; y: number }>;
  } | null>(null);

  const { diagram: shown, manual } = useMemo(
    () => annotate(diagram, annotations),
    [diagram, annotations],
  );
  const hiddenCount = useMemo(() => {
    const inferred = new Set(diagram.links.map(linkId));
    return annotations.hidden.filter((id) => inferred.has(id)).length;
  }, [diagram, annotations.hidden]);
  const graph = useMemo(
    () => buildGraph(shown, mode, saved, diagram.links),
    [shown, mode, saved, diagram.links],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([]);
  useEffect(() => {
    setNodes((current) => {
      const selected = new Set(current.filter((node) => node.selected).map((node) => node.id));
      return [
        ...annotations.areas.map(
          (area): DiagramAreaNode => ({
            id: area.id,
            type: "area",
            position: area.position,
            width: area.width,
            height: area.height,
            data: { label: area.label, color: area.color, autoFocus: area.id === fresh },
            selected: selected.has(area.id),
            zIndex: -1,
            dragHandle: `.${AREA_HANDLE}`,
            // Only its title strip and handles take the pointer: inside, the canvas pans.
            style: { pointerEvents: "none" },
          }),
        ),
        ...graph.nodes.map(
          (node): DiagramCollectionNode => ({
            ...node,
            type: "collection",
            selected: selected.has(node.id),
          }),
        ),
        ...annotations.notes.map(
          (note): DiagramNoteNode => ({
            id: note.id,
            type: "note",
            position: note.position,
            width: note.width,
            height: note.height,
            data: { text: note.text, autoFocus: note.id === fresh },
            selected: selected.has(note.id),
          }),
        ),
      ];
    });
  }, [graph, annotations.notes, annotations.areas, fresh, setNodes]);

  // The hovered or selected collection lights up its references; the rest steps back.
  const lit =
    focus ?? nodes.find((node) => node.selected && node.type === "collection")?.id ?? null;
  const edges: DiagramEdge[] = useMemo(
    () =>
      graph.edges.map((edge) => {
        const selected = edge.id === selectedEdge;
        const active = selected || (lit !== null && (edge.source === lit || edge.target === lit));
        const drawn = manual.has(edge.id);
        return {
          ...edge,
          type: "link",
          selected,
          animated: active && !drawn,
          data: { link: edge.data.link, manual: drawn, active },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: {
            strokeWidth: active ? 2 : 1.25,
            // Explicit, not inherited from the canvas, so the saved image keeps the lines.
            stroke: active ? "var(--primary)" : EDGE_STROKE,
            // Drawn by hand: dashed, so it never passes for something found in the data.
            ...(drawn ? { strokeDasharray: "5 4" } : {}),
            opacity: lit === null || active ? 1 : 0.25,
          },
        };
      }),
    [graph.edges, lit, selectedEdge, manual],
  );

  function connect({ source, sourceHandle, target }: Connection) {
    if (!sourceHandle || sourceHandle === HEADER_HANDLE) return;
    addLink(storageKey, drawnLink(diagram, source, sourceHandle, target));
  }

  /** Where something of `size` sits centred in the visible part of the diagram. */
  function centred(size: { width: number; height: number }) {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return null;
    const center = flow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  }

  function newNote() {
    const position = centred(NOTE_SIZE);
    if (!position) return;
    const id = `note-${crypto.randomUUID()}`;
    addNote(storageKey, { id, text: "", position, ...NOTE_SIZE });
    setFresh(id);
  }

  function newArea() {
    const position = centred(AREA_SIZE);
    if (!position) return;
    const id = `area-${crypto.randomUUID()}`;
    // Blue first, then around the palette, so neighbouring areas differ.
    const color = PROFILE_COLORS[(annotations.areas.length + 5) % PROFILE_COLORS.length] ?? "blue";
    addArea(storageKey, { id, label: "", color, position, ...AREA_SIZE });
    setFresh(id);
  }

  const sizeOf = (node: DiagramNode) => ({
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  });

  function startDrag(node: DiagramNode) {
    if (node.type !== "area") return;
    const others = flow
      .getNodes()
      .filter((other) => other.type !== "area")
      .map((other) => ({
        id: other.id,
        position: other.position,
        ...sizeOf(other as DiagramNode),
      }));
    const inside = new Set(nodesInside({ position: node.position, ...sizeOf(node) }, others));
    carried.current = {
      start: node.position,
      nodes: new Map(others.filter((o) => inside.has(o.id)).map((o) => [o.id, o.position])),
    };
  }

  function drag(node: DiagramNode) {
    const moving = carried.current;
    if (!moving || node.type !== "area") return;
    const dx = node.position.x - moving.start.x;
    const dy = node.position.y - moving.start.y;
    setNodes((list) =>
      list.map((other) => {
        const from = moving.nodes.get(other.id);
        return from ? { ...other, position: { x: from.x + dx, y: from.y + dy } } : other;
      }),
    );
  }

  function stopDrag(node: DiagramNode) {
    if (node.type === "note") {
      updateNote(storageKey, node.id, { position: node.position });
      return;
    }
    if (node.type === "collection") {
      move(storageKey, node.id, node.position);
      return;
    }
    updateArea(storageKey, node.id, { position: node.position });
    const moving = carried.current;
    carried.current = null;
    if (!moving) return;
    const placed = new Map(flow.getNodes().map((other) => [other.id, other]));
    const collections: Record<string, { x: number; y: number }> = {};
    for (const id of moving.nodes.keys()) {
      const other = placed.get(id);
      if (other?.type === "note") updateNote(storageKey, id, { position: other.position });
      else if (other) collections[id] = other.position;
    }
    moveMany(storageKey, collections);
  }

  const actions = useMemo(
    () => ({
      onOpen,
      onRemoveLink: (id: string) => {
        removeLink(storageKey, id);
        setSelectedEdge(null);
      },
      onHideLink: (id: string) => {
        hideLink(storageKey, id);
        setSelectedEdge(null);
      },
      onNoteChange: (id: string, text: string) => updateNote(storageKey, id, { text }),
      onNoteResize: (
        id: string,
        { x, y, width, height }: { x: number; y: number; width: number; height: number },
      ) => updateNote(storageKey, id, { position: { x, y }, width, height }),
      onRemoveNote: (id: string) => removeNote(storageKey, id),
      onAreaChange: (
        id: string,
        patch: { label?: string; color?: DiagramAreaNode["data"]["color"] },
      ) => updateArea(storageKey, id, patch),
      onAreaResize: (
        id: string,
        { x, y, width, height }: { x: number; y: number; width: number; height: number },
      ) => updateArea(storageKey, id, { position: { x, y }, width, height }),
      onRemoveArea: (id: string) => removeArea(storageKey, id),
    }),
    [onOpen, storageKey, removeLink, hideLink, updateNote, removeNote, updateArea, removeArea],
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
    <DiagramActions.Provider value={actions}>
      <ReactFlow
        ref={container}
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_, node) => startDrag(node)}
        onNodeDrag={(_, node) => drag(node)}
        onNodeDragStop={(_, node) => stopDrag(node)}
        onNodeMouseEnter={(_, node) => node.type === "collection" && setFocus(node.id)}
        onNodeMouseLeave={() => setFocus(null)}
        onNodeDoubleClick={(_, node) => node.type === "collection" && onOpen(node.id)}
        onNodeClick={() => setSelectedEdge(null)}
        onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}
        onPaneClick={() => setSelectedEdge(null)}
        onConnect={connect}
        connectionLineStyle={{ stroke: "var(--primary)", strokeWidth: 2 }}
        colorMode={theme}
        style={flowStyle}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        edgesFocusable={false}
        // An area stays behind its collections even while selected.
        elevateNodesOnSelect={false}
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
              void navigator.clipboard.writeText(toMermaid(shown));
              toast.success(t("mermaidCopied"));
            }}
          >
            <ClipboardCopy />
          </IconAction>
          <IconAction label={t("addArea")} onClick={newArea}>
            <SquareDashed />
          </IconAction>
          <IconAction label={t("addNote")} onClick={newNote}>
            <StickyNote />
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
        {hiddenCount > 0 && (
          <Panel position="bottom-left" className="!m-3">
            <p className="flex items-center gap-2 rounded-md border bg-card py-1 pr-1 pl-3 text-muted-foreground text-xs shadow-xs">
              {t("hiddenLinks", { count: hiddenCount })}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => showHidden(storageKey)}
              >
                {t("showHidden")}
              </Button>
            </p>
          </Panel>
        )}
        {shown.links.length === 0 && diagram.collections.length > 1 && (
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
