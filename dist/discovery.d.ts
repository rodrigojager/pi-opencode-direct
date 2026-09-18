/**
 * Discovery of free OpenCode Zen models.
 *
 * Free-tier ids come live from the Zen REST API (`/zen/v1/models`). Display
 * names, reasoning support, and limits come from the models.dev catalog;
 * anything unknown defaults to non-reasoning with conservative limits.
 * Every failure mode yields an empty list (no offline catalog).
 */
export interface OpenCodeModelInfo {
    id: string;
    name: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    /** pi thinking level → provider value. `null` marks the level unsupported. */
    thinkingLevelMap?: Record<string, string | null>;
    /** Input modalities advertised by models.dev (subset relevant to pi). */
    input?: string[];
    /** Set when models.dev routes the model via @ai-sdk/openai (Responses API);
     * absent means the zen default chat/completions path. */
    api?: "openai-responses";
}
interface ModelMeta {
    name?: string;
    reasoning?: boolean;
    reasoning_options?: Array<{
        type: string;
        values?: string[];
    }>;
    limit?: {
        context?: number;
        output?: number;
    };
    input?: string[];
    provider?: {
        npm?: string;
    };
}
export declare function filterFreeModels(models: Array<{
    id?: unknown;
    name?: unknown;
}>, opts?: {
    catalog?: Record<string, ModelMeta>;
}): OpenCodeModelInfo[];
export declare function discoverModels(opts?: {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<OpenCodeModelInfo[]>;
export {};
