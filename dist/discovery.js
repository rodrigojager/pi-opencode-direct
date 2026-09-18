// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Discovery of free OpenCode Zen models.
 *
 * Free-tier ids come live from the Zen REST API (`/zen/v1/models`). Display
 * names, reasoning support, and limits come from the models.dev catalog;
 * anything unknown defaults to non-reasoning with conservative limits.
 * Every failure mode yields an empty list (no offline catalog).
 */
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const FREE_REGEX = /(^(opencode\/)?.*-free$)|(^(opencode\/)?big-pickle$)/i;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function baseModelId(id) {
    return id.startsWith("opencode/") ? id.slice("opencode/".length).replace(/-free$/, "") : id.replace(/-free$/, "");
}
function humanizeName(id) {
    const base = id.replace(/-free$/, "").replace(/[_-]+/g, " ");
    return base
        .split(" ")
        .map(word => (word.charAt(0).toUpperCase() + word.slice(1)))
        .join(" ") + " (Free)";
}
/**
 * Builds pi's `thinkingLevelMap` from `reasoning_options`. Models without
 * explicit effort values get no map, deferring to the provider default.
 */
function buildThinkingLevelMap(meta) {
    if (!meta?.reasoning)
        return undefined;
    const options = meta.reasoning_options ?? [];
    const effort = options.find(o => o.type === "effort")?.values ?? [];
    const hasToggle = options.some(o => o.type === "toggle");
    if (effort.length === 0)
        return undefined;
    const map = {};
    for (const level of THINKING_LEVELS)
        map[level] = null;
    let sawNone = false;
    for (const value of effort) {
        if (value === "none") {
            map.off = "off";
            sawNone = true;
            continue;
        }
        if (value in map)
            map[value] = value;
    }
    if (hasToggle && !sawNone)
        map.off = "off";
    return map;
}
export function filterFreeModels(models, opts) {
    return models
        .filter((m) => typeof m?.id === "string" && m.id.length > 0 && (m.name === undefined || typeof m.name === "string"))
        .filter(m => FREE_REGEX.test(m.id))
        .map(m => {
        const base = baseModelId(m.id);
        const bare = m.id.startsWith("opencode/") ? m.id.slice("opencode/".length) : m.id;
        const meta = opts?.catalog?.[bare] ?? opts?.catalog?.[base];
        return {
            id: m.id.startsWith("opencode/") ? m.id : `opencode/${m.id}`,
            name: m.name ?? meta?.name ?? humanizeName(m.id),
            reasoning: meta?.reasoning ?? false,
            contextWindow: meta?.limit?.context ?? 128_000,
            maxTokens: meta?.limit?.output ?? 16_384,
            thinkingLevelMap: buildThinkingLevelMap(meta),
            input: meta?.input,
            api: meta?.provider?.npm === "@ai-sdk/openai" ? "openai-responses" : undefined,
        };
    });
}
/** Fetches models.dev catalog entries for the `opencode` provider; null on any failure. */
async function fetchModelsDevCatalog(fetcher, signal) {
    try {
        const res = await fetcher(MODELS_DEV_URL, { signal });
        if (!res.ok)
            return null;
        const cat = await res.json();
        const entries = cat?.opencode?.models;
        if (!entries)
            return null;
        const catalog = {};
        for (const [id, raw] of Object.entries(entries)) {
            const m = raw;
            catalog[id] = {
                name: m.name,
                reasoning: m.reasoning === true,
                reasoning_options: m.reasoning_options,
                limit: m.limit,
                input: m.modalities?.input,
                provider: m.provider,
            };
        }
        return Object.keys(catalog).length > 0 ? catalog : null;
    }
    catch {
        return null;
    }
}
export async function discoverModels(opts) {
    const fetcher = opts?.fetchFn ?? fetch;
    // Strict boot budget: return nothing rather than block extension load if
    // neither source answers in time.
    const timeoutMs = opts?.timeoutMs ?? 3000;
    try {
        // Combine the caller-provided signal (e.g. refreshModels cancellation)
        // with our own deadline so either one aborts discovery.
        const timeoutSignal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
        const signals = [timeoutSignal, opts?.signal].filter((s) => !!s);
        const signal = signals.length > 1 && typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0];
        const [zen, catalog] = await Promise.all([
            (async () => {
                const res = await fetcher(ZEN_MODELS_URL, {
                    headers: { "x-opencode-client": "cli", "User-Agent": "opencode/0.0.0-dev" },
                    signal,
                });
                if (!res.ok)
                    return null;
                return await res.json();
            })(),
            fetchModelsDevCatalog(fetcher, signal),
        ]);
        if (!zen)
            return [];
        const filtered = filterFreeModels(zen.data ?? [], { catalog: catalog ?? undefined });
        return filtered;
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=discovery.js.map