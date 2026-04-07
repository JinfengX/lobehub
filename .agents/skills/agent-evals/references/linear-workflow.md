# Linear Eval Results Workflow

How to write, publish, and follow up on eval result issues in Linear.

## Tool Priority

- **Preferred**: Linear MCP (`mcp__linear-server__*`) — if user has configured the MCP server, use it for all operations (create issue, add comment, update status, add relation)
- **Fallback**: [Linear CLI](https://github.com/schpet/linear-cli) (`linear` command) — third-party CLI, use when MCP is unavailable

Check MCP availability first. All examples below show both approaches.

## 1. Writing the Result Issue

Title format: `Eval: <scenario> — <what was tested or changed>`

Examples:

- `Eval: web-onboarding-v3 — baseline all models`
- `Eval: web-onboarding-v3 — fix phase3 tool hint regression`

Structure the issue body with these sections:

```markdown
## Context

- Scenario: `<scenario-name>` (e.g. `web-onboarding-v3`)
- Model: `<model>` (e.g. `gpt-5.4-mini`)
- Cases: baseline / all / specific case IDs
- Prompt changes: brief description of what changed (if iterating)

## Results

| Model            | Status  | Score | finishOnboarding | Fields | Tokens | Cost    | Notes |
| ---------------- | ------- | ----- | ---------------- | ------ | ------ | ------- | ----- |
| gpt-5.4-mini     | ✅ PASS | 7/10  | ✓                | ✓      | 24.3k  | $0.0035 | ...   |
| deepseek-v3.2    | ✅ PASS | —     | ✓                | ✓      | 24.4k  | —       | ...   |
| claude-haiku-4.5 | ❌ FAIL | —     | —                | ✗      | —      | —       | ...   |

## Baseline Comparison

> Compare with previous version (link to prior eval issue)

| Model         | Previous     | Current      | Change |
| ------------- | ------------ | ------------ | ------ |
| gpt-5.4-mini  | STALL        | ✅ PASS 7/10 | ⬆      |
| deepseek-v3.2 | ✅ PASS 7/10 | ✅ PASS      | —      |

## Findings

- Bullet list of observations, regressions, or improvements
- Link to specific prompt diff if applicable

## Recommendations

- Actionable next steps based on findings
```

## 2. Publishing to Linear

### Via MCP (preferred)

```
mcp__linear-server__create_issue:
  title: "Eval: web-onboarding-v3 — baseline all models"
  description: <issue body>
  teamId: <LOBE team ID>
  labelIds: ["claude code"]

mcp__linear-server__create_issue_relation:
  issueId: <new issue ID>
  relatedIssueId: <parent tracking issue ID>
  type: "related"
```

### Via CLI (fallback)

```bash
cat > /tmp/eval-results.md << 'EOF'
<issue body>
EOF

linear issue create \
  --title "Eval: web-onboarding-v3 — baseline all models" \
  --description-file /tmp/eval-results.md \
  --team LOBE

linear issue relation add LOBE-XXXX related LOBE-6672
```

Parent issue relationships per scenario are tracked in [model-ranking.md](model-ranking.md). Always `related` link new eval issues to the scenario's parent issues.

## 3. Follow-up

Follow-up is done as **comments on the scenario's parent tracking issues**, not as separate issues. This keeps the full eval history threaded in one place.

### Comment on parent issues

After publishing a new eval result issue, add a follow-up comment to each related parent tracking issue (e.g. LOBE-6672) summarizing what changed. The comment should include:

- Link to the new eval result issue
- Key ranking changes (which models moved tiers)
- Regressions or improvements vs previous run
- Actionable next steps

Example comment format (based on actual LOBE-6672 follow-ups):

```markdown
## V3 + Escape Hatch: 7-model Matrix (2026-04-07)

**Based on**: V3 prompt + `<next_actions>` escape hatch fix (LOBE-6810)
**Eval issue**: LOBE-XXXX

### Summary

- **4/7 PASS** (gpt-5.4-mini, deepseek-v3.2, minimax-m2.5, glm-5)
- glm-5 first pass ever (V2 FAIL 4/10 → V3+escape hatch PASS)
- claude-haiku-4.5 regression (V3 PASS → V3+escape hatch FAIL)

### Ranking Changes

| Model            | Previous Tier | Current Tier |
| ---------------- | ------------- | ------------ |
| glm-5            | Unstable      | Usable ⬆     |
| claude-haiku-4.5 | Usable        | Unstable ⬇   |

### Next Steps

- Investigate haiku regression (may need conditional escape hatch injection)
- Consider removing groq models from onboarding support list
```

### Via MCP

```
mcp__linear-server__create_comment:
  issueId: <parent issue ID, e.g. LOBE-6672>
  body: <comment body>
```

### Via CLI

```bash
cat > /tmp/eval-comment.md << 'EOF'
<comment body>
EOF

linear issue comment add LOBE-6672 --body-file /tmp/eval-comment.md
```

### Link regressions

If a previously passing case now fails, create a separate bug issue and `blocks` link it:

```bash
# MCP
mcp__linear-server__create_issue: title "Regression: <case-id> fails after <change>"
mcp__linear-server__create_issue_relation: type "blocks"

# CLI
linear issue create --title "Regression: <case-id> fails after <change>" --team LOBE
linear issue relation add LOBE-YYYY blocks LOBE-XXXX
```

### Close resolved issues

If an eval run confirms a fix for a tracked issue, comment the result and update status:

```bash
# MCP
mcp__linear-server__create_comment: issueId <ID>, body "Confirmed fixed in eval run LOBE-ZZZZ"
mcp__linear-server__update_issue: id <ID>, stateId <Done state ID>

# CLI
linear issue comment add LOBE-XXXX --body "Confirmed fixed in eval run LOBE-ZZZZ"
linear issue update LOBE-XXXX --status "Done"
```

### Update model-ranking.md

After publishing and commenting, update [model-ranking.md](model-ranking.md) if ranking changed:

- New or updated ranking table under the scenario section
- Updated date
- New baseline cases if added

### Iterate

If cases still fail, return to the [eval iteration workflow](../SKILL.md) (diagnose → fix → re-run → baseline regression).
