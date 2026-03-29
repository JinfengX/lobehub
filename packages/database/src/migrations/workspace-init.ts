/**
 * Workspace initialization migration
 *
 * This migration:
 * 1. Creates a Personal Workspace for each existing user
 * 2. Adds the user as owner in workspace_members
 * 3. Backfills workspace_id on all core resource tables
 *
 * Designed to be idempotent — safe to run multiple times.
 */
import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../type';

const BATCH_SIZE = 2000;

// Tables that need workspace_id backfill
const RESOURCE_TABLES = [
  'agents',
  'sessions',
  'session_groups',
  'topics',
  'threads',
  'messages',
  'documents',
  'files',
  'knowledge_bases',
  'ai_providers',
  'ai_models',
  'api_keys',
] as const;

/**
 * Step 1: Create Personal Workspace for each user who doesn't have one yet
 */
async function createPersonalWorkspaces(db: LobeChatDatabase): Promise<number> {
  const result = await db.execute(sql`
    WITH new_workspaces AS (
      INSERT INTO workspaces (id, slug, name, type, owner_id, created_at, updated_at, accessed_at)
      SELECT
        'ws_' || substr(md5(random()::text), 1, 12),
        'personal-' || substr(md5(u.id), 1, 8),
        'Personal',
        'personal',
        u.id,
        NOW(),
        NOW(),
        NOW()
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM workspaces w
        WHERE w.owner_id = u.id AND w.type = 'personal'
      )
      RETURNING id, owner_id
    )
    INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
    SELECT id, owner_id, 'owner', NOW()
    FROM new_workspaces
    ON CONFLICT DO NOTHING
  `);

  return result.rowCount ?? 0;
}

/**
 * Step 2: Backfill workspace_id for a given table in batches
 */
async function backfillTable(
  db: LobeChatDatabase,
  tableName: string,
): Promise<number> {
  let totalUpdated = 0;
  let batchUpdated: number;

  do {
    // PostgreSQL doesn't support UPDATE ... LIMIT, so use a subquery with ctid
    const result = await db.execute(sql.raw(`
      UPDATE ${tableName} t
      SET workspace_id = w.id
      FROM workspaces w
      WHERE w.owner_id = t.user_id
        AND w.type = 'personal'
        AND t.workspace_id IS NULL
        AND t.ctid IN (
          SELECT t2.ctid FROM ${tableName} t2
          WHERE t2.workspace_id IS NULL
          LIMIT ${BATCH_SIZE}
        )
    `));

    batchUpdated = result.rowCount ?? 0;
    totalUpdated += batchUpdated;
  } while (batchUpdated >= BATCH_SIZE);

  return totalUpdated;
}

/**
 * Run the full workspace initialization migration
 */
export async function migrateWorkspaceInit(db: LobeChatDatabase): Promise<{
  backfillResults: Record<string, number>;
  workspacesCreated: number;
}> {
  // Step 1: Create personal workspaces
  const workspacesCreated = await createPersonalWorkspaces(db);

  // Step 2: Backfill workspace_id for all resource tables
  const backfillResults: Record<string, number> = {};

  for (const table of RESOURCE_TABLES) {
    backfillResults[table] = await backfillTable(db, table);
  }

  return { backfillResults, workspacesCreated };
}

/**
 * Helper: Get personal workspace ID for a given user
 */
export async function getPersonalWorkspaceId(
  db: LobeChatDatabase,
  userId: string,
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT id FROM workspaces
    WHERE owner_id = ${userId} AND type = 'personal'
    LIMIT 1
  `);

  return (result.rows[0] as any)?.id ?? null;
}

/**
 * Helper: Ensure a user has a personal workspace, creating one if not
 */
export async function ensurePersonalWorkspace(
  db: LobeChatDatabase,
  userId: string,
): Promise<string> {
  const existing = await getPersonalWorkspaceId(db, userId);
  if (existing) return existing;

  const result = await db.execute(sql`
    WITH new_ws AS (
      INSERT INTO workspaces (id, slug, name, type, owner_id, created_at, updated_at, accessed_at)
      VALUES (
        'ws_' || substr(md5(random()::text), 1, 12),
        'personal-' || substr(md5(${userId}), 1, 8),
        'Personal',
        'personal',
        ${userId},
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    SELECT id FROM new_ws
    UNION ALL
    SELECT id FROM workspaces WHERE owner_id = ${userId} AND type = 'personal'
    LIMIT 1
  `);

  const workspaceId = (result.rows[0] as any)?.id;

  // Ensure membership
  await db.execute(sql`
    INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
    VALUES (${workspaceId}, ${userId}, 'owner', NOW())
    ON CONFLICT DO NOTHING
  `);

  return workspaceId;
}
