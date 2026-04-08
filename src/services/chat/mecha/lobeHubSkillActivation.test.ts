import { LobeHubIdentifier } from '@lobechat/builtin-skills';
import { describe, expect, it } from 'vitest';

import { isLobeHubSkillActive } from './lobeHubSkillActivation';

describe('isLobeHubSkillActive', () => {
  it('returns false when nothing provided', () => {
    expect(isLobeHubSkillActive({})).toBe(false);
  });

  it('returns false when none of the three paths contain LobeHub', () => {
    expect(
      isLobeHubSkillActive({
        plugins: ['some-other-tool', 'another-tool'],
        selectedSkills: [{ identifier: 'artifacts', name: 'Artifacts' }],
        activatedSkills: [{ id: 'task', name: 'Task' }],
      }),
    ).toBe(false);
  });

  describe('Path 1 — persisted in agent config (plugins)', () => {
    it('returns true when plugins contains LobeHubIdentifier', () => {
      expect(
        isLobeHubSkillActive({
          plugins: [LobeHubIdentifier],
        }),
      ).toBe(true);
    });

    it('returns true when plugins contains LobeHub among other plugins', () => {
      expect(
        isLobeHubSkillActive({
          plugins: ['lobe-web-browsing', LobeHubIdentifier, 'lobe-creds'],
        }),
      ).toBe(true);
    });
  });

  describe('Path 2 — slash-menu selected (selectedSkills)', () => {
    it('returns true when selectedSkills contains LobeHubIdentifier', () => {
      expect(
        isLobeHubSkillActive({
          selectedSkills: [{ identifier: LobeHubIdentifier, name: 'LobeHub' }],
        }),
      ).toBe(true);
    });

    it('returns true when selectedSkills contains LobeHub among other selected skills', () => {
      expect(
        isLobeHubSkillActive({
          selectedSkills: [
            { identifier: 'artifacts', name: 'Artifacts' },
            { identifier: LobeHubIdentifier, name: 'LobeHub' },
          ],
        }),
      ).toBe(true);
    });

    it('does NOT confuse identifier match with name match', () => {
      expect(
        isLobeHubSkillActive({
          // selectedSkills uses `identifier` not `name`
          selectedSkills: [{ identifier: 'something-else', name: LobeHubIdentifier }],
        }),
      ).toBe(false);
    });
  });

  describe('Path 3 — model-driven mid-step activation (activatedSkills)', () => {
    it('returns true when activatedSkills contains LobeHubIdentifier', () => {
      expect(
        isLobeHubSkillActive({
          activatedSkills: [{ id: LobeHubIdentifier, name: 'LobeHub' }],
        }),
      ).toBe(true);
    });

    it('returns true when activatedSkills contains LobeHub among other activated skills', () => {
      expect(
        isLobeHubSkillActive({
          activatedSkills: [
            { id: 'task', name: 'Task' },
            { id: LobeHubIdentifier, name: 'LobeHub' },
          ],
        }),
      ).toBe(true);
    });

    it('uses `id` field (not `identifier`) per StepActivatedSkill type', () => {
      // StepActivatedSkill in @lobechat/types uses `id`, NOT `identifier`.
      // Regression: if someone refactors to look up `.identifier` it will silently break.
      expect(
        isLobeHubSkillActive({
          activatedSkills: [{ id: LobeHubIdentifier, name: 'LobeHub' }],
        }),
      ).toBe(true);
    });
  });

  describe('combined scenarios', () => {
    it('returns true when LobeHub is active via multiple paths', () => {
      expect(
        isLobeHubSkillActive({
          plugins: [LobeHubIdentifier],
          selectedSkills: [{ identifier: LobeHubIdentifier, name: 'LobeHub' }],
          activatedSkills: [{ id: LobeHubIdentifier, name: 'LobeHub' }],
        }),
      ).toBe(true);
    });

    it('returns true even if only path 2 has it (regression for codex review on LOBE-6882)', () => {
      // The original gate only checked plugins; users who activate LobeHub via
      // slash menu instead of persisting it in agent config would not get
      // identity injected. This test guards against that regression.
      expect(
        isLobeHubSkillActive({
          plugins: ['lobe-web-browsing'], // intentionally NOT including LobeHub
          selectedSkills: [{ identifier: LobeHubIdentifier, name: 'LobeHub' }],
        }),
      ).toBe(true);
    });

    it('returns true even if only path 3 has it', () => {
      expect(
        isLobeHubSkillActive({
          plugins: ['lobe-web-browsing'],
          activatedSkills: [{ id: LobeHubIdentifier, name: 'LobeHub' }],
        }),
      ).toBe(true);
    });
  });
});
