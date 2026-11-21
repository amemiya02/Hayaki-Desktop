// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The one way into the Anki core. Each generated call in `generated/core.ts`
 * encodes its request, sends it with the core's service and method numbers
 * to the `core_call` command as raw bytes, and decodes the reply: one status
 * byte, then the response (0) or an `anki.backend.BackendError` (1).
 *
 * Responses that carry `anki.collection.OpChanges` are announced to
 * subscribers, so screens refresh after any change to the collection.
 */
import { create, fromBinary, toBinary, type DescMessage } from "@bufbuild/protobuf";
import { invoke } from "@tauri-apps/api/core";

import {
  BackendError_Kind,
  BackendErrorSchema,
  type BackendError,
} from "./proto/anki/backend_pb";
import type { OpChanges } from "./proto/anki/collection_pb";

export interface CallOptions {
  /** Do not announce the call's changes (for example while a screen applies them itself). */
  quiet?: boolean;
  /** Identifies the screen that made the change, so it can skip its own refresh. */
  origin?: string;
}

export class CoreError extends Error {
  readonly kind: BackendError_Kind;
  readonly backendError: BackendError;

  constructor(error: BackendError) {
    super(error.message);
    this.name = "CoreError";
    this.kind = error.kind;
    this.backendError = error;
  }

  get isInterrupted(): boolean {
    return this.kind === BackendError_Kind.INTERRUPTED;
  }
}

export interface ChangeEvent {
  changes: OpChanges;
  origin?: string;
}

type Listener = (event: ChangeEvent) => void;
const listeners = new Set<Listener>();

/** Subscribes to collection changes; returns the unsubscribe function. */
export function onCollectionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceChanges(changes: OpChanges, origin?: string): void {
  for (const listener of listeners) listener({ changes, origin });
}

/**
 * Finds the OpChanges inside a response. The generator reports how deeply it is
 * nested (`level`); the search looks no deeper than that.
 */
export function extractOpChanges(message: unknown, level: number): OpChanges | undefined {
  const value = message as { $typeName?: string } | undefined;
  if (!value || typeof value !== "object") return undefined;
  if (value.$typeName === "anki.collection.OpChanges") return value as unknown as OpChanges;
  if (level <= 1) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$typeName" || !child || typeof child !== "object" || !("$typeName" in child)) continue;
    const found = extractOpChanges(child, level - 1);
    if (found) return found;
  }
  return undefined;
}

export async function callRaw(service: number, method: number, input: Uint8Array): Promise<Uint8Array> {
  const reply = await invoke<ArrayBuffer>("core_call", input, {
    headers: { "x-service": String(service), "x-method": String(method) },
  });
  const bytes = new Uint8Array(reply);
  const payload = bytes.subarray(1);
  if (bytes[0] !== 0) {
    throw new CoreError(fromBinary(BackendErrorSchema, payload));
  }
  return payload;
}

export async function call<I extends DescMessage, O extends DescMessage>(
  service: number,
  method: number,
  inputSchema: I,
  input: unknown,
  outputSchema: O,
  opChangesLevel: number,
  options?: CallOptions,
): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request = create(inputSchema, input as any);
  const reply = await callRaw(service, method, toBinary(inputSchema, request));
  const output = fromBinary(outputSchema, reply);
  if (opChangesLevel > 0 && !options?.quiet) {
    const changes = extractOpChanges(output, opChangesLevel);
    if (changes) announceChanges(changes, options?.origin);
  }
  return output;
}
