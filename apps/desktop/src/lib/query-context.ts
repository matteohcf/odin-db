/** Where the cursor sits inside a mongosh query document, for autocompletion. */
export type QueryContext =
  | {
      kind: "key";
      /** Keys of the enclosing documents and arrays, outermost first. */
      path: string[];
      prefix: string;
      /** Offset where `prefix` starts. */
      from: number;
      /** The key is being typed inside quotes. */
      quoted: boolean;
    }
  | {
      kind: "value";
      /** The key whose value is being typed (for arrays, the array's key). */
      key: string | null;
      path: string[];
      prefix: string;
      from: number;
    };

interface Frame {
  type: "object" | "array";
  /** The key this document or array is the value of. */
  parentKey: string | null;
  /** Objects only: the key whose value comes next, once its colon is typed. */
  key: string | null;
  expectingKey: boolean;
}

const WORD = /[\w$.]/;

/**
 * Scans `text` up to `pos` like a tolerant tokenizer: it tracks nesting, keys and
 * strings without requiring the rest of the document to be valid. An unbraced
 * query (`status: "a"`) is read as the body of a document.
 */
export function queryContext(text: string, pos: number): QueryContext | null {
  const before = text.slice(0, pos);
  const stack: Frame[] = [];
  if (!before.trimStart().startsWith("{")) stack.push(objectFrame(null));

  let quote: string | null = null;
  let stringStart = 0;
  let token = "";

  for (let i = 0; i < before.length; i++) {
    const char = before[i] as string;
    const frame = stack.at(-1);

    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) {
        quote = null;
        token = before.slice(stringStart + 1, i);
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      stringStart = i;
      continue;
    }
    if (WORD.test(char)) {
      token = WORD.test(before[i - 1] ?? "") ? token + char : char;
      continue;
    }
    switch (char) {
      case "{":
      case "[": {
        // Items of an array are under the array's key already.
        const parentKey = frame?.type === "object" ? frame.key : null;
        stack.push(char === "{" ? objectFrame(parentKey) : arrayFrame(parentKey));
        break;
      }
      case "}":
      case "]":
        stack.pop();
        break;
      case ":":
        if (frame?.type === "object" && frame.expectingKey) {
          frame.key = token;
          frame.expectingKey = false;
        }
        break;
      case ",":
        if (frame?.type === "object") {
          frame.key = null;
          frame.expectingKey = true;
        }
        break;
    }
    if (!/\s/.test(char)) token = "";
  }

  const frame = stack.at(-1);
  if (!frame) return null;
  const path = stack.map((f) => f.parentKey).filter((key): key is string => key !== null);

  if (quote) {
    // Completing inside a string only makes sense for a quoted key.
    if (frame.type !== "object" || !frame.expectingKey) return null;
    const prefix = before.slice(stringStart + 1);
    return { kind: "key", path, prefix, from: stringStart + 1, quoted: true };
  }

  const prefix = /[\w$.]*$/.exec(before)?.[0] ?? "";
  const from = pos - prefix.length;
  if (frame.type === "object" && frame.expectingKey) {
    return { kind: "key", path, prefix, from, quoted: false };
  }
  return { kind: "value", key: keyOf(frame), path, prefix, from };
}

function objectFrame(parentKey: string | null): Frame {
  return { type: "object", parentKey, key: null, expectingKey: true };
}

function arrayFrame(parentKey: string | null): Frame {
  return { type: "array", parentKey, key: null, expectingKey: false };
}

function keyOf(frame: Frame): string | null {
  return frame.type === "object" ? frame.key : frame.parentKey;
}
