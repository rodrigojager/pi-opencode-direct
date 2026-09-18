// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// pi's extension loader aliases the pi-ai root to the /compat entrypoint and
// only whitelists exact subpaths (/compat, /oauth, /providers/all), so deeper
// subpath imports like .../api/openai-completions fail to resolve at load time.
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai/compat";
import { discoverModels, type OpenCodeModelInfo } from "./discovery.js";

const nativeOpenAICompletionsStream = openAICompletionsApi().streamSimple;
const nativeOpenAIResponsesStream = openAIResponsesApi().streamSimple;

const PROVIDER_ID = "opencode-direct";
const BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_NATIVE_TOOLS = [
  "bash", "edit", "glob", "grep", "read", "skill", "task", "todowrite", "webfetch", "websearch", "write",
] as const;

function nativeId(prefix: "ses" | "msg") {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
}

/**
 * Zen currently recognizes the official client by both headers and the core
 * OpenCode tool declarations. Keep Pi's real tools and add harmless schemas
 * only for missing native names. Calls to names unavailable in Pi are rejected
 * by Pi's normal tool allowlist; no OpenCode process or native tool executes.
 */
function preserveNativeRequestShape(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as { tools?: unknown[]; input?: unknown };
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  const names = new Set(tools.map((tool) => {
    if (!tool || typeof tool !== "object") return undefined;
    const value = tool as { name?: unknown; function?: { name?: unknown } };
    return typeof value.name === "string" ? value.name : typeof value.function?.name === "string" ? value.function.name : undefined;
  }).filter((name): name is string => !!name));
  const responsesApi = "input" in body;
  for (const name of OPENCODE_NATIVE_TOOLS) {
    if (names.has(name)) continue;
    const definition = { name, description: `OpenCode-compatible ${name} tool`, parameters: { type: "object", properties: {}, additionalProperties: true } };
    tools.push(responsesApi ? { type: "function", ...definition, strict: false } : { type: "function", function: definition });
  }
  return { ...body, tools, tool_choice: (body as { tool_choice?: unknown }).tool_choice ?? "auto" };
}

// Describes Zen's upstream quirks to Pi's native openai-completions engine
// (max_tokens field name, reasoning_content replay) — no custom streaming code.
const OPENCODE_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  // Zen often ends streams without finish_reason; let pi infer stop/toolUse
  // instead of throwing "Stream ended without finish_reason".
  supportsFinishReason: false,
  maxTokensField: "max_tokens" as const,
  requiresReasoningContentOnAssistantMessages: true,
};

/** Maps a discovered model to the provider config shape. */
function toProviderModel(m: OpenCodeModelInfo) {
  return {
    id: m.id.replace(/^opencode\//, ""),
    name: m.name,
    // Per-model API override: models routed via @ai-sdk/openai speak the
    // Responses API (e.g. muse-spark), everything else uses chat completions.
    api: m.api ?? "openai-completions",
    reasoning: m.reasoning ?? false,
    thinkingLevelMap: m.thinkingLevelMap,
    input: (m.input?.includes("image") ? ["text", "image"] : ["text"]) as ("text" | "image")[],
    contextWindow: m.contextWindow ?? 128_000,
    maxTokens: m.maxTokens ?? 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: OPENCODE_COMPAT,
  };
}

function toStoredModel(config: ReturnType<typeof toProviderModel>) {
  return { ...config, provider: PROVIDER_ID, baseUrl: BASE_URL };
}

function fromStoredModel<M extends { provider?: unknown; baseUrl?: unknown }>(m: M) {
  const { provider: _provider, baseUrl: _baseUrl, ...config } = m;
  return config as unknown as ReturnType<typeof toProviderModel>;
}

export default function opencodeDirectExtension(pi: ExtensionAPI): void {
  // Registered once with an empty list; models come exclusively through
  // refreshModels (snapshot restore on session init, live discovery on
  // explicit refresh) — pi's native model lifecycle.
  pi.registerProvider(PROVIDER_ID, {
    name: "OpenCode Direct HTTP (Free)",
    baseUrl: BASE_URL,
    // Placeholder: Pi's auth composition requires a key; real requests go
    // keyless via the streamSimple shim below.
    apiKey: "none",
    api: "openai-completions",
    headers: {
      "x-opencode-client": "cli",
      "x-opencode-project": "global",
      "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
      // Authorization is suppressed per request in streamSimple. A null value
      // cannot live in provider config because Pi resolves config headers while
      // refreshing catalogs and expects every configured value to be a string.
    },
    models: [],
    async refreshModels(ctx) {
      if (!ctx.allowNetwork) {
        return ctx.stored?.models
          .filter(m => m.provider === PROVIDER_ID && (m.api === "openai-completions" || m.api === "openai-responses"))
          .map(fromStoredModel) ?? [];
      }
      if (ctx.signal.aborted) return [];
      const discovered = await discoverModels({ signal: ctx.signal });
      if (discovered.length === 0) return []; // keep previous snapshot; retry on next refresh
      const configs = discovered.map(toProviderModel);
      await ctx.publish({ persist: { models: configs.map(toStoredModel), checkedAt: Date.now() } });
      return configs;
    },
    // Keyless shim over pi's native engines, dispatched by model API:
    // Zen's free tier rejects every Bearer token with 401, and
    // `Authorization: null` is the OpenAI SDK's supported omission.
    // Streaming, tools, reasoning, and cost handling stay fully native.
    streamSimple: (model, context, options) => {
      const api = (model as { api?: string }).api;
      const native =
        api === "openai-responses"
          ? (nativeOpenAIResponsesStream as typeof nativeOpenAICompletionsStream)
          : nativeOpenAICompletionsStream;
      const sessionId = nativeId("ses");
      return native(model as Parameters<typeof nativeOpenAICompletionsStream>[0], context, {
        ...options,
        headers: {
          ...options?.headers,
          Authorization: null,
          "User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
          "x-opencode-client": "cli",
          "x-opencode-project": "global",
          "x-opencode-session": sessionId,
          "x-opencode-request": nativeId("msg"),
        },
        onPayload: async (payload, requestModel) => {
          const transformed = await options?.onPayload?.(payload, requestModel);
          return preserveNativeRequestShape(transformed ?? payload);
        },
      });
    },
  });
}
