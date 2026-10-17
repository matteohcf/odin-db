import { commands, type IpcError, type OperationId, type StreamEvent } from "@odin-db/bindings";
import { Channel } from "@tauri-apps/api/core";

type StreamOutcome =
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "failed"; error: IpcError };

export interface StreamHandle {
  id: OperationId;
  done: Promise<StreamOutcome>;
  cancel: () => Promise<boolean>;
}

/**
 * Starts a long-running backend operation (ADR-0006): data events go to `onData`,
 * the single terminal event resolves `done`.
 */
export async function startStream<T>(
  start: (channel: Channel<StreamEvent<T>>) => Promise<OperationId>,
  onData: (data: T) => void,
): Promise<StreamHandle> {
  let settle: (outcome: StreamOutcome) => void = () => {};
  const done = new Promise<StreamOutcome>((resolve) => {
    settle = resolve;
  });

  const channel = new Channel<StreamEvent<T>>();
  channel.onmessage = (message) => {
    switch (message.event) {
      case "data":
        onData(message.data);
        break;
      case "completed":
        settle({ status: "completed" });
        break;
      case "cancelled":
        settle({ status: "cancelled" });
        break;
      case "failed":
        settle({ status: "failed", error: message.data });
        break;
    }
  };

  const id = await start(channel);
  return { id, done, cancel: () => commands.cancelOperation(id) };
}
