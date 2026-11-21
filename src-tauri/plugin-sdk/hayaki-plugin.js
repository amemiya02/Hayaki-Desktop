// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The Hayaki plugin SDK, served at /_sdk/hayaki-plugin.js. It wraps the
// postMessage JSON-RPC bridge to the interface (docs/plugins.md) as
// `window.hayaki`, loads the design tokens, and follows the app's appearance.
(function () {
  "use strict";
  if (window.hayaki) return;

  var host = window.parent;
  var pending = new Map();
  var listeners = new Map();
  var commands = new Map();
  var nextId = 1;
  var failed = false;
  var TIMEOUT_MS = 60000;

  function HayakiError(code, message) {
    var error = new Error(message || code);
    error.name = "HayakiError";
    error.code = code;
    return error;
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(HayakiError("timeout", method + " did not answer in time"));
      }, TIMEOUT_MS);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      host.postMessage({ type: "call", id: id, method: method, params: params === undefined ? {} : params }, "*");
    });
  }

  function emit(name, payload) {
    var set = listeners.get(name);
    if (!set) return;
    set.forEach(function (handler) {
      try {
        handler(payload);
      } catch (error) {
        console.error(error);
      }
    });
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    root.classList.toggle("dark", !!theme.dark);
    if (theme.theme) root.dataset.theme = theme.theme;
    if (theme.appearance) root.dataset.appearance = theme.appearance;
    if (theme.lang) root.lang = theme.lang;
    if (theme.dir) root.dir = theme.dir;
  }

  window.addEventListener("message", function (event) {
    if (event.source !== host) return;
    var message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "result") {
      var entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(HayakiError(message.error.code, message.error.message));
      else entry.resolve(message.result);
    } else if (message.type === "event" && typeof message.name === "string") {
      if (message.name === "app.theme") applyTheme(message.payload || {});
      if (message.name === "command.invoked" && message.payload) {
        var handler = commands.get(message.payload.id);
        if (handler) {
          try {
            handler(message.payload);
          } catch (error) {
            console.error(error);
          }
        }
      }
      emit(message.name, message.payload);
    }
  });

  // Errors while the plugin loads mark it failed, so Hayaki does not retry it.
  function onLoadError(event) {
    if (failed || loaded) return;
    failed = true;
    var detail = event && event.error && event.error.stack ? event.error.stack : "";
    var message = event && event.message ? event.message : "";
    // Scripts from the plugin's folder are cross-origin to its opaque page, so the browser hides their errors.
    if (message === "Script error." || message === "Script error") message = "The plugin's script threw an error while loading. The Web Inspector shows the details.";
    if (!message && event && event.target && event.target.src) message = "Could not load " + event.target.src;
    if (!message && event && event.reason) message = String(event.reason && event.reason.message || event.reason);
    call("plugin.error", { message: message || "The plugin failed to load", detail: detail }).catch(function () {});
  }
  var loaded = false;
  window.addEventListener("error", onLoadError, true);
  window.addEventListener("unhandledrejection", onLoadError);
  window.addEventListener("load", function () {
    if (failed) return;
    loaded = true;
    call("plugin.ready", {}).catch(function () {});
  });

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/_sdk/tokens.css";
  (document.head || document.documentElement).prepend(link);

  var core = new Proxy(
    {},
    {
      get: function (_, name) {
        if (typeof name !== "string" || name === "then") return undefined;
        return function (params) {
          return call("core." + name, params);
        };
      },
    },
  );

  var hayaki = {
    call: call,
    core: core,
    on: function (name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return function () {
        listeners.get(name).delete(handler);
      };
    },
    ui: Object.freeze({
      registerCommand: function (command, handler) {
        if (handler) commands.set(command.id, handler);
        return call("ui.registerCommand", command);
      },
      unregisterCommand: function (id) {
        commands.delete(id);
        return call("ui.unregisterCommand", { id: id });
      },
      toast: function (message, kind) {
        return call("ui.toast", { message: message, kind: kind || "info" });
      },
      navigate: function (target) {
        return call("ui.navigate", target);
      },
    }),
    storage: Object.freeze({
      get: function (key) {
        return call("storage.get", { key: key });
      },
      set: function (key, value) {
        return call("storage.set", { key: key, value: value });
      },
      remove: function (key) {
        return call("storage.set", { key: key, value: null });
      },
    }),
    reviewer: Object.freeze({
      injectCss: function (css) {
        return call("reviewer.injectCss", { css: css });
      },
      injectHtml: function (html) {
        return call("reviewer.injectHtml", { html: html });
      },
    }),
  };
  Object.defineProperty(window, "hayaki", { value: Object.freeze(hayaki) });
})();
