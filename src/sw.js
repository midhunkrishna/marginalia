// sw.js — Chrome MV3 service-worker entry. Chrome doesn't support Firefox's
// `background.scripts` array, so this classic worker pulls in the same background
// modules in the same order via importScripts(). Firefox keeps using
// `background.scripts` (see manifest.json); Chrome uses this file (see
// manifest.chrome.json). Paths are extension-root absolute so they resolve
// regardless of where the worker lives. This list MUST match the
// `background.scripts` array in manifest.json — tests/build/wiring.test.js
// enforces it.
importScripts(
  "/src/shared/browser-polyfill.js",
  "/src/shared/protocol.js",
  "/src/shared/hosts.js",
  "/src/shared/settings-schema.js",
  "/src/shared/config.js",
  "/src/core/sites.js",
  "/src/shared/sse.js",
  "/src/shared/stream-delta.js",
  "/src/background/api-util.js",
  "/src/background/api-client-factory.js",
  "/src/gemini/parser.js",
  "/src/gemini/payload.js",
  "/src/gemini/client.js",
  "/src/claude/parser.js",
  "/src/claude/payload.js",
  "/src/claude/client.js",
  "/src/openai/parser.js",
  "/src/openai/payload.js",
  "/src/openai/client.js",
  "/src/googleai/parser.js",
  "/src/googleai/payload.js",
  "/src/googleai/client.js",
  "/src/anthropic/parser.js",
  "/src/anthropic/payload.js",
  "/src/anthropic/client.js",
  "/src/openrouter/payload.js",
  "/src/openrouter/client.js",
  "/src/core/html-text.js",
  "/src/core/research.js",
  "/src/search/brave.js",
  "/src/search/ddg.js",
  "/src/search/engines.js",
  "/src/openai/tools.js",
  "/src/openrouter/tools.js",
  "/src/anthropic/tools.js",
  "/src/googleai/tools.js",
  "/src/background/registry.js",
  "/src/background/clients.js",
  "/src/background/key-test.js",
  "/src/background/research-tools.js",
  "/src/background/research-loop.js",
  "/src/background/research.js",
  "/src/background/injection-guard.js",
  "/src/background.js",
);
