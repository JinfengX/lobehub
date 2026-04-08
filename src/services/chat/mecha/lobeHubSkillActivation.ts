import { LobeHubIdentifier } from '@lobechat/builtin-skills';
import type { RuntimeInitialContext, RuntimeStepContext } from '@lobechat/types';

/**
 * Determine whether the LobeHub builtin skill is "active" for the current
 * request — meaning the model has (or will have) access to the `lh` CLI and
 * therefore needs the agent identity context injected.
 *
 * The LobeHub skill can be activated through three independent paths, all of
 * which must be considered:
 *
 * 1. **Persisted** — `agentConfig.plugins` contains `LobeHubIdentifier`.
 *    Activated for every request to this agent.
 *
 * 2. **Slash-menu selected** — user typed `/lobehub` (or similar) in the input
 *    editor for this single request. Captured into
 *    `initialContext.selectedSkills` before send.
 *
 * 3. **Model-driven** — model called `activateSkill('lobehub')` mid-step.
 *    Accumulated into `stepContext.activatedSkills` and persists for the rest
 *    of the conversation.
 *
 * Pure function — no store / network access — so it's trivial to unit test.
 */
export const isLobeHubSkillActive = (params: {
  activatedSkills?: RuntimeStepContext['activatedSkills'];
  plugins?: string[];
  selectedSkills?: RuntimeInitialContext['selectedSkills'];
}): boolean => {
  const { plugins, selectedSkills, activatedSkills } = params;

  // Path 1: persisted in agent config
  if (plugins?.includes(LobeHubIdentifier)) return true;

  // Path 2: slash-menu selected for this request
  if (selectedSkills?.some((s) => s.identifier === LobeHubIdentifier)) return true;

  // Path 3: model-driven mid-step activation accumulated across steps
  // NOTE: StepActivatedSkill uses `id` (not `identifier`) — confirmed via
  // packages/builtin-tool-skills/src/executor/index.ts:42
  if (activatedSkills?.some((s) => s.id === LobeHubIdentifier)) return true;

  return false;
};
