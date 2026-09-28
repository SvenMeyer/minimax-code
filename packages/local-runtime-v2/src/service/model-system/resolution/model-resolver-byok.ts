import type { Api, OpenRouterRouting } from '@earendil-works/pi-ai';
import { minimaxApiModels, getRuntimeRegion } from '@mavis/config';

import type {
  LocalByokProviderConfig,
  LocalCustomProviderConfig,
  LocalModelCompatOverrides,
  LocalModelConfig,
  LocalModelsConfig,
} from '../contracts.js';
import { mergeProviderHeaders } from '../connectivity/provider-request.js';
import {
  isModelProviderApi,
  MANAGED_MINIMAX_PROVIDER_ID,
  MINIMAX_API_PROVIDER_ID,
} from '../identity.js';

const BYOK_FALLBACK_MODEL_LIMITS = {
  contextWindow: 200_000,
  maxTokens: 16_384,
} as const;
const MESSAGES_API_COMPAT_PATH = '\x61\x6e\x74\x68\x72\x6f\x70\x69\x63';

export interface ByokResolutionPlan {
  readonly provider: string;
  readonly api: Api;
  readonly apiKey?: string;
  readonly authProvider?: string;
  readonly runtimeProvider?: string;
  readonly baseUrl: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly configHeaders?: Record<string, string>;
  readonly modelCompat?: LocalModelCompatOverrides;
}

export function planMinimaxApiResolution(input: {
  readonly byok: LocalByokProviderConfig | undefined;
  readonly providerConfig: LocalModelsConfig | undefined;
  readonly modelId: string;
  readonly catalog: {
    readonly contextWindow: number;
    readonly maxTokens: number;
    readonly fromCatalog: boolean;
  };
}): ByokResolutionPlan | undefined {
  const config = input.byok?.minimax_api;
  if (!config) return undefined;
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('LocalModelResolver: minimax_api apiKey is not configured.');
  }
  const catalogModel = minimaxApiModels({ provider: input.providerConfig, minimax_api: config })[
    input.modelId
  ];
  return {
    provider: MINIMAX_API_PROVIDER_ID,
    api: 'anthropic-messages',
    apiKey,
    baseUrl: config.baseURL?.trim() || defaultMinimaxApiBaseUrl(),
    contextWindow:
      catalogModel?.limit?.context ??
      (input.catalog.fromCatalog
        ? input.catalog.contextWindow
        : BYOK_FALLBACK_MODEL_LIMITS.contextWindow),
    maxTokens:
      catalogModel?.limit?.output ??
      (input.catalog.fromCatalog ? input.catalog.maxTokens : BYOK_FALLBACK_MODEL_LIMITS.maxTokens),
  };
}

export function planCustomProviderResolution(input: {
  readonly byok: LocalByokProviderConfig | undefined;
  readonly provider: string;
  readonly providerKey: string;
  readonly modelId: string;
}): ByokResolutionPlan | undefined {
  const config = input.byok?.custom_provider?.[input.providerKey];
  if (!config || config.enabled === false) return undefined;
  const modelConfig = config.models?.[input.modelId];
  if (!modelConfig) return undefined;
  const credentials = resolveCustomProviderCredentials(config, input);
  const configHeaders = mergeProviderHeaders(
    readStringRecord(config.options?.headers),
    readStringRecord(modelConfig.headers),
  );
  const modelCompat = readModelCompat(modelConfig.compat);
  return {
    provider: input.provider,
    api: resolveCustomProviderApi(config.api),
    ...credentials,
    ...customProviderLimits(modelConfig),
    ...(configHeaders ? { configHeaders } : {}),
    ...(modelCompat ? { modelCompat } : {}),
  };
}

function resolveCustomProviderCredentials(
  config: LocalCustomProviderConfig,
  input: { readonly provider: string; readonly providerKey: string },
): Pick<ByokResolutionPlan, 'apiKey' | 'authProvider' | 'runtimeProvider' | 'baseUrl'> {
  const authProvider =
    config.kind === 'oauth' || config.options?.authMode === 'oauth' ? input.providerKey : undefined;
  const apiKey = config.options?.apiKey?.trim();
  if (!apiKey && !authProvider) {
    throw new Error(`LocalModelResolver: api_key not configured for provider "${input.provider}".`);
  }
  const baseUrl = config.options?.baseURL?.trim();
  if (!baseUrl) {
    throw new Error(
      `LocalModelResolver: base_url not configured for provider "${input.provider}".`,
    );
  }
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(authProvider ? { authProvider, runtimeProvider: authProvider } : {}),
    baseUrl,
  };
}

function customProviderLimits(
  modelConfig: LocalModelConfig,
): Pick<ByokResolutionPlan, 'contextWindow' | 'maxTokens'> {
  return {
    contextWindow: modelConfig.limit?.context ?? BYOK_FALLBACK_MODEL_LIMITS.contextWindow,
    maxTokens: byokEffectiveOutputLimit(modelConfig),
  };
}

/**
 * Output budget a real BYOK turn sends for this model, configured limit or
 * default. The connection probe sends the same value so it stays a dry run of
 * the first real turn; a budget rejection can then only be a real one.
 */
export function byokEffectiveOutputLimit(modelConfig: LocalModelConfig | undefined): number {
  return modelConfig?.limit?.output ?? BYOK_FALLBACK_MODEL_LIMITS.maxTokens;
}

function resolveCustomProviderApi(value: unknown): Api {
  if (
    typeof value === 'string' &&
    (isModelProviderApi(value) || value === 'openai-codex-responses')
  ) {
    return value;
  }
  return 'anthropic-messages';
}

export function firstBuiltinModel(
  providerConfig: LocalModelsConfig | undefined,
): { readonly provider: string; readonly modelId: string } | undefined {
  const preferredModelId = Object.keys(
    providerConfig?.[MANAGED_MINIMAX_PROVIDER_ID]?.models ?? {},
  )[0];
  if (preferredModelId) return { provider: MANAGED_MINIMAX_PROVIDER_ID, modelId: preferredModelId };
  return Object.entries(providerConfig ?? {}).flatMap(([provider, config]) => {
    const modelId = Object.keys(config.models ?? {})[0];
    return modelId ? [{ provider, modelId }] : [];
  })[0];
}

export function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Keys of `LocalModelCompatOverrides` whose declared value is a boolean. */
type BooleanCompatKey = {
  [K in keyof LocalModelCompatOverrides]-?: boolean extends LocalModelCompatOverrides[K]
    ? K
    : never;
}[keyof LocalModelCompatOverrides];

const BOOLEAN_COMPAT_KEYS = [
  'supportsStore',
  'supportsDeveloperRole',
  'supportsReasoningEffort',
  'supportsUsageInStreaming',
  'requiresToolResultName',
  'requiresAssistantAfterToolResult',
  'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages',
  'supportsStrictMode',
  'supportsLongCacheRetention',
  'supportsEagerToolInputStreaming',
  'supportsCacheControlOnTools',
  'supportsTemperature',
  'sendSessionAffinityHeaders',
  'sendSessionIdHeader',
  'zaiToolStream',
  'forceAdaptiveThinking',
  'allowEmptySignature',
] as const satisfies readonly BooleanCompatKey[];

const MAX_TOKENS_FIELDS = [
  'max_tokens',
  'max_completion_tokens',
] as const satisfies readonly NonNullable<LocalModelCompatOverrides['maxTokensField']>[];

const THINKING_FORMATS = [
  'openai',
  'openrouter',
  'together',
  'deepseek',
  'zai',
  'qwen',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
] as const satisfies readonly NonNullable<LocalModelCompatOverrides['thinkingFormat']>[];

const CACHE_CONTROL_FORMATS = ['anthropic'] as const satisfies readonly NonNullable<
  LocalModelCompatOverrides['cacheControlFormat']
>[];

function readCompatEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' ? allowed.find((option) => option === value) : undefined;
}

/** Narrows to `string[]` only when *every* entry is a string. */
function isStringArray(value: unknown[]): value is string[] {
  return value.every((entry) => typeof entry === 'string');
}

/**
 * Reads a list-shaped routing key (`only`, `order`, `ignore`, `quantizations`).
 *
 * A mixed array is not a `string[]`, so the whole list is rejected rather than
 * filtered down. Silently shrinking one would change the routing decision
 * without saying so — `only: ["DeepSeek", 42]` would otherwise pin to a
 * different provider set than the one that was written.
 */
function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !isStringArray(value) || value.length === 0) return undefined;
  return value;
}

/** Reads a finite number, dropping NaN/Infinity that JSON cannot legitimately carry. */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A decimal number, optionally signed and optionally in exponent form. */
const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Reads a numeric-or-string money field (`max_price.*`). OpenRouter accepts both
 * a number and a decimal string here, so the declared type is a union.
 *
 * The string form must still be a number. Accepting any non-empty string would
 * forward values like `"free"` or `"$5"` as a price ceiling, which is exactly
 * the kind of unvalidated shape this reader exists to keep out of the request.
 */
function readNumberish(value: unknown): number | string | undefined {
  if (typeof value === 'number') return readNumber(value);
  if (typeof value === 'string' && NUMERIC_STRING.test(value.trim())) return value.trim();
  return undefined;
}

/** Reads `{ prompt?, completion?, image?, audio?, request? }` price ceilings. */
function readMaxPrice(value: unknown): Record<string, number | string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, raw]) => [key, readNumberish(raw)] as const)
    .filter((entry): entry is readonly [string, number | string] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Reads a percentile cutoff map (`p50`, `p75`, `p90`, `p99`), used by the
 * `preferred_min_throughput` / `preferred_max_latency` fields. These accept a
 * bare number as well, but the object form is numeric-only.
 */
function readPercentiles(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, raw]) => [key, readNumber(raw)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const ROUTING_BOOLEAN_KEYS = [
  'allow_fallbacks',
  'require_parameters',
  'zdr',
  'enforce_distillable_text',
] as const;
const ROUTING_LIST_KEYS = ['order', 'only', 'ignore', 'quantizations'] as const;
const ROUTING_PERCENTILE_KEYS = ['preferred_min_throughput', 'preferred_max_latency'] as const;
const ROUTING_SORT_BYS = ['price', 'throughput', 'latency'] as const;
const ROUTING_PARTITIONS = ['model', 'none'] as const;
const DATA_COLLECTIONS = ['allow', 'deny'] as const;

/**
 * Reads `sort`, which OpenRouter accepts either as a bare strategy name or as
 * `{ by, partition }`.
 *
 * The object form is validated atomically: if a key that is *present* fails
 * validation the whole object is dropped, so a partial sort is never forwarded
 * as a routing override. Unknown keys are ignored, as everywhere else.
 */
function readRoutingSort(
  value: unknown,
): string | { by?: string; partition?: string | null } | undefined {
  if (typeof value === 'string') {
    return ROUTING_SORT_BYS.find((option) => option === value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const sort: { by?: string; partition?: string | null } = {};
  if (source.by !== undefined) {
    const by = readCompatEnum(source.by, ROUTING_SORT_BYS);
    if (!by) return undefined;
    sort.by = by;
  }
  if (source.partition !== undefined) {
    if (source.partition === null) {
      sort.partition = null;
    } else {
      const partition = readCompatEnum(source.partition, ROUTING_PARTITIONS);
      if (!partition) return undefined;
      sort.partition = partition;
    }
  }
  return sort.by || sort.partition !== undefined ? sort : undefined;
}

/**
 * Read `compat.openRouterRouting` out of untrusted provider config.
 *
 * The object is forwarded verbatim to OpenRouter as the request `provider`
 * field, so every key is validated at its declared type and anything unknown or
 * malformed is dropped. A rejected key never invalidates its valid siblings,
 * and an object left with no usable keys is dropped entirely so an empty
 * `provider` object is never sent.
 */
function readOpenRouterRouting(value: unknown): OpenRouterRouting | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source: Record<string, unknown> = { ...value };
  const routing: OpenRouterRouting = {};
  for (const key of ROUTING_BOOLEAN_KEYS) {
    const candidate = source[key];
    if (typeof candidate === 'boolean') routing[key] = candidate;
  }
  const dataCollection = readCompatEnum(source.data_collection, DATA_COLLECTIONS);
  if (dataCollection) routing.data_collection = dataCollection;
  for (const key of ROUTING_LIST_KEYS) {
    const list = readStringList(source[key]);
    if (list) routing[key] = list;
  }
  const sort = readRoutingSort(source.sort);
  if (sort) routing.sort = sort;
  const maxPrice = readMaxPrice(source.max_price);
  if (maxPrice) routing.max_price = maxPrice;
  for (const key of ROUTING_PERCENTILE_KEYS) {
    // A bare number is valid on its own; the object form needs the map reader.
    const percentiles = readPercentiles(source[key]) ?? readNumber(source[key]);
    if (percentiles !== undefined) routing[key] = percentiles;
  }
  return Object.keys(routing).length > 0 ? routing : undefined;
}

/**
 * Read model-level compatibility overrides out of untrusted provider config.
 *
 * The `custom_provider` config subtree is persisted as opaque JSON, so each field is
 * accepted only at its declared type. A value of the wrong type is dropped rather than
 * forwarded, because pi treats any present field as an explicit override and a truthy
 * string such as `"false"` would otherwise invert the intended behavior.
 *
 * `openRouterRouting` is the one object-valued field, so it is validated
 * structurally by {@link readOpenRouterRouting} rather than key by key here.
 */
function readModelCompat(value: unknown): LocalModelCompatOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source: Record<string, unknown> = { ...value };
  const compat: LocalModelCompatOverrides = {};
  for (const key of BOOLEAN_COMPAT_KEYS) {
    const candidate = source[key];
    if (typeof candidate === 'boolean') compat[key] = candidate;
  }
  const maxTokensField = readCompatEnum(source.maxTokensField, MAX_TOKENS_FIELDS);
  if (maxTokensField) compat.maxTokensField = maxTokensField;
  const thinkingFormat = readCompatEnum(source.thinkingFormat, THINKING_FORMATS);
  if (thinkingFormat) compat.thinkingFormat = thinkingFormat;
  const cacheControlFormat = readCompatEnum(source.cacheControlFormat, CACHE_CONTROL_FORMATS);
  if (cacheControlFormat) compat.cacheControlFormat = cacheControlFormat;
  const openRouterRouting = readOpenRouterRouting(source.openRouterRouting);
  if (openRouterRouting) compat.openRouterRouting = openRouterRouting;
  return Object.keys(compat).length > 0 ? compat : undefined;
}

function defaultMinimaxApiBaseUrl(): string {
  const origin =
    getRuntimeRegion() === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
  return `${origin}/${MESSAGES_API_COMPAT_PATH}`;
}
