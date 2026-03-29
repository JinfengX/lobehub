import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '../type';

const BATCH_SIZE = 2000;

const RESOURCE_TABLES = [
  'agents',
  'sessions',
  'session_groups',
  'messages',
  'topics',
  'threads',
  'files',
  'documents',
  'knowledge_bases',
  'ai_providers',
  'ai_models',
  'api_keys',
];

/**
 * Phase A: Create a personal workspace for each existing user who doesn't have one yet.
 */
const createPersonalWorkspaces = async (db: LobeChatDatabase) => {
  const result = await db.execute(sql`
    INSERT INTO workspaces (id, slug, name, type, owner_id, created_at, updated_at, accessed_at)
    SELECT
      'ws_' || substr(md5(random()::text || u.id), 1, 12),
      'personal-' || substr(u.id, 1, 8),
      COALESCE(u.username, 'Personal'),
      'personal',
      u.id,
      NOW(), NOW(), NOW()
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM workspaces w WHERE w.owner_id = u.id AND w.type = 'personal'
    )
  `);
  console.log(`[workspace-init] Created personal workspaces: ${result.rowCount} rows`);
};

/**
 * Phase B: Add each user as owner of their personal workspace.
 */
const createOwnerMemberships = async (db: LobeChatDatabase) => {
  const result = await db.execute(sql`
    INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
    SELECT w.id, w.owner_id, 'owner', NOW()
    FROM workspaces w
    WHERE w.type = 'personal'
      AND NOT EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = w.id AND wm.user_id = w.owner_id
      )
  `);
  console.log(`[workspace-init] Created owner memberships: ${result.rowCount} rows`);
};

/**
 * Phase C: Backfill workspace_id on resource tables in batches.
 * Uses a CTE to limit batch size since PostgreSQL UPDATE doesn't support LIMIT directly.
 */
const backfillWorkspaceId = async (db: LobeChatDatabase, tableName: string) => {
  let totalUpdated = 0;
  let batchUpdated = BATCH_SIZE;

  // Determine the primary key column(s) for this table
  const pkColumn = getPrimaryKeyColumn(tableName);

  while (batchUpdated >= BATCH_SIZE) {
    const result = await db.execute(sql.raw(`
      WITH batch AS (
        SELECT t.${pkColumn}
        FROM ${tableName} t
        WHERE t.workspace_id IS NULL
          AND t.user_id IS NOT NULL
        LIMIT ${BATCH_SIZE}
      )
      UPDATE ${tableName} t
      SET workspace_id = w.id
      FROM batch, workspaces w
      WHERE t.${pkColumn} = batch.${pkColumn}
        AND w.owner_id = t.user_id
        AND w.type = 'personal'
    `));

    batchUpdated = result.rowCount ?? 0;
    totalUpdated += batchUpdated;
  }

  console.log(`[workspace-init] Backfilled ${tableName}: ${totalUpdated} rows`);
};

/**
 * Get the primary key column name for a table.
 * Most tables use 'id', but some composite-PK tables need special handling.
 */
const getPrimaryKeyColumn = (tableName: string): string => {
  // These tables have composite primary keys but still have a unique user_id + id combination
  // For the CTE-based batch update, we use a column that can uniquely identify rows
  switch (tableName) {
    case 'ai_providers': {
      // Composite PK: (id, user_id) — use ctid as row identifier
      return 'ctid';
    }
    case 'ai_models': {
      // Composite PK: (id, provider_id, user_id) — use ctid
      return 'ctid';
    }
    default: {
      return 'id';
    }
  }
};

/**
 * Run the workspace initialization migration.
 * This migration is idempotent and can be re-run safely.
 *
 * Steps:
 * 1. Create personal workspace for each user
 * 2. Add owner membership records
 * 3. Backfill workspace_id on all resource tables
 */
export const runWorkspaceInitMigration = async (db: LobeChatDatabase) => {
  console.log('[workspace-init] Starting workspace initialization migration...');

  // Phase A: Create personal workspaces
  await createPersonalWorkspaces(db);

  // Phase B: Create owner memberships
  await createOwnerMemberships(db);

  // Phase C: Backfill workspace_id on resource tables
  for (const tableName of RESOURCE_TABLES) {
    await backfillWorkspaceId(db, tableName);
  }

  console.log('[workspace-init] Workspace initialization migration completed.');
};
