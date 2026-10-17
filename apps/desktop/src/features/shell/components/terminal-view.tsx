import { type ConnectionId, commands, type ShellEvent } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { useTheme } from "@odin-db/ui/components/theme-provider";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { CircleAlert, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";

type SessionState =
  | { status: "starting" }
  | { status: "running" }
  | { status: "exited"; code: number | null }
  | { status: "failed"; error: string };

/** Acknowledgements are batched: one IPC call per frame burst, not per chunk (ADR-0030). */
const ACK_INTERVAL_MS = 50;

/** xterm.js needs concrete colors; they come from the design tokens of the active theme. */
function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: token("--background"),
    foreground: token("--foreground"),
    cursor: token("--primary"),
    cursorAccent: token("--background"),
    selectionBackground: token("--selection"),
    green: token("--type-string"),
    blue: token("--type-number"),
    yellow: token("--type-object-id"),
    cyan: token("--type-date"),
    magenta: token("--type-boolean"),
    red: token("--destructive"),
    brightBlack: token("--muted-foreground"),
  };
}

/** One mongosh session rendered with xterm.js, with credit-based flow control. */
export function TerminalView({ connectionId }: { connectionId: ConnectionId }) {
  const { t } = useTranslation("shell");
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const fontSize = useSettings((s) => s.shellFontSize);
  const scrollback = useSettings((s) => s.shellScrollback);
  const [state, setState] = useState<SessionState>({ status: "starting" });
  const [generation, setGeneration] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` restarts the session on demand.
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontFamily: "monospace",
      fontSize: useSettings.getState().shellFontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: useSettings.getState().shellScrollback,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    fitAddon.current = fit;
    term.open(host.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL (some Linux drivers): xterm.js keeps its DOM renderer.
    }
    fit.fit();
    term.focus();
    terminal.current = term;

    let sessionId: string | null = null;
    let disposed = false;
    let pendingAck = 0;

    // xterm.js draws on a canvas, which cannot resolve CSS variables, and measures glyphs
    // once: switch to the design font only after it has loaded.
    const fontFamily = getComputedStyle(host.current).fontFamily;
    document.fonts.load(`${term.options.fontSize ?? 13}px ${fontFamily}`).then(() => {
      if (disposed) return;
      term.options.fontFamily = fontFamily;
      fit.fit();
    });

    const flushAck = () => {
      if (sessionId && pendingAck > 0) void commands.shellAck(sessionId, pendingAck);
      pendingAck = 0;
    };
    const ackTimer = setInterval(flushAck, ACK_INTERVAL_MS);

    const channel = new Channel<ShellEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "output") {
        const bytes = event.bytes ?? 0;
        // Acknowledge only once xterm.js has parsed the chunk.
        term.write(event.data, () => {
          pendingAck += bytes;
        });
      } else {
        flushAck();
        setState({ status: "exited", code: event.code ?? null });
      }
    };

    // IPC calls may complete out of order: one write in flight at a time keeps keystrokes
    // ordered, and input typed meanwhile is coalesced into the next write.
    let unsent = "";
    let writing = false;
    const sendInput = async () => {
      writing = true;
      while (sessionId && unsent && !disposed) {
        const data = unsent;
        unsent = "";
        await commands.shellWrite(sessionId, data);
      }
      writing = false;
    };
    const input = term.onData((data) => {
      if (!sessionId) return;
      unsent += data;
      if (!writing) void sendInput();
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (sessionId) void commands.shellResize(sessionId, cols, rows);
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);

    setState({ status: "starting" });
    call(commands.openShell(connectionId, term.cols, term.rows, channel))
      .then((id) => {
        if (disposed) {
          void commands.closeShell(id);
          return;
        }
        sessionId = id;
        setState({ status: "running" });
      })
      .catch((error: unknown) => setState({ status: "failed", error: errorMessage(error) }));

    return () => {
      disposed = true;
      clearInterval(ackTimer);
      observer.disconnect();
      input.dispose();
      resize.dispose();
      if (sessionId) void commands.closeShell(sessionId);
      term.dispose();
      terminal.current = null;
    };
  }, [connectionId, generation]);

  // Follow theme and accent switches without restarting the session.
  const accent = useSettings((s) => s.accent);
  const darkStyle = useSettings((s) => s.darkStyle);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read tokens when the theme changes.
  useEffect(() => {
    // The app applies the new tokens in its own effect, which runs after this one.
    const frame = requestAnimationFrame(() => {
      if (terminal.current) terminal.current.options.theme = terminalTheme();
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, accent, darkStyle]);

  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    terminal.current.options.scrollback = scrollback;
    fitAddon.current?.fit();
  }, [fontSize, scrollback]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(state.status === "exited" || state.status === "failed") && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-sidebar px-3 py-2 text-xs">
          <span
            className={
              state.status === "failed"
                ? "flex items-center gap-1.5 text-destructive selectable"
                : "text-muted-foreground"
            }
          >
            {state.status === "failed" && <CircleAlert className="size-3.5" />}
            {state.status === "failed"
              ? t("status.failed", { message: state.error })
              : state.code === null || state.code === 0
                ? t("status.exited")
                : t("status.exitedWithCode", { code: state.code })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => setGeneration((g) => g + 1)}
          >
            <RotateCw />
            {t("status.restart")}
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-background p-2">
        <div ref={host} className="h-full font-mono" />
        {state.status === "starting" && (
          <p className="pointer-events-none absolute top-3 left-4 text-muted-foreground text-xs">
            {t("status.starting")}
          </p>
        )}
      </div>
    </div>
  );
}
