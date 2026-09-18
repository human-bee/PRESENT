# Jev / TypeSafe AI: primary-source research (2026-09-18)

## Identification

The release is **Jev**, TypeSafe AI's first “System One Model,” announced publicly on 15 September 2026. The creator is **Diogo Almeida**, founder/CEO of TypeSafe AI and former OpenAI researcher. TypeSafe's own launch post says Almeida helped build the instruction-following methods that became research behind ChatGPT. Almeida's launch post on X describes himself as having “co-invented ChatGPT”; that contribution wording is self-reported and should not be expanded beyond the official sources.

- Official launch: [TypeSafe AI: Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Official docs: [TypeSafe AI documentation](https://docs.typesafe.ai/)
- Official X launch post, verified through the X Official API: [@CompleteSkeptic, 15 Sep 2026](https://x.com/CompleteSkeptic/status/2099925682726002904)
- Official organization and SDK repositories: [typesafe-ai on GitHub](https://github.com/typesafe-ai/), [Python SDK](https://github.com/typesafe-ai/typesafe-sdk-python), [TypeScript/JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)

## What it is

Jev is a hosted decision model, not a chat or code-generation model. The request supplies a `state` (text, JSON, or other structured program state) and one or more typed questions. The response contains constrained decisions and probabilities that application code can consume directly, without asking an LLM to generate JSON and then parsing/repairing it.

The three official primitives are:

| Primitive | Meaning | Returned fields |
| --- | --- | --- |
| `Choice` | Pick one item from a fixed option map | `choice`, `probabilities`, `confidence` |
| `Score` | Place state on an ordered rubric | `score`, `legend`, `probabilities`, `confidence` |
| `Noul` | Probability that a statement is true | `noul` from 0 to 1 |

Questions sharing a state can be mixed in one request. TypeSafe says they are evaluated independently and in parallel, so adding questions barely changes response time and avoids context-rot. Complex judgments should be decomposed into atomic questions and recombined in ordinary code.

## Technical mechanism and claims

TypeSafe attributes Jev's behavior to a new model architecture, a parallel sampler, and **Reinforcement Learning for Calibrated Decisions (RLCD)**. Existing LLMs sample output tokens sequentially; Jev emits all typed decision distributions in parallel. Its output space is fixed by the supplied schema, so the model cannot return a value outside the options/levels defined by the caller. This is the basis for TypeSafe's “no type errors” claim, not evidence that the model is always semantically correct.

The official launch post claims 70 ms–500 ms end-to-end service response time, $0.042 per million input tokens, and free output tokens. The X launch post advertises broader 20–200x speed and 40–400x cost improvements. TypeSafe explicitly cautions that its workflow-eval speedups (including 193.6x faster and 444.6x cheaper on the homepage) are high-end task-specific comparisons and use company-built workflows. Treat these as vendor claims until benchmarked against the target workload.

The model does not generate strings. If a workflow needs text (for example, typing into a form), a separate small generative model or deterministic code must produce it; Jev can choose whether/where/how to act. The official docs also recommend confidence thresholds: act automatically for low-risk high-confidence decisions, ask for confirmation or review at medium confidence, and route low-confidence/high-risk decisions to a person or fallback.

## Direct API and integration surface

The official HTTP endpoint is:

```text
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```

Minimal request shape from the official quick start:

```json
{
  "state": {"document": "I was charged twice. Please fix this ASAP."},
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "Payment or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions"
      }
    },
    "is_urgent": {
      "type": "noul",
      "instructions": "Does the message convey urgency?"
    }
  }
}
```

Official quick-start docs: [HTTP quick start and response example](https://docs.typesafe.ai/introduction/quickstart). The same page documents `pip install typesafe-sdk`, Python `TypeSafeClient.system_one(...)`, and the official JavaScript package is documented in [typesafe-sdk-js](https://github.com/typesafe-ai/typesafe-sdk-js) (`npm install @typesafe-ai/sdk`, Node.js 20+):

```ts
import { choice, TypeSafeClient } from '@typesafe-ai/sdk';

const client = new TypeSafeClient();
const response = await client.systemOne({
  state: { document: 'I was charged twice. Please fix this ASAP.' },
  questions: {
    category: choice('What is this ticket about?', {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});
console.log(response.answers.category.choice);
```

The official [primitives documentation](https://docs.typesafe.ai/primitives) covers question design, parallel fan-out, structured-state paths, and the rule that dependent questions require a second request only when code cannot construct the next state/question set without the first answer. The [confidence guide](https://docs.typesafe.ai/confidence) gives example gates such as `confidence < 0.5` → human review and higher thresholds for destructive actions.

## Relevance to PRESENT / generative UI

Jev is relevant as a **fast decision layer around** a generative UI or realtime agent, not as the component that renders UI. Candidate uses are: classify a voice/user intent into a bounded tool/action choice; score whether a streamed request is complete, safe, or needs clarification; choose among canvas operations or steward routes; gate whether a low-risk UI update can auto-apply; and run several independent route/urgency/confidence checks against one transcript or canvas state in one call. Keep natural-language generation, TLDraw action construction, and final UI patches in the existing LLM/steward path. Use Jev's typed result and confidence to select or gate those paths.

For the existing queue architecture, the cleanest experiment is a server-side adapter in the conductor/steward decision boundary: send a compact, redacted structured state plus a small fixed action set; log Jev latency, selected option, full probabilities, confidence, fallback rate, and downstream visible success; then compare against the current model on the same replay corpus. Do not put the API key in the browser or voice client. Do not treat a high-confidence choice as permission for irreversible external actions without the product's existing confirmation boundary.

## Current access and uncertainties

TypeSafe's launch says Jev is in early access/waitlist. The official SDKs and docs are public, but production access requires a TypeSafe API key. TypeSafe has not published weights or a self-hosting path in the official materials reviewed. The RLCD training details, model size, training data, and independent accuracy benchmarks remain undisclosed. The vendor's “calibrated” probabilities should be validated on PRESENT's own labeled/replay data before thresholds are trusted.

## Sources checked

Primary sources were used for the identification and API details: TypeSafe's launch post, TypeSafe's docs, TypeSafe's GitHub organization/SDK repositories, and Diogo Almeida's X posts retrieved through the X Official API. Community pages and browser-agent demos were treated as discovery only and are omitted from the factual claims above.
