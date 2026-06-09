# 0006 — Small-model-first agent prompts

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

Most "AI agent" systems are designed around large models
(GPT-4o, Claude 3.5 Sonnet, etc.) and assume the model can
"figure out" what to do from a vague prompt. This is true for
large models, but it doesn't work for small (3–7B) models.

The project's design constraint is that **the system must work
with a small model**. A class teacher in a school that doesn't
have budget for hosted LLMs should be able to run a 4B model on
a local GPU and still get useful results.

The design choices that fall out of this constraint:

1. **Tool calls, not vibes.** Every number in an agent's output
   must be traceable to a tool call. Small models hallucinate
   numbers.
2. **Explicit output format.** Small models can't infer "what
   shape should the output be". We specify the format in
   `AGENTS.md`.
3. **Explicit tool patterns.** Small models don't know which
   tool to use. We specify the tool name and the call
   signature in `SOUL.md`.
4. **Model-tier routing.** Agents that need higher quality
   (e.g. `weekly-reporter`) are routed to the
   `high-quality` model; routine agents are routed to
   `low-cost`.
5. **Schema validation.** Tool call outputs are validated
   against a TypeBox schema. The small model might produce
   JSON with the right shape but wrong types; we catch that.

## Decision

Every agent's prompt is **designed and tested against a small
model** (Qwen 3.5 4B, GPT-4o-mini, etc.) first. The
`SMALL_MODEL_RULES.md` is the global rulebook that all agents
must follow.

The model tier is in the agent's YAML config, not in the
prompt. This lets the maintainer team swap the small model
for a large one without changing the prompt.

## Rationale

- **Inclusivity**: small models are 10–100x cheaper to run.
  A 4B model on a 6 GB GPU is a one-time cost; a hosted
  GPT-4o is ¥0.01 per call. For a class teacher recording 50
  events per day, that's ¥15/month per class.
- **Offline operation**: small models can run on a laptop with
  no internet. The teacher can work on a plane.
- **Latency**: small models respond in 1–2 seconds, large
  models in 2–5 seconds. The difference matters for
  interactive use.
- **Future-proof**: as small models get better, the same
  prompts work with even smaller models. We're
  future-proofing.

## Consequences

- **Good**: the system is cost-effective and can run offline.
- **Good**: the prompts are explicit, which makes them
  debuggable.
- **Bad**: explicit prompts are longer. The
  `SMALL_MODEL_RULES.md` is ~150 lines / ~3 KB; the
  per-agent `SOUL.md` is 100–200 lines; the total per-call
  system prompt is 4–8 KB. For a 4K-token context window
  this is significant.
- **Bad**: small models still get things wrong. The
  `validator` agent exists specifically to catch small-model
  errors.

## Alternatives considered

- **Large-model-only**: rejected because of cost and offline
  constraints.
- **Mixture of experts (MoE) with model selection per task**:
  considered, but the routing logic adds complexity. The
  `model_tier` field is the simplest possible routing.

## References

- [`config/SMALL_MODEL_RULES.md`](../../config/SMALL_MODEL_RULES.md)
- [`PROJECT_INTRO.md#design-principles`](../PROJECT_INTRO.md#design-principles)
- [`AGENT_AUTHORING.md#writing-the-prompt-for-small-models`](../AGENT_AUTHORING.md#writing-the-prompt-for-small-models)
