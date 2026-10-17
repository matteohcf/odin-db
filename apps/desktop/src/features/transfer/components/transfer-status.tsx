import type { TransferProgress } from "@odin-db/bindings";
import { CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { TransferState } from "../hooks/use-transfer";

interface TransferStatusProps<S, P> {
  state: TransferState<S, P>;
  runningTitle: string;
  running: (progress: P | null) => string;
  finished: (summary: S) => ReactNode;
  cancelledText: string;
  failedText: (message: string) => string;
}

/** Progress and outcome of a transfer; shared by import and export dialogs. */
export function TransferStatus<S, P = TransferProgress>({
  state,
  runningTitle,
  running,
  finished,
  cancelledText,
  failedText,
}: TransferStatusProps<S, P>) {
  switch (state.status) {
    case "idle":
      return null;
    case "running":
      return (
        <div className="flex items-center gap-3 rounded-md border p-4" role="status">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">{runningTitle}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {running(state.progress)}
            </span>
          </div>
        </div>
      );
    case "finished":
      return <div className="flex flex-col gap-2 text-sm">{finished(state.summary)}</div>;
    case "cancelled":
      return <p className="text-muted-foreground text-sm">{cancelledText}</p>;
    case "failed":
      return (
        <p role="alert" className="flex items-start gap-2 text-destructive text-sm selectable">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {failedText(state.error)}
        </p>
      );
  }
}
