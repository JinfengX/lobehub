import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { markdownTable } from 'markdown-table';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';

export interface ScriptOptions {
  ageDays: number;
  help: boolean;
  outputDir?: string;
  top: number;
  userId?: string;
}

export interface GlobalSummary {
  affectedUsers: number;
  affectedUsersWithVectors: number;
  candidateFileCount: number;
  reclaimableObjectCount: number;
  totalChunkCount: number;
  totalEmbeddingCount: number;
  totalEstimatedVectorBytes: number;
  totalLogicalBytes: number;
  totalReclaimableObjectBytes: number;
  totalVectorFileBytes: number;
  vectorCandidateFileCount: number;
}

export interface UserSummary {
  candidateFileCount: number;
  chunkCount: number;
  email: string;
  embeddingCount: number;
  estimatedVectorBytes: number;
  fullName: string;
  logicalBytes: number;
  newestCandidateAt: string;
  oldestCandidateAt: string;
  proportionalReclaimableObjectBytes: number;
  userId: string;
  username: string;
  vectorFileBytes: number;
  vectorFileCount: number;
}

export interface CandidateFile {
  chunkCount: number;
  createdAt: string;
  email: string;
  embeddingCount: number;
  estimatedVectorBytes: number;
  fileHash: string;
  fileId: string;
  fullName: string;
  isReclaimableObject: boolean;
  logicalBytes: number;
  name: string;
  sharedCandidateHashFileCount: number;
  url: string;
  userId: string;
  username: string;
}

interface ReportPayload {
  generatedAt: string;
  options: {
    ageDays: number;
    outputDir?: string;
    top: number;
    userId?: string;
  };
  summary: GlobalSummary;
  users: UserSummary[];
}

const DEFAULT_AGE_DAYS = 7;
const DEFAULT_TOP = 30;
const VECTOR_BYTES_PER_EMBEDDING = 1024 * 4;
const REPORT_TABLE_NAMES = [
  'maintenance_kb_orphan_user_reclaimable_object_bytes',
  'maintenance_kb_orphan_reclaimable_hashes',
  'maintenance_kb_orphan_remaining_hash_usage',
  'maintenance_kb_orphan_candidate_hash_owners',
  'maintenance_kb_orphan_candidate_hash_totals',
  'maintenance_kb_orphan_candidates',
] as const;

export const loadEnv = () => {
  const env = process.env.NODE_ENV || 'development';

  dotenvExpand.expand(dotenv.config());
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));
};

const resetReportTables = async (client: PoolClient) => {
  const dropSql = REPORT_TABLE_NAMES.map((tableName) => `DROP TABLE IF EXISTS ${tableName};`).join(
    '\n',
  );

  await client.query(dropSql);
};

const printHelp = () => {
  console.log(`
Usage:
  pnpm workflow:kb-orphan-report -- [options]
  tsx scripts/reportKnowledgeBaseOrphans.ts [options]

Options:
  --age-days <n>      Minimum file age in days before it is considered a candidate (default: ${DEFAULT_AGE_DAYS})
  --top <n>           Number of users shown in the console report (default: ${DEFAULT_TOP})
  --user-id <id>      Restrict the report to one user
  --output-dir <dir>  Write Markdown, JSON, and CSV reports into a directory
  --help, -h          Show this help message

Examples:
  pnpm workflow:kb-orphan-report
  pnpm workflow:kb-orphan-report -- --age-days 14 --top 50
  pnpm workflow:kb-orphan-report -- --output-dir ./tmp/kb-orphan-report
  pnpm workflow:kb-orphan-report -- --user-id user_xxx --output-dir ./tmp/kb-orphan-report
`);
};

const parseArgs = (): ScriptOptions => {
  const args = process.argv.slice(2);

  const getArgValue = (flag: string) => {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
  };

  const help = args.includes('--help') || args.includes('-h');
  const rawAgeDays = getArgValue('--age-days');
  const rawTop = getArgValue('--top');
  const outputDir = getArgValue('--output-dir');
  const userId = getArgValue('--user-id');

  const ageDays = rawAgeDays ? Number(rawAgeDays) : DEFAULT_AGE_DAYS;
  const top = rawTop ? Number(rawTop) : DEFAULT_TOP;

  if (!help) {
    if (!Number.isFinite(ageDays) || ageDays < 0) {
      throw new Error(`Invalid --age-days value: ${rawAgeDays}`);
    }

    if (!Number.isFinite(top) || top <= 0) {
      throw new Error(`Invalid --top value: ${rawTop}`);
    }
  }

  return {
    ageDays,
    help,
    outputDir,
    top,
    userId,
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

const formatTimestamp = (value: string) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toISOString();
};

const escapeCsv = (value: string | number | boolean | null | undefined) => {
  if (value === null || value === undefined) return '';

  const stringValue = String(value);
  if (!/[",\n]/.test(stringValue)) return stringValue;

  return `"${stringValue.replaceAll('"', '""')}"`;
};

const toCsv = (rows: Array<Record<string, string | number | boolean | null | undefined>>) => {
  if (rows.length === 0) return '';

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ];

  return `${lines.join('\n')}\n`;
};

const normalizeGlobalSummary = (row: Record<string, string | number | null>): GlobalSummary => ({
  affectedUsers: Number(row.affected_users ?? 0),
  affectedUsersWithVectors: Number(row.affected_users_with_vectors ?? 0),
  candidateFileCount: Number(row.candidate_file_count ?? 0),
  reclaimableObjectCount: Number(row.reclaimable_object_count ?? 0),
  totalChunkCount: Number(row.total_chunk_count ?? 0),
  totalEmbeddingCount: Number(row.total_embedding_count ?? 0),
  totalEstimatedVectorBytes: Number(row.total_estimated_vector_bytes ?? 0),
  totalLogicalBytes: Number(row.total_logical_bytes ?? 0),
  totalReclaimableObjectBytes: Number(row.total_reclaimable_object_bytes ?? 0),
  totalVectorFileBytes: Number(row.total_vector_file_bytes ?? 0),
  vectorCandidateFileCount: Number(row.vector_candidate_file_count ?? 0),
});

const normalizeUserSummary = (rows: Array<Record<string, string | number | null>>): UserSummary[] =>
  rows.map((row) => ({
    candidateFileCount: Number(row.candidate_file_count ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    email: String(row.email ?? ''),
    embeddingCount: Number(row.embedding_count ?? 0),
    estimatedVectorBytes: Number(row.estimated_vector_bytes ?? 0),
    fullName: String(row.full_name ?? ''),
    logicalBytes: Number(row.logical_bytes ?? 0),
    newestCandidateAt: formatTimestamp(String(row.newest_candidate_at ?? '')),
    oldestCandidateAt: formatTimestamp(String(row.oldest_candidate_at ?? '')),
    proportionalReclaimableObjectBytes: Number(row.proportional_reclaimable_object_bytes ?? 0),
    userId: String(row.user_id ?? ''),
    username: String(row.username ?? ''),
    vectorFileBytes: Number(row.vector_file_bytes ?? 0),
    vectorFileCount: Number(row.vector_file_count ?? 0),
  }));

const normalizeCandidateFiles = (
  rows: Array<Record<string, string | number | boolean | null>>,
): CandidateFile[] =>
  rows.map((row) => ({
    chunkCount: Number(row.chunk_count ?? 0),
    createdAt: formatTimestamp(String(row.created_at ?? '')),
    email: String(row.email ?? ''),
    embeddingCount: Number(row.embedding_count ?? 0),
    estimatedVectorBytes: Number(row.estimated_vector_bytes ?? 0),
    fileHash: String(row.file_hash ?? ''),
    fileId: String(row.file_id ?? ''),
    fullName: String(row.full_name ?? ''),
    isReclaimableObject: Boolean(row.is_reclaimable_object ?? false),
    logicalBytes: Number(row.logical_bytes ?? 0),
    name: String(row.name ?? ''),
    sharedCandidateHashFileCount: Number(row.shared_candidate_hash_file_count ?? 0),
    url: String(row.url ?? ''),
    userId: String(row.user_id ?? ''),
    username: String(row.username ?? ''),
  }));

const createMarkdownReport = ({ generatedAt, options, summary, users }: ReportPayload) => {
  const summaryTable = markdownTable([
    ['Metric', 'Value'],
    ['Generated At', generatedAt],
    ['Age Threshold', `${options.ageDays} day(s)`],
    ['Scoped User', options.userId || 'all users'],
    ['Affected Users', String(summary.affectedUsers)],
    ['Affected Users With Vectors', String(summary.affectedUsersWithVectors)],
    ['Candidate Files', String(summary.candidateFileCount)],
    ['Vector Candidate Files', String(summary.vectorCandidateFileCount)],
    [
      'Logical File Bytes',
      `${summary.totalLogicalBytes} (${formatBytes(summary.totalLogicalBytes)})`,
    ],
    [
      'Vector File Bytes',
      `${summary.totalVectorFileBytes} (${formatBytes(summary.totalVectorFileBytes)})`,
    ],
    [
      'Estimated Vector Payload Bytes',
      `${summary.totalEstimatedVectorBytes} (${formatBytes(summary.totalEstimatedVectorBytes)})`,
    ],
    ['Chunk Count', String(summary.totalChunkCount)],
    ['Embedding Count', String(summary.totalEmbeddingCount)],
    [
      'Reclaimable Object Bytes',
      `${summary.totalReclaimableObjectBytes} (${formatBytes(summary.totalReclaimableObjectBytes)})`,
    ],
    ['Reclaimable Object Count', String(summary.reclaimableObjectCount)],
  ]);

  const userRows = [
    [
      'User ID',
      'Email',
      'Username',
      'Candidate Files',
      'Logical Bytes',
      'Vector Files',
      'Embedding Count',
      'Est. Vector Bytes',
      'Prop. Reclaimable Object Bytes',
      'Oldest Candidate',
    ],
    ...users.map((user) => [
      user.userId,
      user.email,
      user.username,
      String(user.candidateFileCount),
      `${user.logicalBytes} (${formatBytes(user.logicalBytes)})`,
      String(user.vectorFileCount),
      String(user.embeddingCount),
      `${user.estimatedVectorBytes} (${formatBytes(user.estimatedVectorBytes)})`,
      `${Math.round(user.proportionalReclaimableObjectBytes)} (${formatBytes(user.proportionalReclaimableObjectBytes)})`,
      user.oldestCandidateAt,
    ]),
  ];

  const usersTable = markdownTable(userRows);

  return `# Knowledge Base Orphan Report

## Summary

${summaryTable}

## Top Affected Users

${usersTable}
`;
};

const printConsoleReport = ({ generatedAt, options, summary, users }: ReportPayload) => {
  console.log('\nKnowledge Base Orphan Report');
  console.log('='.repeat(80));
  console.log(`Generated At: ${generatedAt}`);
  console.log(`Age Threshold: ${options.ageDays} day(s)`);
  console.log(`Scoped User: ${options.userId || 'all users'}`);
  console.log('');

  const summaryTable = markdownTable([
    ['Metric', 'Value'],
    ['Affected Users', String(summary.affectedUsers)],
    ['Affected Users With Vectors', String(summary.affectedUsersWithVectors)],
    ['Candidate Files', String(summary.candidateFileCount)],
    ['Vector Candidate Files', String(summary.vectorCandidateFileCount)],
    [
      'Logical File Bytes',
      `${summary.totalLogicalBytes} (${formatBytes(summary.totalLogicalBytes)})`,
    ],
    [
      'Reclaimable Object Bytes',
      `${summary.totalReclaimableObjectBytes} (${formatBytes(summary.totalReclaimableObjectBytes)})`,
    ],
    [
      'Estimated Vector Payload Bytes',
      `${summary.totalEstimatedVectorBytes} (${formatBytes(summary.totalEstimatedVectorBytes)})`,
    ],
    ['Chunk Count', String(summary.totalChunkCount)],
    ['Embedding Count', String(summary.totalEmbeddingCount)],
  ]);

  console.log(summaryTable);
  console.log('');

  if (users.length === 0) {
    console.log('No candidate users found under the current filter.\n');
    return;
  }

  const topUsersTable = markdownTable([
    [
      'User ID',
      'Email',
      'Candidate Files',
      'Logical Bytes',
      'Vector Files',
      'Embedding Count',
      'Est. Vector Bytes',
      'Oldest Candidate',
    ],
    ...users.map((user) => [
      user.userId,
      user.email,
      String(user.candidateFileCount),
      formatBytes(user.logicalBytes),
      String(user.vectorFileCount),
      String(user.embeddingCount),
      formatBytes(user.estimatedVectorBytes),
      user.oldestCandidateAt,
    ]),
  ]);

  console.log('Top Affected Users');
  console.log(topUsersTable);
  console.log('');
};

const writeOutputs = async ({
  files,
  outputDir,
  payload,
}: {
  files: CandidateFile[];
  outputDir: string;
  payload: ReportPayload;
}) => {
  const absoluteOutputDir = path.resolve(outputDir);
  await mkdir(absoluteOutputDir, { recursive: true });

  const markdown = createMarkdownReport(payload);

  const reportJsonPath = path.join(absoluteOutputDir, 'knowledge-base-orphan-report.json');
  const markdownPath = path.join(absoluteOutputDir, 'knowledge-base-orphan-report.md');
  const usersCsvPath = path.join(absoluteOutputDir, 'knowledge-base-orphan-users.csv');
  const filesCsvPath = path.join(absoluteOutputDir, 'knowledge-base-orphan-files.csv');

  await Promise.all([
    writeFile(markdownPath, markdown),
    writeFile(reportJsonPath, JSON.stringify(payload, null, 2) + '\n'),
    writeFile(
      usersCsvPath,
      toCsv(
        payload.users.map((user) => ({
          candidate_file_count: user.candidateFileCount,
          chunk_count: user.chunkCount,
          email: user.email,
          embedding_count: user.embeddingCount,
          estimated_vector_bytes: user.estimatedVectorBytes,
          full_name: user.fullName,
          logical_bytes: user.logicalBytes,
          newest_candidate_at: user.newestCandidateAt,
          oldest_candidate_at: user.oldestCandidateAt,
          proportional_reclaimable_object_bytes: Math.round(
            user.proportionalReclaimableObjectBytes,
          ),
          user_id: user.userId,
          username: user.username,
          vector_file_bytes: user.vectorFileBytes,
          vector_file_count: user.vectorFileCount,
        })),
      ),
    ),
    writeFile(
      filesCsvPath,
      toCsv(
        files.map((file) => ({
          chunk_count: file.chunkCount,
          created_at: file.createdAt,
          email: file.email,
          embedding_count: file.embeddingCount,
          estimated_vector_bytes: file.estimatedVectorBytes,
          file_hash: file.fileHash,
          file_id: file.fileId,
          full_name: file.fullName,
          is_reclaimable_object: file.isReclaimableObject,
          logical_bytes: file.logicalBytes,
          name: file.name,
          shared_candidate_hash_file_count: file.sharedCandidateHashFileCount,
          url: file.url,
          user_id: file.userId,
          username: file.username,
        })),
      ),
    ),
  ]);

  console.log('Report files written:');
  console.log(`  - ${reportJsonPath}`);
  console.log(`  - ${markdownPath}`);
  console.log(`  - ${usersCsvPath}`);
  console.log(`  - ${filesCsvPath}`);
  console.log('');
};

export const prepareReportTables = async (client: PoolClient, options: ScriptOptions) => {
  const values = options.userId ? [options.ageDays, options.userId] : [options.ageDays];

  await resetReportTables(client);

  await client.query(
    `
CREATE TEMP TABLE maintenance_kb_orphan_candidates AS
WITH active_refs AS (
  SELECT file_id FROM knowledge_base_files
  UNION
  SELECT file_id FROM messages_files
  UNION
  SELECT file_id FROM agents_files
  UNION
  SELECT file_id FROM files_to_sessions
  UNION
  SELECT file_id FROM generations WHERE file_id IS NOT NULL
  UNION
  SELECT file_id FROM message_tts WHERE file_id IS NOT NULL
  UNION
  SELECT file_id FROM documents WHERE file_id IS NOT NULL
),
vector_usage AS (
  SELECT
    fc.file_id,
    COUNT(DISTINCT fc.chunk_id) AS chunk_count,
    COUNT(DISTINCT e.id) AS embedding_count
  FROM file_chunks fc
  LEFT JOIN embeddings e ON e.chunk_id = fc.chunk_id
  GROUP BY fc.file_id
)
SELECT
  f.id AS file_id,
  f.user_id,
  f.name,
  COALESCE(f.file_hash, '') AS file_hash,
  f.url,
  f.size,
  f.created_at,
  COALESCE(v.chunk_count, 0) AS chunk_count,
  COALESCE(v.embedding_count, 0) AS embedding_count,
  COALESCE(v.embedding_count, 0) * ${VECTOR_BYTES_PER_EMBEDDING} AS estimated_vector_bytes
FROM files f
LEFT JOIN active_refs r ON r.file_id = f.id
LEFT JOIN vector_usage v ON v.file_id = f.id
WHERE r.file_id IS NULL
  AND f.parent_id IS NULL
  AND f.created_at < NOW() - make_interval(days => $1::int)
  ${options.userId ? 'AND f.user_id = $2' : ''};
`,
    values,
  );

  await client.query(
    'CREATE INDEX maintenance_kb_orphan_candidates_user_id_idx ON maintenance_kb_orphan_candidates (user_id);',
  );
  await client.query(
    'CREATE INDEX maintenance_kb_orphan_candidates_file_hash_idx ON maintenance_kb_orphan_candidates (file_hash);',
  );

  await client.query(`
CREATE TEMP TABLE maintenance_kb_orphan_candidate_hash_totals AS
SELECT
  file_hash,
  COUNT(*) AS total_candidate_file_count
FROM maintenance_kb_orphan_candidates
WHERE file_hash <> ''
GROUP BY file_hash;
`);

  await client.query(`
CREATE TEMP TABLE maintenance_kb_orphan_candidate_hash_owners AS
SELECT
  user_id,
  file_hash,
  COUNT(*) AS user_candidate_file_count
FROM maintenance_kb_orphan_candidates
WHERE file_hash <> ''
GROUP BY user_id, file_hash;
`);

  await client.query(`
CREATE TEMP TABLE maintenance_kb_orphan_remaining_hash_usage AS
SELECT
  f.file_hash,
  COUNT(*) AS remaining_file_count
FROM files f
LEFT JOIN maintenance_kb_orphan_candidates c ON c.file_id = f.id
WHERE c.file_id IS NULL
  AND f.file_hash IS NOT NULL
GROUP BY f.file_hash;
`);

  await client.query(`
CREATE TEMP TABLE maintenance_kb_orphan_reclaimable_hashes AS
SELECT
  gf.hash_id AS file_hash,
  gf.size AS global_size
FROM global_files gf
JOIN maintenance_kb_orphan_candidate_hash_totals cht ON cht.file_hash = gf.hash_id
LEFT JOIN maintenance_kb_orphan_remaining_hash_usage rhu ON rhu.file_hash = gf.hash_id
WHERE COALESCE(rhu.remaining_file_count, 0) = 0;
`);

  await client.query(`
CREATE TEMP TABLE maintenance_kb_orphan_user_reclaimable_object_bytes AS
SELECT
  cho.user_id,
  SUM(
    rh.global_size * cho.user_candidate_file_count::numeric / cht.total_candidate_file_count::numeric
  ) AS proportional_reclaimable_object_bytes
FROM maintenance_kb_orphan_candidate_hash_owners cho
JOIN maintenance_kb_orphan_candidate_hash_totals cht ON cht.file_hash = cho.file_hash
JOIN maintenance_kb_orphan_reclaimable_hashes rh ON rh.file_hash = cho.file_hash
GROUP BY cho.user_id;
`);
};

export const queryGlobalSummary = async (client: PoolClient) => {
  const sql = `
SELECT
  COUNT(DISTINCT cf.user_id) AS affected_users,
  COUNT(DISTINCT CASE WHEN cf.embedding_count > 0 OR cf.chunk_count > 0 THEN cf.user_id END) AS affected_users_with_vectors,
  COUNT(*) AS candidate_file_count,
  COUNT(*) FILTER (WHERE cf.embedding_count > 0 OR cf.chunk_count > 0) AS vector_candidate_file_count,
  COALESCE(SUM(cf.size), 0) AS total_logical_bytes,
  COALESCE(SUM(CASE WHEN cf.embedding_count > 0 OR cf.chunk_count > 0 THEN cf.size ELSE 0 END), 0) AS total_vector_file_bytes,
  COALESCE(SUM(cf.chunk_count), 0) AS total_chunk_count,
  COALESCE(SUM(cf.embedding_count), 0) AS total_embedding_count,
  COALESCE(SUM(cf.estimated_vector_bytes), 0) AS total_estimated_vector_bytes,
  COALESCE((SELECT SUM(global_size) FROM maintenance_kb_orphan_reclaimable_hashes), 0) AS total_reclaimable_object_bytes,
  COALESCE((SELECT COUNT(*) FROM maintenance_kb_orphan_reclaimable_hashes), 0) AS reclaimable_object_count
FROM maintenance_kb_orphan_candidates cf;
`;

  const result = await client.query(sql);

  return normalizeGlobalSummary(result.rows[0] ?? {});
};

export const queryUserSummaries = async (client: PoolClient) => {
  const sql = `
SELECT
  cf.user_id,
  COALESCE(u.email, '') AS email,
  COALESCE(u.username, '') AS username,
  COALESCE(u.full_name, '') AS full_name,
  COUNT(*) AS candidate_file_count,
  COALESCE(SUM(cf.size), 0) AS logical_bytes,
  COUNT(*) FILTER (WHERE cf.embedding_count > 0 OR cf.chunk_count > 0) AS vector_file_count,
  COALESCE(SUM(CASE WHEN cf.embedding_count > 0 OR cf.chunk_count > 0 THEN cf.size ELSE 0 END), 0) AS vector_file_bytes,
  COALESCE(SUM(cf.chunk_count), 0) AS chunk_count,
  COALESCE(SUM(cf.embedding_count), 0) AS embedding_count,
  COALESCE(SUM(cf.estimated_vector_bytes), 0) AS estimated_vector_bytes,
  COALESCE(MAX(urb.proportional_reclaimable_object_bytes), 0) AS proportional_reclaimable_object_bytes,
  MIN(cf.created_at) AS oldest_candidate_at,
  MAX(cf.created_at) AS newest_candidate_at
FROM maintenance_kb_orphan_candidates cf
LEFT JOIN users u ON u.id = cf.user_id
LEFT JOIN maintenance_kb_orphan_user_reclaimable_object_bytes urb ON urb.user_id = cf.user_id
GROUP BY cf.user_id, u.email, u.username, u.full_name
ORDER BY estimated_vector_bytes DESC, logical_bytes DESC, candidate_file_count DESC;
`;

  const result = await client.query(sql);

  return normalizeUserSummary(result.rows);
};

export const queryCandidateFiles = async (client: PoolClient) => {
  const sql = `
SELECT
  cf.file_id,
  cf.user_id,
  COALESCE(u.email, '') AS email,
  COALESCE(u.username, '') AS username,
  COALESCE(u.full_name, '') AS full_name,
  cf.name,
  cf.file_hash,
  cf.url,
  cf.size AS logical_bytes,
  cf.created_at,
  cf.chunk_count,
  cf.embedding_count,
  cf.estimated_vector_bytes,
  CASE WHEN rh.file_hash IS NOT NULL THEN true ELSE false END AS is_reclaimable_object,
  COALESCE(cht.total_candidate_file_count, 0) AS shared_candidate_hash_file_count
FROM maintenance_kb_orphan_candidates cf
LEFT JOIN users u ON u.id = cf.user_id
LEFT JOIN maintenance_kb_orphan_reclaimable_hashes rh ON rh.file_hash = cf.file_hash
LEFT JOIN maintenance_kb_orphan_candidate_hash_totals cht ON cht.file_hash = cf.file_hash
ORDER BY cf.user_id, cf.created_at ASC, cf.file_id ASC;
`;

  const result = await client.query(sql);

  return normalizeCandidateFiles(result.rows);
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
  const client = await pool.connect();

  try {
    await prepareReportTables(client, options);

    const [summary, users] = await Promise.all([
      queryGlobalSummary(client),
      queryUserSummaries(client),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      options: {
        ageDays: options.ageDays,
        outputDir: options.outputDir ? path.resolve(options.outputDir) : undefined,
        top: options.top,
        userId: options.userId,
      },
      summary,
      users,
    } satisfies ReportPayload;

    printConsoleReport({
      ...payload,
      users: users.slice(0, options.top),
    });

    if (options.outputDir) {
      const files = await queryCandidateFiles(client);
      await writeOutputs({
        files,
        outputDir: options.outputDir,
        payload,
      });
    }
  } finally {
    client.release();
    await pool.end();
  }
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error('Failed to generate knowledge base orphan report:', error);
    process.exit(1);
  });
}
