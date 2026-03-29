# LobeHub Workspace 技术方案调研

## Context

LobeHub 当前是一个**用户中心的单租户 AI 平台**，所有数据（Agent、Session、Topic、Message、Knowledge Base、File 等）都通过 `userId` FK 绑定到个人用户，没有任何 Workspace/Team/Organization 概念。为了支持团队协作场景，需要引入 Workspace 功能，将平台从个人工具升级为团队协作平台。

本方案基于：
1. **当前架构深度分析** — 40+ 数据库表、40+ tRPC Router、Better Auth 认证、Zustand 状态管理
2. **竞品调研** — ChatGPT Teams、Slack、Notion、Dify、Cursor 的 Workspace 设计

---

## 一、当前架构分析

### 1.1 数据库架构现状

| 类别 | 核心表 | 数据隔离方式 |
|------|--------|-------------|
| 用户 | `users`, `user_settings` | userId 主键 |
| Agent | `agents`, `agents_knowledge_bases`, `agents_files` | userId FK |
| 会话 | `sessions`, `session_groups`, `topics`, `threads`, `messages` | userId FK |
| 知识库 | `knowledge_bases`, `documents`, `files`, `chunks`, `embeddings` | userId FK |
| AI 配置 | `ai_providers`, `ai_models`, `api_keys` | userId FK |
| 记忆 | `user_memories` 及相关表 | userId FK |
| 权限 | `rbac_roles`, `rbac_permissions`, `rbac_role_permissions`, `rbac_user_roles` | 已有 RBAC 基础 |

**关键问题**：所有表都通过 `userId` 做数据隔离，没有 `workspaceId` 概念。

### 1.2 认证架构
- Better Auth（主要）+ NextAuth（兼容）+ OIDC
- 支持 OAuth/SSO/Passkey/2FA
- Auth middleware 在 `src/app/(backend)/middleware/auth/` 中，提取 userId 注入请求上下文

### 1.3 API 架构
- 40+ tRPC Router（`src/server/routers/lambda/`）
- 通过 `authedProcedure` 中间件保护
- Database models 通过 `userId` 过滤数据

### 1.4 前端架构
- Zustand Store 分片管理（user、agent、chat、session、global 等 20+ stores）
- React Router SPA，入口在 `src/spa/`
- 路由页面在 `src/routes/`，业务逻辑在 `src/features/`

---

## 二、竞品 Workspace 设计对比

| 产品 | 模型 | 角色体系 | 资源共享 | 关键特性 |
|------|------|---------|---------|---------|
| **ChatGPT Teams** | Workspace > Projects | Owner/Admin/Member | Custom GPTs、共享项目、Group Chats | 项目级隔离记忆、SAML SSO |
| **Slack** | Org > Workspaces > Channels | Owner/Admin/Member/Guest | 消息、文件、集成 | workspace_id 分片、RLS、Enterprise Grid |
| **Notion** | Workspace > Teamspaces > Pages | Workspace Owner/Member/Guest + Teamspace Owner/Member | 页面、数据库、文档 | 页面级权限、嵌套团队空间 |
| **Dify** | Workspace（=租户） | Owner/Admin/Editor/KB Specialist | Agent、知识库、模型配置、插件 | `tenants` + `tenant_account_joins`、多 Workspace |
| **Cursor** | Enterprise Organization | Admin/Member | 规则、设置、扩展策略 | SSO/SCIM、沙箱执行 |

### 最佳参考：Dify 模型
Dify 与 LobeHub 最为相似（AI Agent 平台），其 Workspace 设计值得重点借鉴：
- **Workspace = 租户**，是团队协作的基本单元
- **4 级角色**：Owner > Admin > Editor > KB Specialist
- **所有资源 Workspace 级共享**：模型配置、插件、知识库按角色权限访问
- **DB 实现**：`tenants` 表 + `tenant_account_joins` 关联表

---

## 三、Workspace 技术方案设计

### 3.1 核心概念模型

```
User ←→ WorkspaceMembers ←→ Workspace
                                 ↓
              ┌──────────────────┼──────────────────┐
              ↓                  ↓                  ↓
          Agents            KnowledgeBases      AI Providers
          Sessions          Files               API Keys
          Topics            Documents           Settings
          Messages          ...
```

**设计原则**：
1. **Personal Workspace**：每个用户自动拥有一个"个人 Workspace"，兼容现有行为
2. **Team Workspace**：用户可以创建/加入团队 Workspace
3. **双 ID 隔离**：资源同时关联 `userId`（创建者）+ `workspaceId`（所属空间）
4. **渐进式迁移**：存量数据自动归属个人 Workspace，不破坏现有功能

### 3.2 数据库 Schema 设计

#### 新增表

```sql
-- 1. Workspace 主表
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(1000),
  avatar TEXT,
  type TEXT NOT NULL DEFAULT 'team',  -- 'personal' | 'team'
  owner_id TEXT NOT NULL REFERENCES users(id),
  settings JSONB DEFAULT '{}',         -- workspace 级设置
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Workspace 成员关联表
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'editor' | 'member'
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- 3. Workspace 级 AI Provider 配置（覆盖用户级）
CREATE TABLE workspace_ai_providers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ...同 ai_providers 结构
);

-- 4. Workspace 级 API Key
CREATE TABLE workspace_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ...同 api_keys 结构
);

-- 5. Workspace 邀请表
CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'accepted' | 'expired'
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 修改现有表（添加 workspaceId）

**高优先级**（核心资源表）：
- `agents` — 添加 `workspace_id` 列
- `sessions` / `session_groups` — 添加 `workspace_id` 列
- `topics` / `threads` / `messages` — 添加 `workspace_id` 列
- `knowledge_bases` / `documents` / `files` — 添加 `workspace_id` 列
- `ai_providers` / `ai_models` — 添加 `workspace_id` 列
- `api_keys` — 添加 `workspace_id` 列

**低优先级**（可后续迁移）：
- `user_memories` 系列 — 记忆默认属于个人
- `generation_*` 系列 — 生成内容
- `agent_eval_*` 系列 — 评估数据

**迁移策略**：
1. 新增列 `workspace_id` 允许 NULL（向后兼容）
2. 创建迁移脚本：为每个用户创建 Personal Workspace，将现有数据的 `workspace_id` 填充为个人 Workspace ID
3. 之后将 `workspace_id` 设为 NOT NULL
4. 添加索引：`CREATE INDEX idx_<table>_workspace_id ON <table>(workspace_id)`

### 3.3 数据访问层改造

#### tRPC Context 注入 workspaceId

```typescript
// src/libs/trpc/context.ts
interface TRPCContext {
  userId: string;
  workspaceId: string;  // 新增：当前活跃的 workspace
  workspaceRole: WorkspaceRole;  // 新增：用户在当前 workspace 的角色
  serverDB: LobeChatDatabase;
}
```

#### Middleware 改造

```typescript
// 新增 workspace 中间件
export const workspaceProcedure = authedProcedure.use(async ({ ctx, next }) => {
  // 从 header/cookie 中获取当前 workspaceId
  const workspaceId = ctx.req.headers.get('x-workspace-id');

  // 验证用户是否属于该 workspace
  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, ctx.userId)
    )
  });

  if (!member) throw new TRPCError({ code: 'FORBIDDEN' });

  return next({
    ctx: { ...ctx, workspaceId, workspaceRole: member.role }
  });
});
```

#### Model/Repository 改造

所有 workspace 级资源的查询需要从 `where: eq(table.userId, userId)` 改为 `where: eq(table.workspaceId, workspaceId)`：

```typescript
// Before
async getAgents(userId: string) {
  return db.query.agents.findMany({
    where: eq(agents.userId, userId)
  });
}

// After
async getAgents(workspaceId: string) {
  return db.query.agents.findMany({
    where: eq(agents.workspaceId, workspaceId)
  });
}
```

### 3.4 RBAC 权限模型

| 角色 | 描述 | 权限 |
|------|------|------|
| **Owner** | Workspace 创建者 | 全部权限 + 删除 Workspace + 管理计费 |
| **Admin** | 管理员 | 成员管理 + 设置管理 + 资源全权限 |
| **Editor** | 编辑者 | Agent/KB/Session CRUD + 使用全部资源 |
| **Member** | 成员 | 使用共享 Agent/KB + 创建自己的 Session |

复用现有 RBAC 表（`rbac_roles`, `rbac_permissions`, `rbac_role_permissions`），扩展权限 category：
- `workspace:manage` — 管理 Workspace 设置
- `workspace:members` — 管理成员
- `workspace:billing` — 管理计费
- `workspace:agent:*` — Agent CRUD
- `workspace:kb:*` — 知识库 CRUD
- `workspace:provider:*` — AI Provider 配置

### 3.5 前端改造

#### 新增 Zustand Store

```typescript
// src/store/workspace/store.ts
interface WorkspaceState {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  members: WorkspaceMember[];
  myRole: WorkspaceRole;
}

interface WorkspaceActions {
  switchWorkspace: (id: string) => void;
  createWorkspace: (params: CreateWorkspaceParams) => Promise<void>;
  inviteMember: (email: string, role: WorkspaceRole) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  updateSettings: (settings: WorkspaceSettings) => Promise<void>;
}
```

#### UI 组件

1. **Workspace Switcher**（导航栏）— 切换当前 Workspace
2. **Workspace Settings Page**（`src/routes/(main)/settings/workspace/`）
   - 基本信息（名称、头像、描述）
   - 成员管理（邀请、角色调整、移除）
   - AI Provider 配置
   - API Key 管理
3. **Member Management**（`src/features/WorkspaceMembers/`）
4. **Invite Flow**（邀请链接/邮件）

#### 路由改造

```
/workspace/:workspaceId/agent/:agentId
/workspace/:workspaceId/settings
/workspace/:workspaceId/members
```

或者通过 header/cookie 传递 workspaceId，保持现有路由不变（推荐，侵入性更小）。

### 3.6 资源共享模型

| 资源类型 | 所属级别 | 共享方式 |
|---------|---------|---------|
| Agent | Workspace | Workspace 内所有成员可见/可用 |
| Knowledge Base | Workspace | Workspace 内共享，权限按角色 |
| File | Workspace | 随 Agent/KB 共享 |
| Session | 用户 | 用户私有，属于某个 Workspace 上下文 |
| Topic/Message | 用户 | 用户私有 |
| AI Provider Config | Workspace | Admin+ 可配置，全员可用 |
| API Key | Workspace | Admin+ 可配置，加密存储 |
| User Memory | 用户 | 始终私有 |

### 3.7 数据迁移方案

1. **Phase 1**：创建 `workspaces` 和 `workspace_members` 表
2. **Phase 2**：为每个现有用户自动创建 Personal Workspace（type='personal'）
3. **Phase 3**：为所有资源表添加 `workspace_id` 列（nullable）
4. **Phase 4**：回填数据 — 将现有数据的 `workspace_id` 设为用户的 Personal Workspace ID
5. **Phase 5**：将 `workspace_id` 设为 NOT NULL，添加索引
6. **Phase 6**：更新所有 Model/Repository 查询逻辑

---

## 四、任务拆解（Linear Sub-Issues）

### Phase 1: 基础设施（数据库 + Auth）

| # | 任务 | 优先级 | 预估 |
|---|------|--------|------|
| 1.1 | **数据库 Schema：创建 workspaces、workspace_members、workspace_invitations 表** | P0 | 3pt |
| 1.2 | **数据迁移：为现有用户创建 Personal Workspace 并回填 workspace_id** | P0 | 5pt |
| 1.3 | **核心资源表添加 workspace_id 列**（agents, sessions, topics, messages, knowledge_bases, files, documents） | P0 | 5pt |
| 1.4 | **tRPC Context 和 Middleware 改造：注入 workspaceId + 权限验证** | P0 | 5pt |
| 1.5 | **RBAC 权限扩展：定义 Workspace 级角色和权限** | P1 | 3pt |

### Phase 2: 后端 API

| # | 任务 | 优先级 | 预估 |
|---|------|--------|------|
| 2.1 | **Workspace tRPC Router：CRUD + 设置管理** | P0 | 3pt |
| 2.2 | **成员管理 Router：邀请、加入、移除、角色变更** | P0 | 3pt |
| 2.3 | **改造 Agent Router：workspace 级数据隔离** | P0 | 5pt |
| 2.4 | **改造 Session/Topic/Message Router：workspace 级数据隔离** | P0 | 5pt |
| 2.5 | **改造 KnowledgeBase/File/Document Router：workspace 级数据隔离** | P1 | 5pt |
| 2.6 | **改造 AI Provider/Model/APIKey Router：workspace 级配置** | P1 | 3pt |

### Phase 3: 前端 UI

| # | 任务 | 优先级 | 预估 |
|---|------|--------|------|
| 3.1 | **Workspace Zustand Store 实现** | P0 | 3pt |
| 3.2 | **Workspace Switcher 组件（导航栏）** | P0 | 3pt |
| 3.3 | **Workspace 设置页面（基本信息 + 成员管理）** | P0 | 5pt |
| 3.4 | **邀请流程 UI（链接邀请 + 邮件邀请）** | P1 | 3pt |
| 3.5 | **Workspace 级 AI Provider 设置页面** | P1 | 3pt |
| 3.6 | **现有页面适配 Workspace 上下文** | P1 | 5pt |

### Phase 4: 高级功能

| # | 任务 | 优先级 | 预估 |
|---|------|--------|------|
| 4.1 | **Workspace 级用量统计和计费** | P2 | 5pt |
| 4.2 | **Workspace 数据导入/导出** | P2 | 3pt |
| 4.3 | **Workspace 级审计日志** | P2 | 3pt |
| 4.4 | **SSO/SCIM 集成（Enterprise）** | P2 | 5pt |

---

## 五、风险和注意事项

1. **数据迁移风险**：现有大量数据需要回填 workspace_id，需要分批执行避免锁表
2. **性能影响**：所有查询增加 workspace_id 条件，需要确保索引覆盖
3. **向后兼容**：Personal Workspace 必须完全兼容现有单用户行为，用户无感知
4. **权限复杂度**：需要明确 "用户在 Workspace A 创建的 Agent 是否可以在 Workspace B 使用" 等边界问题
5. **实时协作**：本期不包含实时协作编辑，仅做资源级共享

---

## 六、关键文件路径

### 需修改的核心文件
- `packages/database/src/schemas/` — 所有 schema 文件添加 workspaceId
- `packages/database/src/models/` — 所有 model 文件改造查询逻辑
- `src/server/routers/lambda/` — 40+ tRPC router 适配
- `src/libs/trpc/` — Context 和 middleware 改造
- `src/app/(backend)/middleware/auth/` — Auth middleware 注入 workspace
- `src/store/` — 新增 workspace store，改造现有 store
- `src/routes/(main)/settings/` — 新增 workspace 设置页面
- `src/features/` — 新增 Workspace 相关 feature 组件

### 需新建的文件
- `packages/database/src/schemas/workspace.ts` — Workspace schema
- `packages/database/src/models/workspace.ts` — Workspace model
- `src/server/routers/lambda/workspace.ts` — Workspace tRPC router
- `src/store/workspace/` — Workspace zustand store
- `src/features/Workspace/` — Workspace UI 组件
- `src/features/WorkspaceMembers/` — 成员管理组件
- `src/routes/(main)/settings/workspace/` — Workspace 设置路由

---

## 七、验证方案

1. **单元测试**：为 Workspace model/repository 编写 Vitest 测试
2. **集成测试**：验证 tRPC router 的 workspace 隔离
3. **迁移测试**：在 staging 环境验证数据迁移脚本
4. **E2E 测试**：验证 Workspace 切换、成员管理、资源共享流程
5. **兼容性测试**：确保 Personal Workspace 下现有功能无回归
