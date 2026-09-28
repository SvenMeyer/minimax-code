import { describe, expect, it } from 'vitest';

import {
  firstBuiltinModel,
  planCustomProviderResolution,
  planMinimaxApiResolution,
  readStringRecord,
} from './model-resolver-byok.js';

const FALLBACK_CATALOG = {
  contextWindow: 1,
  maxTokens: 2,
  fromCatalog: false,
} as const;
const MESSAGES_API_COMPAT_PATH = String.fromCodePoint(
  0x61,
  0x6e,
  0x74,
  0x68,
  0x72,
  0x6f,
  0x70,
  0x69,
  0x63,
);

describe('MiniMax API BYOK planning', () => {
  it('returns absent when the source is not configured and fails closed without a key', () => {
    expect(
      planMinimaxApiResolution({
        byok: undefined,
        providerConfig: undefined,
        modelId: 'model',
        catalog: FALLBACK_CATALOG,
      }),
    ).toBeUndefined();
    expect(() =>
      planMinimaxApiResolution({
        byok: { minimax_api: { apiKey: '   ' } },
        providerConfig: undefined,
        modelId: 'model',
        catalog: FALLBACK_CATALOG,
      }),
    ).toThrow('apiKey is not configured');
  });

  it('uses configured catalog limits and valid user-owned context overrides', () => {
    const fallback = planMinimaxApiResolution({
      byok: { minimax_api: { apiKey: ' key ' } },
      providerConfig: undefined,
      modelId: 'model',
      catalog: FALLBACK_CATALOG,
    });
    expect(fallback).toMatchObject({
      apiKey: 'key',
      contextWindow: 200_000,
      maxTokens: 16_384,
    });
    expect([
      `https://api.minimaxi.com/${MESSAGES_API_COMPAT_PATH}`,
      `https://api.minimax.io/${MESSAGES_API_COMPAT_PATH}`,
    ]).toContain(fallback?.baseUrl);

    expect(
      planMinimaxApiResolution({
        byok: { minimax_api: { apiKey: 'key', baseURL: ' https://byok.example ' } },
        providerConfig: undefined,
        modelId: 'model',
        catalog: { contextWindow: 10, maxTokens: 20, fromCatalog: true },
      }),
    ).toMatchObject({
      baseUrl: 'https://byok.example',
      contextWindow: 10,
      maxTokens: 20,
    });

    expect(
      planMinimaxApiResolution({
        byok: {
          minimax_api: {
            apiKey: 'key',
            modelContextLimits: { 'MiniMax-M3': 1_000_000 },
          },
        },
        providerConfig: {
          minimax: {
            models: {
              'MiniMax-M3': {
                limit: { context: 30, output: 40 },
                contextWindowOptions: [30, 1_000_000],
              },
            },
          },
        },
        modelId: 'MiniMax-M3',
        catalog: { contextWindow: 10, maxTokens: 20, fromCatalog: true },
      }),
    ).toMatchObject({ contextWindow: 1_000_000, maxTokens: 40 });
  });
});

describe('custom BYOK planning', () => {
  it('returns absent for missing, disabled, and unknown model configurations', () => {
    const base = { provider: 'custom_provider:work', providerKey: 'work', modelId: 'model' };
    expect(planCustomProviderResolution({ ...base, byok: undefined })).toBeUndefined();
    expect(
      planCustomProviderResolution({
        ...base,
        byok: { custom_provider: { work: { enabled: false } } },
      }),
    ).toBeUndefined();
    expect(
      planCustomProviderResolution({
        ...base,
        byok: { custom_provider: { work: { models: {} } } },
      }),
    ).toBeUndefined();
  });

  it('fails closed when custom provider credentials are incomplete', () => {
    const base = {
      provider: 'custom_provider:work',
      providerKey: 'work',
      modelId: 'model',
    };
    expect(() =>
      planCustomProviderResolution({
        ...base,
        byok: { custom_provider: { work: { models: { model: {} } } } },
      }),
    ).toThrow('api_key not configured');
    expect(() =>
      planCustomProviderResolution({
        ...base,
        byok: {
          custom_provider: {
            work: {
              options: { apiKey: 'key' },
              models: { model: {} },
            },
          },
        },
      }),
    ).toThrow('base_url not configured');
  });

  it('normalizes API selection, merged string headers, and fallback limits', () => {
    const providerHeaders: Record<string, string> = {
      'X-Shared': 'provider',
      'X-Provider': 'yes',
    };
    Reflect.set(providerHeaders, 'Ignored', 1);
    const base = {
      provider: 'custom_provider:work',
      providerKey: 'work',
      modelId: 'model',
    };
    const plan = planCustomProviderResolution({
      ...base,
      byok: {
        custom_provider: {
          work: {
            api: 'openai-completions',
            options: {
              apiKey: ' key ',
              baseURL: ' https://custom.example ',
              headers: providerHeaders,
            },
            models: {
              model: {
                headers: { 'x-shared': 'model', 'X-Model': 'yes' },
              },
            },
          },
        },
      },
    });
    expect(plan).toMatchObject({
      api: 'openai-completions',
      apiKey: 'key',
      baseUrl: 'https://custom.example',
      contextWindow: 200_000,
      maxTokens: 16_384,
      configHeaders: {
        'X-Provider': 'yes',
        'x-shared': 'model',
        'X-Model': 'yes',
      },
    });

    expect(
      planCustomProviderResolution({
        ...base,
        byok: {
          custom_provider: {
            work: {
              api: 'other',
              options: { apiKey: 'key', baseURL: 'https://custom.example' },
              models: { model: { limit: { context: 5, output: 6 } } },
            },
          },
        },
      }),
    ).toMatchObject({
      api: 'anthropic-messages',
      contextWindow: 5,
      maxTokens: 6,
    });
  });
});

describe('BYOK config helpers', () => {
  it('selects MiniMax first, then another configured provider', () => {
    expect(
      firstBuiltinModel({
        minimax: { models: { mini: {} } },
        other: { models: { other: {} } },
      }),
    ).toEqual({ provider: 'minimax', modelId: 'mini' });
    expect(firstBuiltinModel({ other: { models: { other: {} } } })).toEqual({
      provider: 'other',
      modelId: 'other',
    });
    expect(firstBuiltinModel({ empty: {} })).toBeUndefined();
  });

  it.each([undefined, null, [], 'invalid', {}, { Invalid: 1 }])(
    'rejects a non-string header record %j',
    (value) => {
      expect(readStringRecord(value)).toBeUndefined();
    },
  );

  it('keeps only string header values', () => {
    expect(readStringRecord({ Keep: 'yes', Drop: 1 })).toEqual({ Keep: 'yes' });
  });
});

describe('custom BYOK compat overrides', () => {
  // Provider config is restored from on-disk JSON, so compat reaches planning untyped.
  const planWithCompat = (rawConfig: string) =>
    planCustomProviderResolution({
      provider: 'custom_provider:gateway',
      providerKey: 'gateway',
      modelId: 'kimi-k2-thinking',
      byok: {
        custom_provider: {
          gateway: {
            api: 'openai-completions',
            options: { apiKey: 'gateway-key', baseURL: 'https://gateway.example/v1' },
            models: { 'kimi-k2-thinking': JSON.parse(rawConfig) },
          },
        },
      },
    })?.modelCompat;

  it.each(['null', '"compat"', '7', '[]', '[{"supportsDeveloperRole":false}]'])(
    'ignores non-record compat value %s',
    (compat) => {
      expect(planWithCompat(`{"compat":${compat}}`)).toBeUndefined();
    },
  );

  it('is absent when the model declares no compat', () => {
    expect(planWithCompat('{}')).toBeUndefined();
  });

  it('keeps declared boolean and enum fields', () => {
    expect(
      planWithCompat(
        '{"compat":{"supportsDeveloperRole":false,"supportsStrictMode":false,"supportsReasoningEffort":false,"maxTokensField":"max_tokens","thinkingFormat":"deepseek","cacheControlFormat":"anthropic"}}',
      ),
    ).toEqual({
      supportsDeveloperRole: false,
      supportsStrictMode: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'deepseek',
      cacheControlFormat: 'anthropic',
    });
  });

  it('preserves an explicit true so a permissive upstream stays declarable', () => {
    expect(planWithCompat('{"compat":{"supportsDeveloperRole":true}}')).toEqual({
      supportsDeveloperRole: true,
    });
  });

  it('drops a boolean field carrying a truthy string instead of a boolean', () => {
    expect(planWithCompat('{"compat":{"supportsDeveloperRole":"false"}}')).toBeUndefined();
  });

  it('drops enum fields outside the supported set', () => {
    expect(
      planWithCompat('{"compat":{"maxTokensField":"max_output_tokens","thinkingFormat":"kimi"}}'),
    ).toBeUndefined();
  });

  it('ignores unknown keys', () => {
    expect(planWithCompat('{"compat":{"unknownFlag":true,"supportsStore":false}}')).toEqual({
      supportsStore: false,
    });
  });

  it('keeps a valid field when a sibling field is malformed', () => {
    expect(
      planWithCompat('{"compat":{"supportsDeveloperRole":false,"supportsStrictMode":"no"}}'),
    ).toEqual({ supportsDeveloperRole: false });
  });

  it('does not inherit prototype pollution from the config record', () => {
    expect(
      planWithCompat('{"compat":{"__proto__":{"supportsDeveloperRole":false}}}'),
    ).toBeUndefined();
  });

  it('keeps a pinned OpenRouter provider and disables fallbacks', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"only":["DeepSeek"],"allow_fallbacks":false}}}',
      ),
    ).toEqual({ openRouterRouting: { only: ['DeepSeek'], allow_fallbacks: false } });
  });

  it('keeps an ordered OpenRouter provider preference list', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"order":["DeepInfra","Fireworks"],"ignore":["Morph"]}}}',
      ),
    ).toEqual({ openRouterRouting: { order: ['DeepInfra', 'Fireworks'], ignore: ['Morph'] } });
  });

  it('keeps a bare sort strategy and a sort object', () => {
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":"throughput"}}}')).toEqual({
      openRouterRouting: { sort: 'throughput' },
    });
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":"price","partition":"none"}}}}'),
    ).toEqual({ openRouterRouting: { sort: { by: 'price', partition: 'none' } } });
  });

  it('keeps privacy and cost routing keys', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"zdr":true,"data_collection":"deny","max_price":{"prompt":"0.000002","completion":1}}}}',
      ),
    ).toEqual({
      openRouterRouting: {
        zdr: true,
        data_collection: 'deny',
        max_price: { prompt: '0.000002', completion: 1 },
      },
    });
  });

  it('keeps throughput and latency preferences in both accepted shapes', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"preferred_min_throughput":{"p50":100},"preferred_max_latency":2.5}}}',
      ),
    ).toEqual({
      openRouterRouting: { preferred_min_throughput: { p50: 100 }, preferred_max_latency: 2.5 },
    });
  });

  it('drops a routing object when every key is malformed', () => {
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"only":"DeepSeek","zdr":"yes"}}}'),
    ).toBeUndefined();
  });

  it('drops a routing key carrying the wrong type but keeps its valid siblings', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"only":"DeepSeek","allow_fallbacks":"false","zdr":true}}}',
      ),
    ).toEqual({ openRouterRouting: { zdr: true } });
  });

  it('drops non-record routing values', () => {
    expect(planWithCompat('{"compat":{"openRouterRouting":[]}}')).toBeUndefined();
    expect(planWithCompat('{"compat":{"openRouterRouting":"only"}}')).toBeUndefined();
  });

  it('does not forward unknown routing keys to OpenRouter', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"only":["DeepSeek"],"require_attestation":true}}}',
      ),
    ).toEqual({ openRouterRouting: { only: ['DeepSeek'] } });
  });

  it('leaves routing absent so no provider field is sent by default', () => {
    expect(planWithCompat('{"compat":{"supportsStore":false}}')).toEqual({ supportsStore: false });
  });
});
