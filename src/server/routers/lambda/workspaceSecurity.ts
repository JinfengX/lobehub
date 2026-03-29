import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { workspaces } from '@/database/schemas';
import { router, workspaceOwnerProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * Workspace security settings schema
 * Stored in workspaces.settings.security
 */
const securitySettingsSchema = z.object({
  // SSO enforcement
  ssoEnforced: z.boolean().default(false),
  ssoProvider: z.enum(['saml', 'oidc']).optional(),
  ssoConfig: z
    .object({
      entityId: z.string().optional(),
      metadataUrl: z.string().optional(),
      ssoUrl: z.string().optional(),
    })
    .optional(),

  // Security policies
  enforce2FA: z.boolean().default(false),
  ipAllowlist: z.array(z.string()).default([]),
  sessionTimeoutMinutes: z.number().min(5).max(43200).default(1440), // 24 hours default

  // SCIM configuration
  scimEnabled: z.boolean().default(false),
  scimBearerToken: z.string().optional(), // encrypted
});

type WorkspaceSecuritySettings = z.infer<typeof securitySettingsSchema>;

const securityProcedure = workspaceOwnerProcedure.use(serverDatabase);

export const workspaceSecurityRouter = router({
  /**
   * Get workspace security settings (owner only)
   */
  getSettings: securityProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return null;

    const ws = await ctx.serverDB.query.workspaces.findFirst({
      where: eq(workspaces.id, ctx.workspaceId),
    });

    const settings = (ws?.settings as Record<string, any>) || {};
    return (settings.security || {}) as Partial<WorkspaceSecuritySettings>;
  }),

  /**
   * Update workspace security settings (owner only)
   */
  updateSettings: securityProcedure
    .input(securitySettingsSchema.partial())
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');

      // Get current settings
      const ws = await ctx.serverDB.query.workspaces.findFirst({
        where: eq(workspaces.id, ctx.workspaceId),
      });

      const currentSettings = (ws?.settings as Record<string, any>) || {};
      const currentSecurity = currentSettings.security || {};

      // Merge security settings
      const updatedSettings = {
        ...currentSettings,
        security: { ...currentSecurity, ...input },
      };

      await ctx.serverDB
        .update(workspaces)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(workspaces.id, ctx.workspaceId));

      return { success: true };
    }),

  /**
   * Regenerate SCIM bearer token (owner only)
   */
  regenerateScimToken: securityProcedure.mutation(async ({ ctx }) => {
    if (!ctx.workspaceId) throw new Error('No workspace context');

    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');

    // Store in workspace settings
    const ws = await ctx.serverDB.query.workspaces.findFirst({
      where: eq(workspaces.id, ctx.workspaceId),
    });

    const currentSettings = (ws?.settings as Record<string, any>) || {};
    const updatedSettings = {
      ...currentSettings,
      security: {
        ...currentSettings.security,
        scimBearerToken: token,
        scimEnabled: true,
      },
    };

    await ctx.serverDB
      .update(workspaces)
      .set({ settings: updatedSettings, updatedAt: new Date() })
      .where(eq(workspaces.id, ctx.workspaceId));

    // Return token once — it won't be shown again
    return { token };
  }),
});
