# review-fix-ship

`review-fix-ship` 是一套面向 Codex 和 GitHub Copilot 的跨平台代码 review、修复规划、受控编码和 PR/MR 交付 Agent Skill。支持 macOS、Linux 和 Windows。

它会在指定的分支、`base...head`、目录、文件、GitHub PR 或 GitLab MR 中筛选最多 5 个经过验证的高价值问题。用户选择问题后，它可以创建独立 branch 或 worktree，生成行动计划，在计划批准后编码、自检，并输出简短英文 PR/MR title 与 description。

## 核心约束

- 不为凑数输出低价值问题。
- `workspace create`、本地 commit、push、创建 PR/MR 都有独立确认门禁。
- 不自动 force、reset、clean，不覆盖用户未提交改动。
- 行动计划和运行状态保存在仓库外部。
- 外部 token 优化工具均为可选能力：自动探测、存在时主动使用、缺失时优雅降级。
- 不自动安装工具，不自动修改全局代理配置。

## 环境要求

必需：

- Git，支持 `git worktree`
- Node.js `>= 18`

可选：

- [`gh`](https://cli.github.com/)：读取或创建 GitHub PR
- [`glab`](https://docs.gitlab.com/cli/)：读取或创建 GitLab MR
- [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman)：压缩代理输出
- [`rtk-ai/rtk`](https://github.com/rtk-ai/rtk)：压缩 shell、Git、测试和构建输出
- [`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph)：使用本地索引降低代码探索调用数

## 支持的 Agent Host

- Codex
- GitHub Copilot cloud agent
- GitHub Copilot CLI
- VS Code 中的 GitHub Copilot agent mode

## 使用 GitHub CLI 安装

GitHub 官方 `gh skill` 命令当前处于 public preview，需要 GitHub CLI `>= 2.90.0`。

安装到 Codex 用户目录：

```bash
gh skill install ErikJiang/review-fix-ship review-fix-ship --agent codex --scope user
```

安装到 GitHub Copilot 用户目录：

```bash
gh skill install ErikJiang/review-fix-ship review-fix-ship --agent github-copilot --scope user
```

项目级安装时省略 `--scope user`。多个 host 在项目级通常共享 `.agents/skills`。

发布 release 前，可在仓库根目录校验：

```bash
gh skill publish --dry-run
```

## 手工安装

将整个 `review-fix-ship` 目录放到代理可发现的 skills 目录。

Codex 默认可使用：

```text
~/.codex/skills/review-fix-ship/
```

GitHub Copilot 用户级目录：

```text
~/.copilot/skills/review-fix-ship/
~/.agents/skills/review-fix-ship/
```

GitHub Copilot 项目级目录：

```text
.github/skills/review-fix-ship/
.claude/skills/review-fix-ship/
.agents/skills/review-fix-ship/
```

GitHub Copilot 的 `.github/copilot-instructions.md` 与 Agent Skills 是两套能力：前者用于仓库级指导，后者用于按任务加载的可复用工作流。

## 快速开始

macOS 或 Linux：

```bash
reviewctl="<skill-dir>/scripts/reviewctl.mjs"
node "$reviewctl" preflight --repo /path/to/repo
node "$reviewctl" tools status --repo /path/to/repo
node "$reviewctl" scope normalize --repo /path/to/repo --scope main...feature --scope src
```

Windows PowerShell：

```powershell
$reviewctl = "<skill-dir>\scripts\reviewctl.mjs"
node "$reviewctl" preflight --repo C:\path\to\repo
node "$reviewctl" tools status --repo C:\path\to\repo
node "$reviewctl" scope normalize --repo C:\path\to\repo --scope main...feature --scope src
```

调用 skill 时，可以直接描述目标：

```text
Use $review-fix-ship to review main...feature and src/auth, return up to five
high-value findings, and ask me which findings to handle.
```

也可以传入 GitHub PR 或 GitLab MR 链接。

## 完整工作流

1. **预检与探测**：运行 `preflight` 和 `tools status`，检查仓库状态、平台、可选 CLI 和 token 优化工具。
2. **归一化范围**：运行 `scope normalize`，获取 `runId`。多个范围统一去重后评选全局 Top 5。
3. **记录候选**：代理按 `references/review-rubric.md` 完成 review，将 findings 写入外部 JSON，再运行：

   ```bash
   node "$reviewctl" state record-findings --repo <repo> --run-id <run-id> --file <findings.json>
   node "$reviewctl" state select --repo <repo> --run-id <run-id> --id RF-001
   ```

4. **隔离修复**：用户选择 branch 或 worktree。先预览，再确认创建：

   ```bash
   node "$reviewctl" workspace preview --repo <repo> --run-id <run-id> --finding-id RF-001 --mode worktree
   node "$reviewctl" workspace create  --repo <repo> --run-id <run-id> --finding-id RF-001 --mode worktree --preview-token <token> --confirm
   ```

   每个 preview 都会返回一次性 `previewToken`。对应 create 或 run 必须传入该 token；缺失、过期、重复使用或参数漂移都会被拒绝。

5. **计划批准**：代理生成外部行动计划。用户明确批准后，状态才能进入 `plan_approved`，随后才允许编码。
6. **编码与自检**：完成代码变更、项目原生测试和 diff 自我 review，记录 `self-reviews/RF-001.md`。
7. **受控交付**：依次预览并单独确认 commit、push、PR/MR 创建。执行命令必须携带匹配 preview 返回的一次性 token。任何一步都不会自动跳过用户确认。

## Token 优化工具

运行 `preflight` 或 `tools status` 后，skill 会自主选择可用工具：

| 工具 | 适用场景 | 缺失时 |
| --- | --- | --- |
| `caveman` | 压缩进度消息和总结 | 手工保持简短输出 |
| `rtk` | `git diff`、搜索、读取文件、测试、lint、构建日志 | 使用原生命令 |
| CodeGraph | 结构探索、调用链、影响面、受影响测试 | 使用 `rg` 和定向读取 |

CodeGraph 首次初始化会创建 `.codegraph/`，skill 必须先询问确认，再运行：

```bash
codegraph init -i
```

`rtk` 在原生 Windows 下可以使用过滤能力，但自动 Bash hook 有限制，因此 skill 会显式调用 `rtk`。WSL 按 Linux 处理。

## 可选工具安装

以下命令来自各项目官方文档。安装会修改本机环境，应由用户自行确认和执行。

### caveman

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex
```

### rtk

macOS：

```bash
brew install rtk
```

Linux 可使用官方脚本；Windows 使用 [releases](https://github.com/rtk-ai/rtk/releases) 中的 `rtk-x86_64-pc-windows-msvc.zip`。

### CodeGraph

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
```

## 状态目录

默认状态位置：

```text
${REVIEW_FIX_SHIP_HOME:-${CODEX_HOME:-~/.codex}/review-fix-ship}/
  repos/<fingerprint>/runs/<run-id>/
```

状态不进入目标仓库。可通过 `--state-home <path>` 覆盖。

## 验证

```bash
node --check scripts/reviewctl.mjs
node --test scripts/reviewctl.test.mjs
node scripts/reviewctl.mjs help
```

基础测试不依赖 Python、npm、`gh`、`glab`、`rtk` 或 CodeGraph。

## 待完善事项

见 [TODO.md](TODO.md)。
