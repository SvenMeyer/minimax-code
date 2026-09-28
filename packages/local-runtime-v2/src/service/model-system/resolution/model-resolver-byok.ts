import type { Api, OpenRouterRouting, VercelGatewayRouting } from '@earendil-works/pi-ai';
import { MINIMAX_API_MODEL_CATALOG, getRuntimeRegion } from '@mavis/config';

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
  const catalogModel = MINIMAX_API_MODEL_CATALOG[input.modelId];
  const contextOverride = config.modelContextLimits?.[input.modelId];
  const contextLimit =
    contextOverride !== undefined && catalogModel?.contextWindowOptions?.includes(contextOverride)
      ? contextOverride
      : catalogModel?.limit?.context;
  return {
    provider: MINIMAX_API_PROVIDER_ID,
    api: 'anthropic-messages',
    apiKey,
    baseUrl: config.baseURL?.trim() || defaultMinimaxApiBaseUrl(),
    contextWindow:
      contextLimit ??
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
  const modelCompat = restrictRoutingToEndpoint(
    readModelCompat(modelConfig.compat),
    config.options?.baseURL,
  );
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

/**
 * Narrows to `string[]` only when *every* entry is a usable provider slug.
 *
 * An entry that is empty or whitespace-only is not a slug, so it fails here the
 * same way a non-string does. `readStrategy` already rejects the empty string in
 * the analogous scalar case; a list must not be laxer than a plain value.
 */
function isProviderSlugList(value: unknown[]): value is string[] {
  return value.every((entry) => typeof entry === 'string' && entry.trim() !== '');
}

/**
 * Reads a list-shaped routing key (`only`, `order`, `ignore`, `quantizations`).
 *
 * A mixed array is not a `string[]`, so the whole list is rejected rather than
 * filtered down. Silently shrinking one would change the routing decision
 * without saying so — `only: ["DeepSeek", 42]` would otherwise pin to a
 * different provider set than the one that was written. The same applies to a
 * list padded with an empty entry, which could never match a provider.
 */
function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !isProviderSlugList(value) || value.length === 0) return undefined;
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
 * The string form must still be a usable number. Accepting any non-empty string
 * would forward values like `"free"` or `"$5"` as a price ceiling, and accepting
 * the exponent form unchecked would forward `"1e999"`, which parses to
 * `Infinity` — the same non-finite value the numeric branch rejects.
 */
function readNumberish(value: unknown): number | string | undefined {
  if (typeof value === 'number') return readNumber(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!NUMERIC_STRING.test(trimmed) || !Number.isFinite(Number(trimmed))) return undefined;
  return trimmed;
}

const MAX_PRICE_KEYS = ['prompt', 'completion', 'image', 'audio', 'request'] as const;
const PERCENTILE_KEYS = ['p50', 'p75', 'p90', 'p99'] as const;

/**
 * Reads `{ prompt?, completion?, image?, audio?, request? }` price ceilings.
 *
 * Iterates the known keys rather than the object's own entries: an unrecognised
 * key is not a declared field, so it must not ride along into the request. This
 * is the same rule the scalar reader applies, and it is what keeps a
 * non-OpenRouter shape from being forwarded as a routing override.
 */
function readMaxPrice(value: unknown): Record<string, number | string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const maxPrice: Record<string, number | string> = {};
  for (const key of MAX_PRICE_KEYS) {
    const candidate = readNumberish(source[key]);
    if (candidate !== undefined) maxPrice[key] = candidate;
  }
  return Object.keys(maxPrice).length > 0 ? maxPrice : undefined;
}

/**
 * Reads a percentile cutoff map (`p50`, `p75`, `p90`, `p99`), used by the
 * `preferred_min_throughput` / `preferred_max_latency` fields. These accept a
 * bare number as well, but the object form is numeric-only.
 *
 * Known-keys-only, for the same reason as {@link readMaxPrice}: a percentile
 * outside the declared set is not a field OpenRouter accepts.
 */
function readPercentiles(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const percentiles: Record<string, number> = {};
  for (const key of PERCENTILE_KEYS) {
    const candidate = readNumber(source[key]);
    if (candidate !== undefined) percentiles[key] = candidate;
  }
  return Object.keys(percentiles).length > 0 ? percentiles : undefined;
}

const ROUTING_BOOLEAN_KEYS = [
  'allow_fallbacks',
  'require_parameters',
  'zdr',
  'enforce_distillable_text',
] as const;
const ROUTING_LIST_KEYS = ['order', 'only', 'ignore', 'quantizations'] as const;
const ROUTING_PERCENTILE_KEYS = ['preferred_min_throughput', 'preferred_max_latency'] as const;
const DATA_COLLECTIONS = ['allow', 'deny'] as const;
const VERCEL_ROUTING_LIST_KEYS = ['only', 'order'] as const;
const VERCEL_GATEWAY_HOST = 'ai-gateway.vercel.sh';

/** Hostname of a base URL, tolerating a missing scheme and a trailing-dot FQDN. */
function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ? value : `https://${value}`;
  try {
    // A single trailing dot is the DNS root label and names the same host, so
    // `ai-gateway.vercel.sh.` must not be treated as a different endpoint.
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return undefined;
  }
}

/**
 * Drops `vercelGatewayRouting` unless the endpoint really is a Vercel AI
 * Gateway host.
 *
 * The transport decides with `model.baseUrl.includes("ai-gateway.vercel.sh")` —
 * a substring test, not a hostname test. `ai-gateway.vercel.sh.example.com`
 * matches it, and so does any URL carrying that string in a path. Since the
 * Vercel branch attaches gateway-only body fields, an endpoint that merely looks
 * Vercel-ish should not be able to attract them, and the transport is vendored
 * third-party code that this patch does not modify.
 *
 * Gating here means the field is only ever produced for an exact hostname, so
 * the loose check downstream cannot be reached with a lookalike. Every other
 * compat key passes through untouched.
 */
function restrictRoutingToEndpoint(
  compat: LocalModelCompatOverrides | undefined,
  baseUrl: string | undefined,
): LocalModelCompatOverrides | undefined {
  if (!compat?.vercelGatewayRouting) return compat;
  if (hostnameOf(baseUrl) === VERCEL_GATEWAY_HOST) return compat;
  const rest: LocalModelCompatOverrides = { ...compat };
  delete rest.vercelGatewayRouting;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * Reads `compat.vercelGatewayRouting` out of untrusted provider config.
 *
 * `VercelGatewayRouting` declares exactly `only` and `order`, both `string[]`,
 * and the transport reads only those two before building
 * `providerOptions.gateway` — so keeping to the declared keys is both the
 * contract and the whole of what can have an effect.
 *
 * This function does not decide the endpoint. {@link restrictRoutingToEndpoint}
 * does, and it is load-bearing rather than defensive: the transport's own check
 * is a substring test (`baseUrl.includes("ai-gateway.vercel.sh")`) that a
 * lookalike host passes, so removing that gate would let Vercel-only body fields
 * reach a host that merely looks Vercel. Do not drop it as redundant.
 */
function readVercelGatewayRouting(value: unknown): VercelGatewayRouting | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const routing: VercelGatewayRouting = {};
  for (const key of VERCEL_ROUTING_LIST_KEYS) {
    const list = readStringList(source[key]);
    if (list) routing[key] = list;
  }
  return Object.keys(routing).length > 0 ? routing : undefined;
}

/**
 * A non-empty strategy string, for `sort` / `sort.by` / `sort.partition`.
 *
 * The declared contract is plain `string` — pi documents `price`, `throughput`
 * and `latency` as examples ("e.g."), not as an exhaustive union — so this
 * checks the type and rejects only the empty/whitespace-only string. Narrowing
 * to the examples would silently drop a strategy the shared type permits and pi
 * forwards.
 *
 * Incidental surrounding whitespace is trimmed rather than rejected: a padded
 * value cannot match anything OpenRouter knows, so forwarding it verbatim would
 * fail the request, and dropping the whole key would silently discard routing
 * the user did configure. Trimming is the one case where rewriting the value is
 * safer than either alternative.
 */
function readStrategy(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

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
  const bare = readStrategy(value);
  if (bare) return bare;
  if (typeof value === 'string') return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const sort: { by?: string; partition?: string | null } = {};
  if (source.by !== undefined) {
    const by = readStrategy(source.by);
    if (!by) return undefined;
    sort.by = by;
  }
  if (source.partition !== undefined) {
    if (source.partition === null) {
      sort.partition = null;
    } else {
      const partition = readStrategy(source.partition);
      if (!partition) return undefined;
      sort.partition = partition;
    }
  }
  return sort.by || sort.partition !== undefined ? sort : undefined;
}

/**
 * Read `compat.openRouterRouting` out of untrusted provider config.
 *
 * The result is attached to the request as the `provider` field by the
 * openai-completions transport, which does not check the endpoint — so this is
 * not restricted to OpenRouter and it is not forwarded verbatim: every key is
 * validated at its declared type and anything unknown or malformed is dropped.
 * A rejected key never invalidates its valid siblings, and an object left with
 * no usable keys is dropped entirely so an empty `provider` object is never
 * sent.
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
  const vercelGatewayRouting = readVercelGatewayRouting(source.vercelGatewayRouting);
  if (vercelGatewayRouting) compat.vercelGatewayRouting = vercelGatewayRouting;
  return Object.keys(compat).length > 0 ? compat : undefined;
}

function defaultMinimaxApiBaseUrl(): string {
  const origin =
    getRuntimeRegion() === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
  return `${origin}/${MESSAGES_API_COMPAT_PATH}`;
}
