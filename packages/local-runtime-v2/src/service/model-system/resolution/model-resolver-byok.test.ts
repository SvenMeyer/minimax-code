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

  it('uses fallback, catalog, and user-owned context overrides without managed limits', () => {
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
            models: { 'MiniMax-M3': { limit: { context: 30, output: 40 } } },
          },
        },
        modelId: 'MiniMax-M3',
        catalog: { contextWindow: 10, maxTokens: 20, fromCatalog: true },
      }),
    ).toMatchObject({ contextWindow: 1_000_000, maxTokens: 128_000 });
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
  const planWithCompatAt = (baseURL: string, rawConfig: string) =>
    planCustomProviderResolution({
      provider: 'custom_provider:gateway',
      providerKey: 'gateway',
      modelId: 'kimi-k2-thinking',
      byok: {
        custom_provider: {
          gateway: {
            api: 'openai-completions',
            options: { apiKey: 'gateway-key', baseURL },
            models: { 'kimi-k2-thinking': JSON.parse(rawConfig) },
          },
        },
      },
    })?.modelCompat;
  const planWithCompat = (rawConfig: string) =>
    planWithCompatAt('https://gateway.example/v1', rawConfig);
  const VERCEL_HOST = 'https://ai-gateway.vercel.sh/v1';

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

  it('rejects a mixed provider list instead of filtering it down', () => {
    // A shrunk list would silently pin/order/exclude a different provider set
    // than the one written, so the whole key is dropped.
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"only":["DeepSeek",42]}}}'),
    ).toBeUndefined();
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"order":["DeepInfra",null],"zdr":true}}}'),
    ).toEqual({ openRouterRouting: { zdr: true } });
  });

  it('rejects a sparse provider list', () => {
    // JSON cannot carry a hole, so the config is built directly rather than
    // parsed. `every` skips holes: without densifying first, this array would
    // satisfy the `string[]` predicate and serialise its hole as `null` on the
    // wire, which is the malformed list the reader exists to reject.
    // The repo's linter forbids a sparse array literal, so the hole is made by
    // allocating then leaving an index unset.
    const sparse = new Array<string>(3);
    sparse[0] = 'DeepSeek';
    sparse[2] = 'DeepInfra';
    expect(1 in sparse).toBe(false); // index 1 really is a hole
    expect(sparse.every(() => true)).toBe(true); // every() is blind to it
    expect(
      planCustomProviderResolution({
        provider: 'custom_provider:gateway',
        providerKey: 'gateway',
        modelId: 'kimi-k2-thinking',
        byok: {
          custom_provider: {
            gateway: {
              api: 'openai-completions',
              options: { apiKey: 'gateway-key', baseURL: 'https://gateway.example/v1' },
              models: {
                'kimi-k2-thinking': {
                  compat: { openRouterRouting: { only: sparse } } as never,
                },
              },
            },
          },
        },
      })?.modelCompat,
    ).toBeUndefined();
  });

  it('rejects a provider list padded with an empty entry', () => {
    // An empty slug can never match a provider, so it is as invalid as a
    // non-string. readStrategy rejects the empty string in the scalar case, so
    // the list must not be laxer.
    expect(planWithCompat('{"compat":{"openRouterRouting":{"only":[""]}}}')).toBeUndefined();
    expect(planWithCompat('{"compat":{"openRouterRouting":{"only":["   "]}}}')).toBeUndefined();
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"order":["DeepInfra",""],"zdr":true}}}'),
    ).toEqual({ openRouterRouting: { zdr: true } });
  });

  it('trims incidental whitespace from list entries', () => {
    // A padded slug matches no provider, so forwarding it verbatim would make
    // the routing silently ineffective while rejecting would discard routing the
    // user did configure. readStrategy trims scalars for the same reason.
    expect(planWithCompat('{"compat":{"openRouterRouting":{"only":[" DeepSeek "]}}}')).toEqual({
      openRouterRouting: { only: ['DeepSeek'] },
    });
    expect(
      planWithCompatAt(
        VERCEL_HOST,
        '{"compat":{"vercelGatewayRouting":{"order":[" anthropic ","bedrock"]}}}',
      ),
    ).toEqual({ vercelGatewayRouting: { order: ['anthropic', 'bedrock'] } });
  });

  it('trims incidental whitespace from a strategy string', () => {
    // A padded value cannot match anything OpenRouter knows; forwarding it
    // verbatim would fail, and dropping the key would discard routing silently.
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":" latency "}}}')).toEqual({
      openRouterRouting: { sort: 'latency' },
    });
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":"  price "}}}}')).toEqual({
      openRouterRouting: { sort: { by: 'price' } },
    });
  });

  it('rejects an empty provider list', () => {
    expect(planWithCompat('{"compat":{"openRouterRouting":{"only":[]}}}')).toBeUndefined();
  });

  it('drops a price that is a non-numeric string rather than forwarding it', () => {
    // "free" / "$5" are strings, but not prices; forwarding them as a ceiling
    // would send a malformed provider override to OpenRouter.
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"max_price":{"prompt":"free","completion":1}}}}',
      ),
    ).toEqual({ openRouterRouting: { max_price: { completion: 1 } } });
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"max_price":{"prompt":"$5"}}}}'),
    ).toBeUndefined();
  });

  it('keeps decimal and exponent price strings', () => {
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"max_price":{"prompt":"0.000002"}}}}'),
    ).toEqual({ openRouterRouting: { max_price: { prompt: '0.000002' } } });
  });

  it('drops the whole sort object when a present member is not a usable strategy', () => {
    // Atomic: {by: "price", partition: 42} must not become {by: "price"}.
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":"price","partition":42}}}}'),
    ).toBeUndefined();
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":42}}}}')).toBeUndefined();
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":""}}}}')).toBeUndefined();
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":""}}}')).toBeUndefined();
  });

  it('accepts any non-empty sort strategy, not just the documented examples', () => {
    // pi types `sort`/`by`/`partition` as plain string and documents
    // price/throughput/latency as examples, so narrowing to those would drop a
    // strategy the contract permits and the transport forwards.
    expect(planWithCompat('{"compat":{"openRouterRouting":{"sort":"custom-strategy"}}}')).toEqual({
      openRouterRouting: { sort: 'custom-strategy' },
    });
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":"custom-strategy"}}}}'),
    ).toEqual({ openRouterRouting: { sort: { by: 'custom-strategy' } } });
  });

  it('drops a price whose exponent form is not finite', () => {
    // "1e999" matches the numeric string shape but parses to Infinity, the same
    // non-finite value the numeric branch rejects.
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"max_price":{"prompt":"1e999"}}}}'),
    ).toBeUndefined();
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"max_price":{"prompt":"1e300"}}}}'),
    ).toEqual({ openRouterRouting: { max_price: { prompt: '1e300' } } });
  });

  it('strips unknown nested routing keys from structured objects', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"max_price":{"prompt":"0.000002","surge":1},"preferred_min_throughput":{"p50":100,"p95":200}}}}',
      ),
    ).toEqual({
      openRouterRouting: {
        max_price: { prompt: '0.000002' },
        preferred_min_throughput: { p50: 100 },
      },
    });
  });

  it('keeps only known price keys when every known key is valid', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"max_price":{"prompt":1,"completion":2,"image":3,"audio":4,"request":5,"bogus":6}}}}',
      ),
    ).toEqual({
      openRouterRouting: {
        max_price: { prompt: 1, completion: 2, image: 3, audio: 4, request: 5 },
      },
    });
  });

  it('keeps only known percentile keys', () => {
    expect(
      planWithCompat(
        '{"compat":{"openRouterRouting":{"preferred_max_latency":{"p50":1,"p75":2,"p90":3,"p99":4,"p100":5}}}}',
      ),
    ).toEqual({
      openRouterRouting: { preferred_max_latency: { p50: 1, p75: 2, p90: 3, p99: 4 } },
    });
  });

  it('drops a record whose only keys are unknown', () => {
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"max_price":{"surge":1}}}}'),
    ).toBeUndefined();
  });

  it('keeps a sort object whose present members all validate', () => {
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":"price","partition":null}}}}'),
    ).toEqual({ openRouterRouting: { sort: { by: 'price', partition: null } } });
  });

  it('ignores unknown sort keys instead of invalidating it', () => {
    expect(
      planWithCompat('{"compat":{"openRouterRouting":{"sort":{"by":"latency","bogus":true}}}}'),
    ).toEqual({ openRouterRouting: { sort: { by: 'latency' } } });
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

  it('keeps Vercel gateway routing and nothing else', () => {
    expect(
      planWithCompatAt(
        VERCEL_HOST,
        '{"compat":{"vercelGatewayRouting":{"only":["bedrock","anthropic"],"order":["anthropic"],"bogus":["x"]}}}',
      ),
    ).toEqual({
      vercelGatewayRouting: { only: ['bedrock', 'anthropic'], order: ['anthropic'] },
    });
  });

  it('applies the list rules to Vercel routing', () => {
    // Same list semantics as the OpenRouter keys: a mixed or padded list is not
    // silently shrunk, and a sibling left valid survives.
    expect(
      planWithCompatAt(VERCEL_HOST, '{"compat":{"vercelGatewayRouting":{"only":["bedrock",42]}}}'),
    ).toBeUndefined();
    expect(
      planWithCompatAt(
        VERCEL_HOST,
        '{"compat":{"vercelGatewayRouting":{"only":[""],"order":["anthropic"]}}}',
      ),
    ).toEqual({ vercelGatewayRouting: { order: ['anthropic'] } });
    expect(
      planWithCompatAt(VERCEL_HOST, '{"compat":{"vercelGatewayRouting":{"only":[]}}}'),
    ).toBeUndefined();
  });

  it('drops Vercel routing when it is not a record of usable keys', () => {
    expect(planWithCompatAt(VERCEL_HOST, '{"compat":{"vercelGatewayRouting":[]}}')).toBeUndefined();
    expect(
      planWithCompatAt(VERCEL_HOST, '{"compat":{"vercelGatewayRouting":"only"}}'),
    ).toBeUndefined();
    expect(
      planWithCompatAt(VERCEL_HOST, '{"compat":{"vercelGatewayRouting":{"bogus":["x"]}}}'),
    ).toBeUndefined();
  });

  it('drops Vercel routing on an endpoint that merely looks like the Vercel host', () => {
    // The transport tests `baseUrl.includes("ai-gateway.vercel.sh")`, which all
    // of these satisfy, so the reader has to be the one to refuse them.
    const lookalikes = [
      'https://ai-gateway.vercel.sh.example.com/v1',
      'https://proxy.ai-gateway.vercel.sh/v1',
      'https://notvercel.example/ai-gateway.vercel.sh/v1',
      'https://ai-gateway.vercel.sh.evil.com/v1',
    ];
    for (const baseURL of lookalikes) {
      expect(
        planWithCompatAt(baseURL, '{"compat":{"vercelGatewayRouting":{"only":["bedrock"]}}}'),
      ).toBeUndefined();
    }
  });

  it('keeps other compat keys when Vercel routing is dropped for the endpoint', () => {
    expect(
      planWithCompatAt(
        'https://ai-gateway.vercel.sh.example.com/v1',
        '{"compat":{"supportsStore":false,"vercelGatewayRouting":{"only":["bedrock"]}}}',
      ),
    ).toEqual({ supportsStore: false });
  });

  it('accepts the Vercel host without a scheme or with a port', () => {
    expect(
      planWithCompatAt(
        'ai-gateway.vercel.sh/v1',
        '{"compat":{"vercelGatewayRouting":{"only":["bedrock"]}}}',
      ),
    ).toEqual({ vercelGatewayRouting: { only: ['bedrock'] } });
    expect(
      planWithCompatAt(
        'https://ai-gateway.vercel.sh:443/v1',
        '{"compat":{"vercelGatewayRouting":{"only":["bedrock"]}}}',
      ),
    ).toEqual({ vercelGatewayRouting: { only: ['bedrock'] } });
  });

  it('treats a trailing-dot FQDN as the same host', () => {
    // `ai-gateway.vercel.sh.` is the DNS root-label form of the same name, so it
    // must not be dropped as if it were a lookalike — the transport's substring
    // check accepts it, and refusing here would silently discard routing.
    expect(
      planWithCompatAt(
        'https://ai-gateway.vercel.sh./v1',
        '{"compat":{"vercelGatewayRouting":{"only":["bedrock"]}}}',
      ),
    ).toEqual({ vercelGatewayRouting: { only: ['bedrock'] } });
    expect(
      planWithCompatAt(
        'AI-GATEWAY.VERCEL.SH/v1',
        '{"compat":{"vercelGatewayRouting":{"only":["bedrock"]}}}',
      ),
    ).toEqual({ vercelGatewayRouting: { only: ['bedrock'] } });
  });

  it('leaves OpenRouter routing ungated by the endpoint', () => {
    // Unlike the Vercel field, the transport applies this one for any endpoint,
    // so the reader must not quietly drop it on a non-OpenRouter host.
    expect(planWithCompat('{"compat":{"openRouterRouting":{"only":["DeepSeek"]}}}')).toEqual({
      openRouterRouting: { only: ['DeepSeek'] },
    });
  });

  it('carries both routing dialects at once without cross-talk', () => {
    expect(
      planWithCompatAt(
        VERCEL_HOST,
        '{"compat":{"openRouterRouting":{"only":["DeepSeek"]},"vercelGatewayRouting":{"order":["anthropic"]}}}',
      ),
    ).toEqual({
      openRouterRouting: { only: ['DeepSeek'] },
      vercelGatewayRouting: { order: ['anthropic'] },
    });
  });
});
