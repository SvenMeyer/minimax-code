# MiniMax Code fork — OpenRouter patches

Local fork of [`MiniMax-AI/minimax-code`](https://github.com/MiniMax-AI/minimax-code) carrying
OpenRouter support that upstream has not accepted. This file is the working note for that fork:
what is patched, what is still upstream-only, and how to rebase it.

Upstream-facing documentation lives elsewhere and is not duplicated here:

| Audience | Where |
| --- | --- |
| Maintainers (technical + validation) | Fork PR body — <https://github.com/SvenMeyer/minimax-code/pull/1> |
| Maintainers (proposal) | Comment on [#288](https://github.com/MiniMax-AI/minimax-code/issues/288) |
| Fork workflow + history | This file, `README-fork-openrouter.md` on branch `openrouter-preset` |

## Layout

- `~/src/minimax-code/` — the clone. `upstream` → MiniMax-AI, `origin` → SvenMeyer. This file is
  committed on `openrouter-preset` only; `main` stays a pure upstream mirror.
- `~/src/update-minimax-fork.sh` — outside the clone. Rebases the patch branch onto a release,
  pushes, rebuilds `dist/`.

Branch layout:

- `main` — a pure mirror of upstream. No local commits, ever. The update script resets it.
- `openrouter-preset` — upstream + the carried patches. This is the branch to run from.

## Running it

```bash
cd ~/src
./update-minimax-fork.sh              # latest stable vX.Y.Z tag
./update-minimax-fork.sh --main       # upstream main, ahead of the last tag
./update-minimax-fork.sh v0.6.5       # pin a specific release
node ~/src/minimax-code/dist/cli.js
```

The script stops (exit 2) only when a rebase conflicts, a carried commit would be lost, or the
remote patch branch moved independently (see [the force-push hazard](#the-force-push-that-destroyed-someone-elses-commit)).
Everything else — including a diverged `main` — is handled and reported.

## Current state

v0.6.5, branch `openrouter-preset`, seventeen code commits above upstream (plus the commit adding
this file). Rebased 2026-10-09;
the only conflicts were the import lines in `model-resolver-byok.ts` (upstream renamed
`MINIMAX_API_MODEL_CATALOG` to `minimaxApiModels`). Hashes before that rebase are in the issue comments.

| commit | what |
| --- | --- |
| `a9529cf` | OpenRouter preset appears in the picker (#289 item 1) |
| `a7fe150` | `compat.openRouterRouting` reaches the transport (#288) |
| `5102dbf` | reject mixed provider lists instead of filtering them |
| `9cb385c` | validate price strings; make `sort` atomic |
| `af2d6ad` | strip unknown nested routing keys (re-applies `4abfca2`) |
| `db6cc73` | finite-check exponent prices; `sort` honors the declared `string` contract; wire-level test added |
| `fd018ef` | correct the `openRouterRouting` contract comment |
| `f1a9dee` | reject empty provider slugs; document strategy trimming |
| `a2bbe15` | implement `compat.vercelGatewayRouting` (completes the maintainer brief) |
| `6eef167` | gate `vercelGatewayRouting` on an exact hostname; correct two overclaiming comments |
| `807ca26` | accept a trailing-dot Vercel FQDN; fix a stale gate comment; share the wire harness |
| `5bba6ab` | fold the base URL host to lower case before the endpoint gate |
| `eb1355b` | `readModelCompat` docstring: there are now two object-valued fields |
| `cf05e5f` | densify provider lists before the `string[]` predicate (sparse-array soundness) |
| `5851cef` | wire harness fails loudly when it captures no payload (test-only) |
| `8b07198` | trim provider list entries, matching the scalar rule |
| `6d27a14` | preset save persists only the chosen model, not the whole catalog (config.yaml was ~130 KiB with ~300 OpenRouter models) |

### Outstanding

- **Upstream comments posted, nothing further planned.**
  - **#288** — [the offer](https://github.com/MiniMax-AI/minimax-code/issues/288#issuecomment-5870900552),
    [the claim correction](https://github.com/MiniMax-AI/minimax-code/issues/288#issuecomment-5870917324),
    [the `vercelGatewayRouting` completion](https://github.com/MiniMax-AI/minimax-code/issues/288#issuecomment-5871123931).
    @Ralle1976 has claimed the work; awaiting maintainers. **No further action** — see below.
  - **#289** — [item 1 raised separately](https://github.com/MiniMax-AI/minimax-code/issues/289#issuecomment-5871122391),
    offering `2653f44` against the triage's own invitation ("PRs welcome, especially for the transport
    mapping"). This is the standalone raise; it was never only a mention inside the #288 comment.
  - **#289 items 2 and 3** are deliberately not implemented. Item 2 is pointed at as a lead, not a
    finding (`saveInput()` merges additively for an existing connection). Item 3 needs the maintainers'
    call on persisting an unverified provider before anyone writes it.
  - **2026-10-09, after 0.6.5** — [status + config-size finding + "how do we get this into main?"](https://github.com/MiniMax-AI/minimax-code/issues/289#issuecomment-6074335370).
    Awaiting the maintainers' answer on PR access vs. internal pickup.

### config.yaml size

Saving a models.dev preset used to copy the whole catalog into `custom_provider.<id>.models`. `6d27a14`
saves only the chosen model; add more by running the preset again on the same connection. The
existing `~/.minimax/config.yaml` was pruned to the five hand-added OpenRouter entries (backup:
`config.yaml.bak-before-prune-1791520404`). Pi does it differently: it keeps the catalog in code
(`models.generated.ts`) and the user file holds only overrides plus an `enabledModels` filter. A
catalog-backed custom provider would be the cleaner fix, but it touches the resolver, availability
and list paths, so it is too large to carry in a fork.

### One issue per comment, even from one branch

The preset fix (#289 item 1) and the routing work (#288) live in the same branch, which is fine, but
each was offered on **its own issue**, not bundled into one post. That is the convention the tracker
expects: a maintainer landing the preset mapping should not have to take the routing change with it,
and #289 would otherwise look unresolved while a fix sat in a fork. #289's triage had explicitly
invited "PRs, especially for the transport mapping", so the offer belonged there.

Item 3 on #289 was deliberately left out of both the patch and the offer, with the reasoning stated
publicly: persisting a provider that failed its connectivity test means the next session silently
loads an unverified provider. Printing the YAML that *would* have been written gets recoverability
without that risk — the maintainer's call, not mine to make by default.

### Read the whole thread before posting to it

**Status: no further action planned on #288** (decision 2026-09-29). The offer, the correction and the
`vercelGatewayRouting` completion are all posted; @Ralle1976 has claimed the work and the maintainers
have not responded. Nothing more is to be added unless they ask — do not re-post, do not re-offer, and
do not chase. This note exists so the reasoning survives if the thread is revisited later.

The first upstream comment was written, and posted, **without reading the comments between ours and
the present day**. That was a mistake, and only after posting did the full thread show:

- **`hetaoBackend` (COLLABORATOR) had already triaged it** — verified the producer/consumer
  asymmetry line-for-line, classified it `enhancement`, marked it ready for an implementer, and
  wrote a **six-point implementer spec** (2026-09-25).
- **`Ralle1976` (CONTRIBUTOR) had already claimed the work** — announcing a fork branch
  `fix/open-router-routing-compat` to be prepared along that outline (2026-09-26), two days before
  our comment.

So the post landed as a competing offer of already-claimed work. A follow-up was posted
acknowledging the claim and deferring to the maintainers, because leaving it as-is would have read
as ignoring a contributor who has standing in that tracker.

Two traps this exposed, both cheap to avoid:

- **Issue state is not issue context.** Checking `state`, labels and title tells you nothing about
  triage or claims. Read every comment, oldest to newest, before adding one.
- **Our own earlier comments are not the thread.** Both of ours were from 2026-09-22; everything
  decisive happened after. Re-reading only the parts we wrote recreates the same blind spot.

Useful outcome despite the misstep: the maintainer's spec independently converges on this patch's
design (strict per-key validation, drop wrong types, no blind passthrough), and it names one gap —
**the brief asks for `vercelGatewayRouting` too, which this patch does not implement.** That is the
one piece of scope the collaborator asked for that we have not delivered.
- **PR #1 is open for review, not for merging.** `main` is a pure upstream mirror, so merging
  there is pointless — see [Review workflow](#review-workflow).

### `2653f44` — OpenRouter preset in the picker

Fixes #289 item 1. `models.dev` tags OpenRouter as `@openrouter/ai-sdk-provider`, which
`resolveTransport()` did not recognise, so the preset was silently dropped from the picker.
Maps the provider **id** `openrouter` to `openai-completions` rather than matching on the npm
package, because other catalogs reuse that package.

### `cca57f1` — `compat.openRouterRouting` for BYOK providers

Fixes the config half of #288. The transport was already complete: `openai-completions.ts`
sends `model.compat.openRouterRouting` as the request `provider` field, and `OpenRouterRouting`
is fully typed in `@earendil-works/pi-ai`. The only gap was the config reader — `readModelCompat()`
accepts each `compat` key at its declared type, and this one was not among them, so the value was
dropped before reaching the model.

It is the one **object-valued** `compat` field, so it needs a structural reader rather than the
existing boolean/enum handling. The rule it follows is the one already documented on
`readModelCompat()`: drop a wrong-typed value rather than forward it, because pi treats any present
field as an explicit override and a truthy `"false"` would invert the intended behavior.

The shapes are handled differently on purpose — conflating them caused three review rounds:

| shape | a bad member means | behavior |
| --- | --- | --- |
| scalar (`zdr`, `data_collection`, …) | the key is not the declared type | drop that key |
| list (`only`/`order`/`ignore`/`quantizations`) | the provider set changes — a different routing decision | reject the whole list |
| `sort` object | the sort strategy changes | reject the whole object |
| record (`max_price`, percentiles) | one optional constraint stops applying; the rest apply as written | drop unknown/bad keys, keep valid ones |

- A **list** is one declared value, so a non-string element rejects it. `only: ["DeepSeek", 42]`
  is not silently shrunk to `["DeepSeek"]`, which would pin a different provider set than written.
- **Records iterate their known keys**, so an undeclared key is never forwarded:
  `max_price: {prompt, surge}` does not send `surge`, and `preferred_min_throughput: {p50, p95}`
  does not send `p95` (not in the declared `p50`/`p75`/`p90`/`p99`).
- A malformed key is dropped **without** invalidating its valid siblings.
- `sort` validates in both forms — bare string, and `{by, partition}`. The object form is
  **atomic**: a present member that fails validation drops the whole object, so a partial sort is
  never sent. Unknown `sort` keys are ignored.
- `max_price.*` takes a number or a **decimal** string; a string that does not parse as one
  (`"free"`, `"$5"`) is dropped rather than forwarded as a ceiling. Non-finite numbers are dropped.
- An object left with no usable keys is discarded entirely, so an empty `provider: {}` is never
  sent.

Now works as documented in the issue:

```yaml
custom_provider:
  openrouter:
    api: openai-completions
    options:
      apiKey: sk-or-v1-...
      baseURL: https://openrouter.ai/api/v1
    models:
      deepseek/deepseek-v4.1-flash:
        compat:
          openRouterRouting:
            only: ["DeepSeek"]
            allow_fallbacks: false
```

## Upstream issue status

| Issue | State | Covered here |
| --- | --- | --- |
| [#215](https://github.com/MiniMax-AI/minimax-code/issues/215) generic OpenRouter support | open | not ours (cktang88) |
| [#288](https://github.com/MiniMax-AI/minimax-code/issues/288) `compat.openRouterRouting` | open | **yes** — `cca57f1` + `69e6b0c`, full brief |
| [#289](https://github.com/MiniMax-AI/minimax-code/issues/289) provider onboarding | open | **partly** — item 1 (`2653f44`); item 3 deliberately not done |
| [#258](https://github.com/MiniMax-AI/minimax-code/issues/258) Z.AI token counter | closed | landed upstream |
| [#259](https://github.com/MiniMax-AI/minimax-code/issues/259) Z.AI coding-plan preset | closed | landed upstream |

### Not done, on purpose

**#289 item 3 — persist the provider when the connectivity test fails.** Deliberately skipped.
`onboarding.ts` `save()` discards the draft on failure, so a wrong model ID means hand-editing
`config.yaml`. Writing the entry anyway would mean the *next* session silently loads a provider
that was never verified. That is a UX call worth making explicitly rather than by default.

Note that **#289 item 2 is already upstream** — the picker now reads "select or add models" and
`saveInput()` calls `additiveProviderModels()`. Only item 3 genuinely remains.

**A TUI picker for routing schemes.** Not implemented, and it should not be bolted on. The model
picker already stacks provider, model and think-level; adding routing on top makes it worse. If it
is ever wanted, it belongs to a model-picker redesign.

## Submitting upstream

The repo is `pull_request_creation_policy: collaborators_only`, so no upstream PR is possible, and
CONTRIBUTING.md asks non-collaborators to open an issue instead. The working precedent is upstream
PR #178, where a maintainer ported an external contributor's commit that had been "offered for
maintainer adoption in the issue", linking a commit in that contributor's fork.

So the flow is: keep the patch public in this fork, get it reviewed here, and reference the commit
from the issue. Preserve authorship and state provenance in the comment — the maintainers route on
that.

## Review workflow

`pr-review-loop` drives the fork PR. Two things about this repo are unusual:

**Never merge PR #1 into `main`.** `main` is a pure upstream mirror that the update script
force-resets, so a merge there is pointless and would be undone on the next run. The PR exists
only to collect review findings and to give the maintainer a browsable diff.

**`@copilot review` in a comment does not work here** — it reaches `chatgpt-codex-connector`,
which answers with a Codex usage-limit error, and is *not* the PR reviewer. Request the reviewer
through the REST endpoint the skill uses, then let the wait script collect findings from every
surface:

```bash
gh api -X POST "repos/SvenMeyer/minimax-code/pulls/1/requested_reviewers" \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
python ~/.claude/skills/pr-review-loop/scripts/wait_copilot_feedback.py \
  --repo SvenMeyer/minimax-code --pr 1 --request
```

The script also reads session-stored findings, which the REST comments API misses. A
`Findings: None` overview does not mean clean.

Review history — six rounds so far, and the reviewer was right more often than I was:

- **Round 1** (published thread): mixed provider lists were filtered rather than rejected
  (`only: ["DeepSeek", 42]` → `["DeepSeek"]`), contradicting the reader's own rule. Fixed in
  `ef3f70a`.
- **Round 2** (`store_comment` ×2 + `previously_missed`): both real. `readNumberish` forwarded any
  non-empty string as a price (`"free"`, `"$5"`), and `readRoutingSort` was not atomic despite
  documenting that it was. Fixed in `739e637`.
- **Round 3** (`store_comment` ×2, `body: null`): re-raised the record readers. I rejected it
  with the claim "unknown keys are never forwarded to OpenRouter" — **that was wrong**. True at
  top level, false for the nested records, which iterated all entries: `max_price {prompt, surge}`
  forwarded `surge`. My framing was also a false binary (keep-valid vs reject-all); the actual
  answer was "keep valid *known* keys, drop unknown ones".
- **Round 4** (`store_comment` ×3): all three real, all fixed in `40e82c1`.
  1. `"1e999"` matched the numeric-string shape but parses to `Infinity`, bypassing the documented
     finite-number rule.
  2. `sort`/`by`/`partition` were narrowed to the documented examples, but the contract types them
     as plain `string` — drift from the transport this reader mirrors.
  3. The tests never left the config reader, so a downstream regression would have stayed green
     while routing was absent from the request. A wire-level assertion through the captured
     `openai-completions` payload now covers it, verified to fail when the field is dropped.
- **Round 5** (`store_comment` ×1): real, fixed in `dcab04f`. The contract comment claimed the
  field is "ignored by other providers". It is not — `openai-completions.ts` attaches it whenever
  present, with **no endpoint check**, unlike the Vercel gateway routing three lines below it which
  gates on the base URL. The comment now states what the transport actually does.
- **Round 6** (`store_comment` ×2, `body: null`): fixed in `dca3d83`. Both bodies were null and the
  prose was not in the action logs either, so the two locations had to be assessed directly.
  1. `readStringList` accepted an empty/whitespace-only provider slug (`only: [""]`), forwarding a
     list that cannot match anything — laxer than `readStrategy`, which rejects the empty string.
  2. `readStrategy` trimmed but its comment claimed it only rejected the empty string. Behaviour
     kept, comment corrected.
- **Round 7** (published inline, ×1 **+** a `store_comment` at the same site): **rejected with
  evidence, no code change.** The claim that the bundled catalog has no `openrouter` provider is
  false — see below. The only thing it legitimately surfaced is that this patch is a mapper, not an
  injector.
- **Round 15** (published inline ×1, high severity): **rejected with evidence, no code change.** Claimed
  an unset routing config emits `provider: {}` rather than `undefined`, so the absence assertions "fail".
  Measured instead: the payload has no `provider` key at all (`hasOwn=false`) on both hosts, and the
  tests pass. The claim conflated `getCompat()`'s resolved `{}` default with the **raw** `model.compat`
  that `openai-completions.ts:619` actually reads. The review's own overview said "Approval
  recommended … no unresolved issues" while listing this item as Open — the two halves disagree.
- **Round 14** (`store_comment` ×1, zero published inline comments): real and **reachable**, fixed in
  `24b2d74`. A non-empty padded list entry (`only: [" DeepSeek "]`) passed the guard unchanged and
  matches no provider exactly, so the routing was silently ineffective — committed by the guard that
  exists to prevent it. `readStrategy` had trimmed scalars since round 6 for the same reason; the list
  path was the odd one out three lines away.
- **Round 13** (`store_comment` ×3, zero published inline comments): real, fixed in `6b83fd7`. All
  three were negative routing assertions reading from a payload initialised to `{}` — an absent field
  and an uncaptured payload are the same value, so they passed for the wrong reason. Demonstrated:
  with capture disabled, three positives failed and **every negative passed**. The harness now throws
  when nothing was captured, and the same experiment fails all six.
- **Round 12** (`store_comment` ×1, zero published inline comments): real, fixed in `3297b15`.
  `value.every()` skips holes, so the `value is string[]` predicate was unsound — a sparse list passed
  the guard and would have serialised a hole as `null` on the wire. Soundness, not a live path: JSON
  cannot carry a hole. The repo's own `no-sparse-arrays` lint rule errors on the literal, so the test
  allocates and leaves an index unset.
- **Round 11** (`store_comment` ×1, zero published inline comments): real, fixed in `290cb0e`.
  The `readModelCompat` docstring still called `openRouterRouting` "the one object-valued field" —
  false since `vercelGatewayRouting` was added, and misleading to anyone looking for structural
  readers.
- **Round 10** (published inline ×1 + `store_comment` ×2): real, fixed in `b94d74c`. The reader
  lowercased the host before comparing but the transport's check is case-sensitive, so
  `https://AI-GATEWAY.VERCEL.SH/v1` was approved by the reader and then silently dropped on the wire.
  The uppercase reader test added in round 9 therefore asserted nothing — a false green.
- **Round 9** (`store_comment` ×3): all real, fixed in `2ad9e83`. The hostname gate had a false
  negative — a trailing-dot FQDN is the same host and was being dropped, silently discarding routing
  the user did configure. The `readVercelGatewayRouting` comment had gone stale in the worst
  direction, framing the gate as redundant. And the two wire harnesses were near-duplicates.
- **Round 8** (published inline ×1 + `store_comment` ×2): all real, fixed in `6bbec38`. The
  transport's Vercel endpoint check is `baseUrl.includes("ai-gateway.vercel.sh")` — a substring
  test, so `ai-gateway.vercel.sh.evil.com` and even a path containing the string match. The reader
  now gates on an exact parsed hostname, so the Vercel-only body fields can only be produced for a
  real Vercel endpoint. Two comments of mine were also overclaiming and are corrected.

### When a stored finding has no body

`body: null` means the ensemble log kept only type/severity/location. There is no API surface that
returns the prose — the action logs do not carry it, and the session page is a UI transcript.
Assess the location yourself and say in the PR comment that you did so and why; do not present a
guess as if it were the reviewer's words. If the intent turns out to be different, revisit.

### A store comment with `body: null` is not the whole story

Round 7 also produced a **published inline comment**, and it was flatly wrong: it claimed the
bundled `models-dev-catalog.json.gz` has no `openrouter` provider and that offline/first-run users
therefore cannot select OpenRouter, asking for the snapshot to be regenerated or the patch split.

The premise is false, and verifiably so without leaving the repo:

```
top-level keys    : ['version', 'source', 'updatedAt', 'etag', 'catalog']
'openrouter' in d : False     <- what a top-level membership check sees
in d['catalog']   : True      <- 356 models, api https://openrouter.ai/api/v1
```

The gzip is wrapped; providers sit under `catalog`. A top-level `'openrouter' in data` check
reproduces the reported conclusion exactly — I made the same mistake on my first pass, which is how
I recognised it. The file is tracked, unmodified, and byte-identical to `upstream/main` at `v0.5.8`.

Rejected on the thread with that reproduction, no code change. The skill's rule applies: verify
empirically, then reject **with the evidence on the record**.

What the finding did surface legitimately is scope: `resolveTransport()` maps an entry only when it
is present, so this patch is a mapper and will not conjure OpenRouter into a catalog lacking it.
That is intentional — the catalog is upstream data — and it is the reason to fix the mapping rather
than bundle an entry.

### A vacuity fix is what makes a rebuttal provable

Round 13 found the absence assertions were passing vacuously. Round 15 then accused those same three
assertions of failing, and the answer could only be settled **because** round 13 had already made them
meaningful: the harness now throws when nothing is captured, so `hasOwn=false` is a measured result
rather than an initialiser default. Without that fix the rebuttal would have been an argument about
reading comprehension; with it, it is a measurement.

Fixing an unfalsifiable test is not only about catching future bugs — it is what lets you defend a
correct one. Two of the fifteen rounds were false positives, and both were rejected on evidence rather
than opinion.

### Do not read convergence off severity

Twice now the call was made that severity had decayed and the loop could stop — after round 7 and
after round 13 — and twice the next round found a **reachable** defect (the case-sensitivity
mismatch at round 10, and the untrimmed list entry at round 14). A run of low-severity rounds is not
evidence that the next one will be low-severity, because each fix creates the surface the next
finding lands on.

Judge convergence on a round that comes back *empty*, and on nothing else. "The last few were only
docs" is a feeling, not a signal.

### Apply a rule you just established to the code next to it

Round 6 established, with a paragraph of reasoning, that a padded scalar must be trimmed rather than
forwarded verbatim or rejected. Round 14 found the list path three lines away still forwarding padded
values verbatim. The reasoning transferred unchanged and simply was not applied.

When a fix encodes a rule, grep for the sibling call sites before moving on. The inconsistency is the
tell: two adjacent paths handling the same class of input differently, with no stated reason.

### Absence assertions need a positive control

Round 13's finding is the test-side half of round 10's: `expect(x).toBeUndefined()` cannot tell "the
value is correctly absent" from "nothing was captured at all". A negative assertion is only
meaningful if the harness proves something *did* happen.

The rule that closed it: **every absence assertion needs a positive control** — a captured payload,
a fired callback, a non-empty result. `routingPayloadFor` now throws if `onPayload` never assigned,
so the check is structural rather than something a future test author has to remember.

Across the loop, "verify the test can fail" has found the bug four times, twice for assertions that
could not fail, and it has never come back empty when the test was mine.

### Soundness fixes still count, but say so

Round 12 was a genuine defect in a guard (`every` skips holes, so the predicate lied about its input)
that is **not reachable** from persisted config, because JSON cannot express a hole. It was right to
fix — a wrong predicate is wrong — but the PR comment says plainly that it is soundness rather than a
live path, and how that was established. Overstating an unreachable defect as an exploit is its own
kind of comment rot, the same failure this patch keeps correcting.

### Superlatives in comments rot fastest

Four rounds (5, 8, 9, 11) caught a comment of mine that had outlived the code it described, and in
three of those my own later commit caused the drift. The recurring shape is a **superlative**: "the
one object-valued field", "cannot reach another gateway", "ignored by other providers". Each was
true when written and quietly false after the next change.

Treat a superlative in a contract comment as a tripwire: whenever the surrounding field set or an
adjacent layer changes, re-read every "the one", "the only", "cannot", and "ignored by". They are
invisible to the compiler and to the tests, and a maintainer reads them as the contract.

### The newest code is where the defects are

Rounds 8, 9 and 10 each found a defect in the code added at the previous step — a loose check
inherited from the transport, an edge case the new gate missed, and then a test that could not fail.
Nothing found after round 7 touched the older parts of the patch, which had been stable for several
rounds. That is the expected shape of a review loop on a layered fix, and it is why the loop should
be run to a *converged* state rather than stopped when the diff starts to look familiar.

**A false-green assertion is worse than no assertion.** The mixed-case test passed `2ad9e83` while
the routing it claimed to preserve was silently dropped, because it stopped at the reader and the
reader was the half that was wrong. Every test whose whole purpose is "this value reaches the other
side" must be verified by breaking the path and watching it fail — the practice used throughout this
patch (`disable the field, confirm red, restore`).

### A gate written defensively inherits its own edge cases

Round 9 caught a defect that round 8's fix *introduced*, which is a different shape from the earlier
rounds: rejecting a loose substring check by adding a stricter check in another layer means the
stricter check now carries the burden — including the hostname semantics the original author never
had to think about.

The specific miss: `https://ai-gateway.vercel.sh./v1`. One trailing dot is the DNS root label and
names the same host, so it is not a lookalike. The gate dropped it, silently discarding the user's
routing — the exact failure this whole patch series has been eliminating, caused by the code meant to
prevent it.

When replacing a permissive check with a strict one, enumerate what the *permissive* version
accepted that was legitimate, not only what it accepted that was wrong. The strict version has to
keep the first set.

### Comments get written more confidently than the code warrants

Rounds 5 and 8 both caught the same personal failure mode, and it is worth naming: a comment
asserting a *guarantee* the code does not provide.

- Round 5: "Ignored by other providers" — the transport attaches the field for any endpoint.
- Round 8: "cannot reach another gateway" — the endpoint check is a substring test.
- Round 8 also: "forwarded verbatim to OpenRouter" — the value is filtered, and not endpoint-checked.

A maintainer reads those comments as the contract, so an overclaim is worse than no comment. Describe
what the code does, and where a guarantee genuinely exists say which layer enforces it. The Vercel
entry is now correct *because* the reader enforces the hostname — that is a true statement about a
real check, not a hopeful one.

**The general lesson: do not assume a finding is right because the previous six were.** Rounds 1–6
were all real; this one was not, and accepting it would have meant regenerating a correct asset and
splitting a working patch for no reason. Verify each claim, in both directions.

### Loop terminal state

**Reached at round 15, on the skill's second condition.** The latest review is dated to the current
HEAD (`24b2d74`), its single finding was rejected with a documented reply, and **zero code changes**
followed — so the next review would see an identical diff and further rounds are noise.

The condition first held at round 7 and was then **deliberately given up**, which is worth
understanding rather than treating as a contradiction: the request to add `vercelGatewayRouting` was
planned scope, not a response to review, and it changed code — so a fresh review became required and
the loop restarted at round 8. A terminal state only holds while the diff is frozen; completing
agreed scope always reopens it.

Two false positives were rejected along the way (rounds 7 and 15), both on measurement rather than
opinion. Both threads are left **unresolved on purpose**, unlike round 4's. Round 4 was resolved
because it was fixed; resolving a thread we *disagree* with would hide the evidence and pre-empt the
maintainer's arbitration. Reply-on-the-record is the required action; resolving is not.

Nothing is merged: PR #1 exists to collect review and show a diff, and merging into the fork's
`main` would be undone by the next update run.

### An OpenRouter-only field goes to every provider

Worth deciding on, not yet changed. Because the transport does not gate
`openRouterRouting` by endpoint, setting it on a `custom_provider` that points at a non-OpenRouter
gateway puts a `provider: {...}` object into that gateway's request body. Most OpenAI-compatible
endpoints ignore unknown fields; a strict one could reject the request.

Our reader could gate it, mirroring the Vercel precedent:

- **by base URL** (`openrouter.ai`) — robust to what the provider is named, but a heuristic, and a
  proxy on another host would stop receiving routing;
- **by provider id** (`openrouter`) — exact, and matches how the preset is keyed, but silently drops
  routing for a differently-named `custom_provider` pointed at OpenRouter.

Left alone for now: it is a behaviour change with a real tradeoff, the field is documented as
OpenRouter-specific, and the round-5 finding was about the comment being untrue rather than the
behaviour being wrong. Decide deliberately rather than by reflex.

### Don't brake the review loop early

At round 3 I applied the skill's pathological-loop brake and stopped. That was **premature**:
round 4 found three genuinely new issues, including the test-depth gap that mattered most — none
were duplicates of earlier rounds. A re-raised point does not imply the next round will be empty.
The brake is for oscillation on the same code, and it should be a conclusion drawn from a *clean*
round, not from annoyance at a repeat.

Two related traps now on the record:

- **`eslint --fix` on a whole directory drags in unrelated formatting churn.** One revision of
  `40e82c1` picked up `model-ref.ts` / `model-ref.test.ts` line rewrapping. Lint only the files you
  actually changed, and check `git diff --cached` before committing.
- **A test that passes is not a test that works.** The wire-level assertion was verified by
  disabling the field in `readModelCompat()` and watching it fail, then restoring. Do that for any
  test whose whole purpose is "this value reaches the other side".

### The force-push that destroyed someone else's commit

A `copilot-swe-agent` commit `4abfca2` had **already fixed** the round-3 bug, with a test. The
next force-push overwrote it and the commit became an orphan in `.git`.

`--force-with-lease` cannot prevent this. The script fetches immediately before pushing, so the
value it leases against is always the current remote tip and the lease always matches. It guards
against *concurrent* updates, not against a remote commit fetched moments earlier in the same run.

Fixed by recording what we last pushed in `refs/minimax-fork/pushed/<branch>` and only
force-pushing when the remote tip equals that marker — i.e. only when rewriting our own history.
Otherwise the script refuses, names the foreign commits, and prints the explicit override. Verified
in a sandbox: a foreign commit is preserved (exit 2); a legitimate rebase still force-pushes.

The fix was re-applied as `7a62cd8` with the agent's authorship preserved via `Co-authored-by`.

Copilot stores findings in the session without publishing them, so `Findings: None` on the
overview is not a clean result — the wait script is the source of truth, because it reads the
`CCR Agent: Comment stored` rows the REST comments API misses. Where a stored record has
`body: null`, the prose may exist only in the session UI; the location and severity are still
enough to go read that code.

## Notes on the update script

Four bugs, all found the hard way. Keep them in mind before "simplifying" any away.

**Never force-push the patch branch someone else may have touched.** The script fetched, then
force-pushed with `--force-with-lease=<branch>:<freshly-fetched-tip>`. Because the lease value was
fetched moments earlier in the same run, it always matched — so the push silently discarded a
`copilot-swe-agent` commit (`4abfca2`) that had already fixed a bug I was about to be told about.
A lease guards against *concurrent* updates, never against one you just fetched yourself.

It now records its own last push in `refs/minimax-fork/pushed/<branch>` and force-pushes only when
the remote tip equals that marker. A fast-forward needs no force at all. Anything else stops with
the foreign commits listed and the override printed. Both paths are sandbox-tested.

**A diverged `main` is not necessarily real work.** Upstream force-pushed a rewritten 0.5.4
release commit, so the fork's `main` held `9639594 chore: bump version to 0.5.4` where upstream had
`135584a chore: bump version to 0.5.4 (#354)` — the same two-line bump, different SHA.
`git merge-base --is-ancestor` failed, the script hit its bail-out, and the run died *before* the
branch push and the build. `dist/` was left stamped at 0.5.4 while the source was a month newer.

The script now distinguishes the two cases with `git cherry`: a leading `-` means an equivalent
patch already exists upstream, which is a rewritten commit, not work. Only genuine divergence stops
the run, and it warns instead of dying. A failed `main` sync is also non-fatal — an unrelated
branch must not gate the patch delivery the script exists to perform.

**A missing build stamp means "unknown", not "current".** `scripts/build.mjs` does
`rmSync(dist, { recursive: true })` and wipes `.source-commit` along with everything else. The
stamp is the only record of which commit produced `dist/`, and a release often keeps the same
version string, so version alone cannot detect a stale binary. Treating a missing stamp as
up-to-date silently blessed unverified builds — the exact failure above. It now rebuilds.

**`die` must be defined before the argument loop.** It was declared after the loop that calls it,
so a bad argument printed `die: command not found` (exit 127) instead of the helpful usage message.

## Housekeeping

- `refs/heads/pr/openrouter-preset` (at `71f9082`) is a stale duplicate of the preset patch, left
  over from the PR-prep workflow. Nothing references it; delete it when convenient.
- `refs/minimax-fork/pushed/openrouter-preset` is the force-push marker. Deleting it makes the next
  divergent push stop for manual confirmation, which is the safe failure direction.

## Verification

Run before pushing:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
npx vitest run --config vitest.oss.config.mjs packages/local-runtime-v2/src/service/model-system/
pnpm test:byok
pnpm build && node dist/cli.js --version
```

A bare `npx vitest run <file>` fails with `Failed to resolve entry for package "@mavis/shared"` —
that is a missing install or a missing build, not a code problem. The repo's `verify` profiles
(`pnpm verify --list`) are the upstream CI equivalent.
