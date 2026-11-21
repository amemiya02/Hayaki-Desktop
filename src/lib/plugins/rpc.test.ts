// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create, type Message } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { CardSchema } from "../anki/proto/anki/cards_pb";
import { BackendError_Kind, BackendErrorSchema } from "../anki/proto/anki/backend_pb";
import { CoreError } from "../anki/transport";
import { MAX_IN_FLIGHT, PluginRouter, type DispatchDeps, type FrameBinding, type HostMethod } from "./rpc";
import type { Permission } from "./types";

function setup(permissions: Permission[], host: Record<string, HostMethod> = {}) {
  const callCore = vi.fn<DispatchDeps["callCore"]>(async (_method, schemas) => create(schemas.output) as Message);
  const router = new PluginRouter({ callCore, host });
  const posted: unknown[] = [];
  const frame = { postMessage: (message: unknown) => posted.push(message) };
  const binding: FrameBinding = {
    target: frame,
    plugin: { id: "com.example.test", name: "Test", permissions: new Set(permissions) },
    frame: { kind: "main" },
  };
  router.attach(frame, binding);
  const send = async (method: string, params?: unknown) => {
    await router.receive({ source: frame, data: { type: "call", id: 7, method, params } });
    return posted.pop() as { id: number; result?: unknown; error?: { code: string; message: string; kind?: string } };
  };
  return { router, callCore, frame, posted, send };
}

describe("the plugin bridge", () => {
  it("round-trips protobuf JSON through a read method", async () => {
    const { callCore, send } = setup(["collection:read"]);
    callCore.mockResolvedValueOnce(
      create(CardSchema, { id: 1700000000123n, noteId: 42n, deckId: 1n, templateIdx: 2, flags: 3 }) as Message,
    );
    const reply = await send("core.getCard", { cid: "1700000000123" });
    expect(reply.error).toBeUndefined();
    const [method, , input] = callCore.mock.calls[0];
    expect(method).toBe("getCard");
    expect((input as unknown as { cid: bigint }).cid).toBe(1700000000123n);
    // int64 comes back as strings, and default values are present.
    expect(reply.result).toMatchObject({ id: "1700000000123", noteId: "42", templateIdx: 2, flags: 3, reps: 0 });
  });

  it("refuses calls outside the plugin's grants", async () => {
    const { callCore, send } = setup(["collection:read"]);
    expect((await send("core.answerCard", {})).error?.code).toBe("permission-denied");
    expect((await send("core.syncCollection", {})).error?.code).toBe("permission-denied");
    expect((await send("ui.toast", { message: "hi" })).error?.code).toBe("unknown-method");
    expect(callCore).not.toHaveBeenCalled();

    const none = setup([]);
    expect((await none.send("core.getCard", { cid: "1" })).error?.code).toBe("permission-denied");
  });

  it("lets collection:write read as well", async () => {
    const { send } = setup(["collection:write"]);
    expect((await send("core.getCard", { cid: "1" })).error).toBeUndefined();
  });

  it("answers unknown methods and bad params with errors", async () => {
    const { send } = setup(["collection:write"]);
    expect((await send("core.notAMethod", {})).error?.code).toBe("unknown-method");
    expect((await send("core.__proto__", {})).error?.code).toBe("unknown-method");
    expect((await send("nothing.here", {})).error?.code).toBe("unknown-method");
    expect((await send("core.getCard", { cid: "1", extra: true })).error?.code).toBe("invalid-params");
  });

  it("reports core errors with their kind", async () => {
    const { callCore, send } = setup(["collection:read"]);
    callCore.mockRejectedValueOnce(
      new CoreError(create(BackendErrorSchema, { kind: BackendError_Kind.NOT_FOUND_ERROR, message: "no such card" })),
    );
    expect((await send("core.getCard", { cid: "9" })).error).toEqual({
      code: "core-error",
      message: "no such card",
      kind: "NOT_FOUND_ERROR",
    });
  });

  it("checks host methods' permissions", async () => {
    const run = vi.fn(() => "ok");
    const { send } = setup(["reviewer"], {
      "ui.toast": { permission: "ui", run },
      "storage.get": { permission: null, run },
    });
    expect((await send("ui.toast", {})).error?.code).toBe("permission-denied");
    expect((await send("storage.get", { key: "a" })).result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores messages from windows it did not attach, and malformed calls", async () => {
    const { router, callCore, posted, frame } = setup(["collection:read"]);
    const stranger = { postMessage: vi.fn() };
    await router.receive({ source: stranger, data: { type: "call", id: 1, method: "core.getCard", params: { cid: "1" } } });
    await router.receive({ source: null, data: { type: "call", id: 1, method: "core.getCard", params: { cid: "1" } } });
    await router.receive({ source: frame, data: { type: "call", method: "core.getCard" } });
    await router.receive({ source: frame, data: "core.getCard" });
    expect(callCore).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
    expect(stranger.postMessage).not.toHaveBeenCalled();
  });

  it("drops the answer when the frame went away during the call", async () => {
    const { router, posted, frame } = setup(["collection:read"]);
    const pending = router.receive({ source: frame, data: { type: "call", id: 1, method: "core.getCard", params: { cid: "1" } } });
    router.attach(frame, { ...router.bindingOf(frame)! })();
    await pending;
    expect(posted).toEqual([]);
  });

  it("sends events only to the frames chosen", () => {
    const { router, posted } = setup(["reviewer"]);
    router.emit("reviewer.answered", { cardId: "1" }, (b) => b.plugin.permissions.has("ui"));
    expect(posted).toEqual([]);
    router.emit("reviewer.answered", { cardId: "1" }, (b) => b.plugin.permissions.has("reviewer"));
    expect(posted).toEqual([{ type: "event", name: "reviewer.answered", payload: { cardId: "1" } }]);
  });

  it("refuses calls past the in-flight limit and accepts them again once answered", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { router, frame, posted } = setup([], { "test.wait": { permission: null, run: () => gate } });
    const call = (id: number) => router.receive({ source: frame, data: { type: "call", id, method: "test.wait" } });
    const waiting = Array.from({ length: MAX_IN_FLIGHT }, (_, i) => call(i));
    await call(999);
    expect(posted).toEqual([expect.objectContaining({ id: 999, error: expect.objectContaining({ code: "busy" }) })]);
    release();
    await Promise.all(waiting);
    expect(posted).toHaveLength(MAX_IN_FLIGHT + 1);
    posted.length = 0;
    await call(1000);
    expect(posted).toEqual([expect.objectContaining({ id: 1000, result: null })]);
  });
});
