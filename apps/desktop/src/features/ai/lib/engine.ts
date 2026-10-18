import type { EngineChoice, FieldHint, FieldSummary } from "@odin-db/bindings";
import type { Settings } from "@/lib/settings";

type AiSettings = Pick<
  Settings,
  "aiEnabled" | "aiEngine" | "aiLocalModel" | "aiOllamaUrl" | "aiOllamaModel"
>;

/** The engine the settings point to, or `null` when the assistant is off or not set up. */
export function engineFrom(settings: AiSettings): EngineChoice | null {
  if (!settings.aiEnabled) return null;
  if (settings.aiEngine === "local") {
    return settings.aiLocalModel ? { kind: "local", model: settings.aiLocalModel } : null;
  }
  const url = settings.aiOllamaUrl.trim();
  return url && settings.aiOllamaModel
    ? { kind: "ollama", url, model: settings.aiOllamaModel }
    : null;
}

/** Paths and types only: sampled values never leave the app for a model. */
export function fieldHints(fields: readonly FieldSummary[]): FieldHint[] {
  return fields.map(({ path, types }) => ({ path, types }));
}
