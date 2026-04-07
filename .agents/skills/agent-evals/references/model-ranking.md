# Model Ranking

Per-scenario model ranking and eval history. Updated continuously as new eval runs complete.

---

## web-onboarding-v3

**Linear:** LOBE-6627, LOBE-6672, LOBE-6810, LOBE-6819

**Baseline cases:**

```
fe-intj-crud-v1, pm-enfp-collab-v1, be-istp-reliability-v1, da-intj-automation-en-v1, designer-infp-creative-ja-v1
```

**Ranking (2026-04-07):**

| Tier         | Models                                 | Notes                                  |
| ------------ | -------------------------------------- | -------------------------------------- |
| Reliable     | gpt-5.4-mini, deepseek-v3.2            | Consistent pass across all case types  |
| Usable       | minimax-m2.5, glm-5                    | Pass baseline, may need escape hatches |
| Unstable     | claude-haiku-4.5                       | Passes sometimes, fails unpredictably  |
| Incompatible | groq/llama-4-scout, groq/llama-3.3-70b | Cannot follow complex tool protocols   |
