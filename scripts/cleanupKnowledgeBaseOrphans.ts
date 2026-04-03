import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { LobeChatDatabase } from '@lobechat/database';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { markdownTable } from 'markdown-table';
import { Pool } from 'pg';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import * as schemaModule from '@/database/schemas';
import { FileService } from '@/server/services/file';

import {
  type CandidateFile,
  loadEnv,
  prepareReportTables,
  queryCandidateFiles,
  queryGlobalSummary,
  queryUserSummaries,
} from './reportKnowledgeBaseOrphans';

interface CleanupOptions {
  ageDays: number;
  batchSize: number;
  execute: boolean;
  help: boolean;
  outputDir?: string;
  userId?: string;
}

interface CleanupBatchLog {
  attemptedFileCount: number;
  batchIndex: number;
  deletedChunkCount: number;
  deletedEmbeddingCount: number;
  deletedFileCount: number;
  deletedLogicalBytes: number;
  deletedObjectKeyCount: number;
  fileIds: string[];
}

interface CleanupUserLog {
  batches: CleanupBatchLog[];
  deletedChunkCount: number;
  deletedEmbeddingCount: number;
  deletedFileCount: number;
  deletedLogicalBytes: number;
  deletedObjectKeyCount: number;
  email: string;
  fullName: string;
  plannedFileCount: number;
  userId: string;
  username: string;
}

interface CleanupExecutionLog {
  finishedAt: string;
  options: {
    ageDays: number;
    batchSize: number;
    execute: boolean;
    outputDir?: string;
    userId?: string;
  };
  startedAt: string;
  summary: {
    deletedChunkCount: number;
    deletedEmbeddingCount: number;
    deletedFileCount: number;
    deletedLogicalBytes: number;
    deletedObjectKeyCount: number;
    affectedUsers: number;
  };
  users: CleanupUserLog[];
}

const DEFAULT_AGE_DAYS = 7;
const DEFAULT_BATCH_SIZE = 200;

const printHelp = () => {
  console.log(`
Usage:
  pnpm workflow:kb-orphan-cleanup -- [options]
  tsx scripts/cleanupKnowledgeBaseOrphans.ts [options]

Options:
  --age-days <n>      Minimum candidate age in days (default: ${DEFAULT_AGE_DAYS})
  --batch-size <n>    Files deleted per batch and per user transaction unit (default: ${DEFAULT_BATCH_SIZE})
  --user-id <id>      Restrict cleanup to one user
  --output-dir <dir>  Write a cleanup execution log JSON file
  --execute           Perform the deletion; without this flag the script is dry-run only
  --help, -h          Show this help message

Examples:
  pnpm workflow:kb-orphan-cleanup
  pnpm workflow:kb-orphan-cleanup -- --user-id user_xxx
  pnpm workflow:kb-orphan-cleanup -- --execute --batch-size 100 --output-dir ./tmp/kb-cleanup
`);
};

const parseArgs = (): CleanupOptions => {
  const args = process.argv.slice(2);

  const getArgValue = (flag: string) => {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
  };

  const help = args.includes('--help') || args.includes('-h');
  const rawAgeDays = getArgValue('--age-days');
  const rawBatchSize = getArgValue('--batch-size');

  const ageDays = rawAgeDays ? Number(rawAgeDays) : DEFAULT_AGE_DAYS;
  const batchSize = rawBatchSize ? Number(rawBatchSize) : DEFAULT_BATCH_SIZE;

  if (!help) {
    if (!Number.isFinite(ageDays) || ageDays < 0) {
      throw new Error(`Invalid --age-days value: ${rawAgeDays}`);
    }

    if (!Number.isFinite(batchSize) || batchSize <= 0) {
      throw new Error(`Invalid --batch-size value: ${rawBatchSize}`);
    }
  }

  return {
    ageDays,
    batchSize,
    execute: args.includes('--execute'),
    help,
    outputDir: getArgValue('--output-dir'),
    userId: getArgValue('--user-id'),
  };
};

const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const chunkRows = <T>(rows: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
};

const groupByUser = (rows: CandidateFile[]) => {
  const userMap = new Map<string, CandidateFile[]>();

  for (const row of rows) {
    const group = userMap.get(row.userId) ?? [];
    group.push(row);
    userMap.set(row.userId, group);
  }

  return userMap;
};

const printPreflight = async ({
  ageDays,
  execute,
  files,
  userId,
  users,
}: {
  ageDays: number;
  execute: boolean;
  files: CandidateFile[];
  userId?: string;
  users: Awaited<ReturnType<typeof queryUserSummaries>>;
}) => {
  const candidateObjectKeyCount = new Set(
    files.filter((file) => file.isReclaimableObject).map((file) => file.fileHash || file.url),
  ).size;

  console.log('\nKnowledge Base Orphan Cleanup');
  console.log('='.repeat(80));
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Age Threshold: ${ageDays} day(s)`);
  console.log(`Scoped User: ${userId || 'all users'}`);
  console.log('');

  const summaryTable = markdownTable([
    ['Metric', 'Value'],
    ['Affected Users', String(users.length)],
    ['Candidate Files', String(files.length)],
    [
      'Candidate Logical Bytes',
      `${files.reduce((total, item) => total + item.logicalBytes, 0)} (${formatBytes(files.reduce((total, item) => total + item.logicalBytes, 0))})`,
    ],
    [
      'Candidate Embedding Count',
      String(files.reduce((total, item) => total + item.embeddingCount, 0)),
    ],
    ['Candidate Chunk Count', String(files.reduce((total, item) => total + item.chunkCount, 0))],
    ['Candidate Reclaimable Object Keys', String(candidateObjectKeyCount)],
    ['REMOVE_GLOBAL_FILE', String(serverDBEnv.REMOVE_GLOBAL_FILE ?? false)],
  ]);

  console.log(summaryTable);
  console.log('');

  if (users.length > 0) {
    const topUsersTable = markdownTable([
      [
        'User ID',
        'Email',
        'Candidate Files',
        'Logical Bytes',
        'Embedding Count',
        'Oldest Candidate',
      ],
      ...users
        .slice(0, 20)
        .map((item) => [
          item.userId,
          item.email,
          String(item.candidateFileCount),
          formatBytes(item.logicalBytes),
          String(item.embeddingCount),
          item.oldestCandidateAt,
        ]),
    ]);

    console.log('Top Users In Scope');
    console.log(topUsersTable);
    console.log('');
  }

  if (!execute) {
    console.log('Dry-run mode completed. Re-run with `--execute` to perform deletion.\n');
  }
};

const resolveObjectKeysBeforeDeletion = async (fileService: FileService, rows: CandidateFile[]) => {
  const fileIdToObjectKey = new Map<string, string>();

  for (const row of rows) {
    if (!row.isReclaimableObject) continue;

    if (!row.url) {
      throw new Error(`Missing storage URL for reclaimable file ${row.fileId}`);
    }

    if (row.url.startsWith('http://') || row.url.startsWith('https://')) {
      const key = await fileService.getKeyFromFullUrl(row.url);

      if (!key) {
        throw new Error(`Failed to resolve object key from URL for file ${row.fileId}`);
      }

      fileIdToObjectKey.set(row.fileId, key);
      continue;
    }

    fileIdToObjectKey.set(row.fileId, row.url);
  }

  return fileIdToObjectKey;
};

const writeExecutionLog = async (outputDir: string, log: CleanupExecutionLog) => {
  const absoluteOutputDir = path.resolve(outputDir);
  await mkdir(absoluteOutputDir, { recursive: true });

  const outputPath = path.join(absoluteOutputDir, 'knowledge-base-orphan-cleanup-log.json');
  await writeFile(outputPath, JSON.stringify(log, null, 2) + '\n');

  console.log(`Cleanup execution log written to: ${outputPath}`);
  console.log('');
};

const main = async () => {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  loadEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const db = nodeDrizzle(pool, { schema: schemaModule }) as unknown as LobeChatDatabase;
  const client = await pool.connect();

  const startedAt = new Date().toISOString();

  try {
    await prepareReportTables(client, {
      ageDays: options.ageDays,
      help: false,
      top: 1,
      userId: options.userId,
    });

    const [summary, users, files] = await Promise.all([
      queryGlobalSummary(client),
      queryUserSummaries(client),
      queryCandidateFiles(client),
    ]);

    await printPreflight({
      ageDays: options.ageDays,
      execute: options.execute,
      files,
      userId: options.userId,
      users,
    });

    if (!options.execute || summary.candidateFileCount === 0) {
      if (options.outputDir) {
        await writeExecutionLog(options.outputDir, {
          finishedAt: new Date().toISOString(),
          options: {
            ageDays: options.ageDays,
            batchSize: options.batchSize,
            execute: false,
            outputDir: options.outputDir ? path.resolve(options.outputDir) : undefined,
            userId: options.userId,
          },
          startedAt,
          summary: {
            affectedUsers: users.length,
            deletedChunkCount: 0,
            deletedEmbeddingCount: 0,
            deletedFileCount: 0,
            deletedLogicalBytes: 0,
            deletedObjectKeyCount: 0,
          },
          users: [],
        });
      }

      return;
    }

    if (!serverDBEnv.REMOVE_GLOBAL_FILE) {
      throw new Error(
        'Execution refused because REMOVE_GLOBAL_FILE is disabled. Set DISABLE_REMOVE_GLOBAL_FILE=0 before running destructive cleanup.',
      );
    }

    const rowsByUser = groupByUser(files);
    const executionUsers: CleanupUserLog[] = [];

    for (const user of users) {
      const userRows = rowsByUser.get(user.userId) ?? [];
      if (userRows.length === 0) continue;

      const fileModel = new FileModel(db, user.userId);
      const fileService = new FileService(db, user.userId);
      const batches = chunkRows(userRows, options.batchSize);
      const userLog: CleanupUserLog = {
        batches: [],
        deletedChunkCount: 0,
        deletedEmbeddingCount: 0,
        deletedFileCount: 0,
        deletedLogicalBytes: 0,
        deletedObjectKeyCount: 0,
        email: user.email,
        fullName: user.fullName,
        plannedFileCount: userRows.length,
        userId: user.userId,
        username: user.username,
      };

      console.log(
        `Deleting user ${user.userId} (${user.email || user.username || 'unknown'}) with ${userRows.length} file(s)...`,
      );

      for (const [batchIndex, batchRows] of batches.entries()) {
        const objectKeyMap = await resolveObjectKeysBeforeDeletion(fileService, batchRows);
        const deletedFileRows = await fileModel.deleteMany(
          batchRows.map((row) => row.fileId),
          true,
        );

        const deletedFileIds = new Set(deletedFileRows.map((row) => row.id));
        const deletedCandidateRows = batchRows.filter((row) => deletedFileIds.has(row.fileId));
        const objectKeys = [
          ...new Set(
            deletedCandidateRows
              .map((row) => objectKeyMap.get(row.fileId))
              .filter((value): value is string => Boolean(value)),
          ),
        ];

        if (objectKeys.length > 0) {
          await fileService.deleteFiles(objectKeys);
        }

        const batchLog: CleanupBatchLog = {
          attemptedFileCount: batchRows.length,
          batchIndex: batchIndex + 1,
          deletedChunkCount: deletedCandidateRows.reduce((total, row) => total + row.chunkCount, 0),
          deletedEmbeddingCount: deletedCandidateRows.reduce(
            (total, row) => total + row.embeddingCount,
            0,
          ),
          deletedFileCount: deletedCandidateRows.length,
          deletedLogicalBytes: deletedCandidateRows.reduce(
            (total, row) => total + row.logicalBytes,
            0,
          ),
          deletedObjectKeyCount: objectKeys.length,
          fileIds: deletedCandidateRows.map((row) => row.fileId),
        };

        userLog.batches.push(batchLog);
        userLog.deletedChunkCount += batchLog.deletedChunkCount;
        userLog.deletedEmbeddingCount += batchLog.deletedEmbeddingCount;
        userLog.deletedFileCount += batchLog.deletedFileCount;
        userLog.deletedLogicalBytes += batchLog.deletedLogicalBytes;
        userLog.deletedObjectKeyCount += batchLog.deletedObjectKeyCount;

        console.log(
          `  Batch ${batchLog.batchIndex}: deleted ${batchLog.deletedFileCount}/${batchLog.attemptedFileCount} file(s), ${batchLog.deletedObjectKeyCount} object key(s)`,
        );
      }

      executionUsers.push(userLog);
    }

    const executionLog: CleanupExecutionLog = {
      finishedAt: new Date().toISOString(),
      options: {
        ageDays: options.ageDays,
        batchSize: options.batchSize,
        execute: true,
        outputDir: options.outputDir ? path.resolve(options.outputDir) : undefined,
        userId: options.userId,
      },
      startedAt,
      summary: {
        affectedUsers: executionUsers.length,
        deletedChunkCount: executionUsers.reduce(
          (total, user) => total + user.deletedChunkCount,
          0,
        ),
        deletedEmbeddingCount: executionUsers.reduce(
          (total, user) => total + user.deletedEmbeddingCount,
          0,
        ),
        deletedFileCount: executionUsers.reduce((total, user) => total + user.deletedFileCount, 0),
        deletedLogicalBytes: executionUsers.reduce(
          (total, user) => total + user.deletedLogicalBytes,
          0,
        ),
        deletedObjectKeyCount: executionUsers.reduce(
          (total, user) => total + user.deletedObjectKeyCount,
          0,
        ),
      },
      users: executionUsers,
    };

    console.log('\nCleanup Completed');
    console.log(
      markdownTable([
        ['Metric', 'Value'],
        ['Affected Users', String(executionLog.summary.affectedUsers)],
        ['Deleted Files', String(executionLog.summary.deletedFileCount)],
        ['Deleted Logical Bytes', formatBytes(executionLog.summary.deletedLogicalBytes)],
        ['Deleted Chunks', String(executionLog.summary.deletedChunkCount)],
        ['Deleted Embeddings', String(executionLog.summary.deletedEmbeddingCount)],
        ['Deleted Object Keys', String(executionLog.summary.deletedObjectKeyCount)],
      ]),
    );
    console.log('');

    if (options.outputDir) {
      await writeExecutionLog(options.outputDir, executionLog);
    }
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Failed to clean knowledge base orphans:', error);
  process.exit(1);
});
