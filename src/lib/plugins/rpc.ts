// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The plugin bridge (ADR 0004). A plugin's frames post
 * `{ type: "call", id, method, params }`; the host answers
 * `{ type: "result", id, result }` or `{ type: "result", id, error }`, and
 * sends `{ type: "event", name, payload }`.
 *
 * A message is accepted only from a window the router attached, and its
 * plugin is the one that window was attached for, never what the message
 * says. `core.<method>` calls take protobuf JSON, are checked against the
 * permission table, and return protobuf JSON. Other methods are the host's,
 * each with the permission it needs.
 */
import { fromJson, toJson, type DescMessage, type JsonValue, type Message } from "@bufbuild/protobuf";

import { BackendError_Kind } from "../anki/proto/anki/backend_pb";
import { CoreError } from "../anki/transport";
import { coreAccess, type CoreMethod } from "./permissions";
import { methodSchemas, type MethodSchemas } from "./schemas";
import type { Permission, PluginContext } from "./types";

export type ErrorCode =
  | "permission-denied"
  | "unknown-method"
  | "invalid-params"
  | "core-error"
  | "storage-full"
  | "busy"
  | "failed";

export interface RpcErrorBody {
  code: ErrorCode;
  message: string;
  /** For `core-error`: the core's error kind, such as `NOT_FOUND_ERROR`. */
  kind?: string;
}

export type CallMessage = { type: "call"; id: number | string; method: string; params: unknown };
export type ResultMessage =
  | { type: "result"; id: number | string; result: unknown }
  | { type: "result"; id: number | string; error: RpcErrorBody };
export type EventMessage = { type: "event"; name: string; payload: unknown };

/** Thrown by host methods to answer with a specific error code. */
export class RpcFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export type FrameKind = { kind: "main" } | { kind: "panel"; panelId: string };

export interface FrameBinding {
  target: MessageTarget;
  plugin: PluginContext;
  frame: FrameKind;
}

export interface HostMethod {
  /** The permission the call needs, or null when every plugin may call it. */
  permission: Permission | null;
  run(frame: FrameBinding, params: unknown): unknown;
}

export interface DispatchDeps {
  callCore(method: CoreMethod, schemas: MethodSchemas, input: Message): Promise<Message>;
  host: Readonly<Record<string, HostMethod>>;
}

export function parseCall(data: unknown): CallMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, id, method, params } = data as Record<string, unknown>;
  if (type !== "call" || typeof method !== "string" || method.length > 128) return null;
  if (!(typeof id === "number" && Number.isFinite(id)) && !(typeof id === "string" && id.length <= 64)) return null;
  return { type, id, method, params: params ?? {} };
}

function grants(plugin: PluginContext, permission: Permission): boolean {
  if (permission === "collection:read") {
    return plugin.permissions.has("collection:read") || plugin.permissions.has("collection:write");
  }
  return plugin.permissions.has(permission);
}

function failure(code: ErrorCode, message: string, kind?: string): RpcErrorBody {
  return kind ? { code, message, kind } : { code, message };
}

async function callCore(plugin: PluginContext, name: string, params: unknown, deps: DispatchDeps): Promise<unknown> {
  const access = coreAccess(name);
  const schemas = methodSchemas(name);
  if (access === "deny" || !schemas) {
    throw new RpcFailure(schemas ? "permission-denied" : "unknown-method", `core.${name} is not available to plugins`);
  }
  const needed: Permission = access === "write" ? "collection:write" : "collection:read";
  if (!grants(plugin, needed)) throw new RpcFailure("permission-denied", `core.${name} needs the ${needed} permission`);
  let input: Message;
  try {
    input = fromJson(schemas.input as DescMessage, params as JsonValue);
  } catch (error) {
    throw new RpcFailure("invalid-params", error instanceof Error ? error.message : String(error));
  }
  const output = await deps.callCore(name as CoreMethod, schemas, input);
  return toJson(schemas.output as DescMessage, output as never, { alwaysEmitImplicit: true });
}

/** Answers one call from a frame. Never throws: every failure becomes an error result. */
export async function dispatch(frame: FrameBinding, call: CallMessage, deps: DispatchDeps): Promise<ResultMessage> {
  const { id, method, params } = call;
  try {
    let result: unknown;
    if (method.startsWith("core.")) {
      result = await callCore(frame.plugin, method.slice(5), params, deps);
    } else {
      const host = Object.hasOwn(deps.host, method) ? deps.host[method] : undefined;
      if (!host) throw new RpcFailure("unknown-method", `${method} is not a Hayaki plugin method`);
      if (host.permission && !grants(frame.plugin, host.permission)) {
        throw new RpcFailure("permission-denied", `${method} needs the ${host.permission} permission`);
      }
      result = await host.run(frame, params);
    }
    return { type: "result", id, result: result ?? null };
  } catch (error) {
    if (error instanceof RpcFailure) return { type: "result", id, error: failure(error.code, error.message) };
    if (error instanceof CoreError) {
      return { type: "result", id, error: failure("core-error", error.message, BackendError_Kind[error.kind]) };
    }
    return { type: "result", id, error: failure("failed", error instanceof Error ? error.message : String(error)) };
  }
}

/** Calls a frame may have unanswered at once; more are refused with `busy`. */
export const MAX_IN_FLIGHT = 32;

/**
 * Tracks the frames of running plugins, routes their calls, and sends them
 * events. Messages from any other window are ignored.
 */
export class PluginRouter {
  private readonly frames = new Map<unknown, FrameBinding>();
  private readonly inFlight = new Map<FrameBinding, number>();

  constructor(private readonly deps: DispatchDeps) {}

  /** Starts accepting calls from `source`; returns the function that stops it. */
  attach(source: unknown, binding: FrameBinding): () => void {
    this.frames.set(source, binding);
    return () => {
      if (this.frames.get(source) === binding) this.frames.delete(source);
    };
  }

  bindingOf(source: unknown): FrameBinding | undefined {
    return this.frames.get(source);
  }

  async receive(event: { source: unknown; data: unknown }): Promise<void> {
    const binding = this.frames.get(event.source);
    if (!binding) return;
    const call = parseCall(event.data);
    if (!call) return;
    const count = this.inFlight.get(binding) ?? 0;
    if (count >= MAX_IN_FLIGHT) {
      const message = `more than ${MAX_IN_FLIGHT} calls are waiting for an answer; wait for some to finish`;
      binding.target.postMessage({ type: "result", id: call.id, error: failure("busy", message) } satisfies ResultMessage, "*");
      return;
    }
    this.inFlight.set(binding, count + 1);
    let reply: ResultMessage;
    try {
      reply = await dispatch(binding, call, this.deps);
    } finally {
      const left = (this.inFlight.get(binding) ?? 1) - 1;
      if (left > 0) this.inFlight.set(binding, left);
      else this.inFlight.delete(binding);
    }
    // A frame removed while the call ran gets no answer.
    if (this.frames.get(event.source) === binding) binding.target.postMessage(reply, "*");
  }

  /** Sends an event to every frame for which `to` returns true. */
  emit(name: string, payload: unknown, to: (binding: FrameBinding) => boolean): void {
    const message: EventMessage = { type: "event", name, payload };
    for (const binding of this.frames.values()) {
      if (to(binding)) binding.target.postMessage(message, "*");
    }
  }
}
