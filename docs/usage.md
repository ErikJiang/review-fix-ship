# review-fix-ship

`review-fix-ship` 是一套面向 Codex 和 GitHub Copilot 的跨平台代码 review、修复规划、受控编码和 PR/MR 交付 Agent Skill。支持 macOS、Linux 和 Windows。

它会在指定的分支、`base...head`、目录、文件、GitHub PR 或 GitLab MR 中筛选最多 5 个经过验证的高价值问题。报告会保留全部 findings，但用户每次只激活一个问题进行计划、编码、自检和 PR/MR 交付。

## 核心约束

- 不为凑数输出低价值问题。
- `workspace create`、本地 commit、push、创建 PR/MR 都有独立确认门禁。
- 不自动 force、reset、clean，不覆盖用户未提交改动。
- 机器状态保存在仓库外部；可读报告和计划镜像到 ignored `.review-fix-ship/` 目录。
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
node "$reviewctl" tools policy --repo /path/to/repo
node "$reviewctl" tools doctor --repo /path/to/repo --provider all
node "$reviewctl" review start --repo /path/to/repo --scope main...feature --scope src
```

Windows PowerShell：

```powershell
$reviewctl = "<skill-dir>\scripts\reviewctl.mjs"
node "$reviewctl" preflight --repo C:\path\to\repo
node "$reviewctl" tools status --repo C:\path\to\repo
node "$reviewctl" tools policy --repo C:\path\to\repo
node "$reviewctl" tools doctor --repo C:\path\to\repo --provider all
node "$reviewctl" review start --repo C:\path\to\repo --scope main...feature --scope src
```

当 branch、tag 或 commit-ish 与仓库路径同名时，使用 `ref:<value>` 或 `path:<value>` 显式消歧。例如：`--scope ref:src` 审查 `src` 分支，`--scope path:src` 审查 `src/` 目录。无歧义输入仍可省略前缀。

调用 skill 时，可以直接描述目标：

```text
Use $review-fix-ship to review main...feature and src/auth, return up to five
high-value findings, and ask me which findings to handle.
```

也可以传入 GitHub PR 或 GitLab MR 链接。

## 完整工作流

1. **预检与探测**：运行 `preflight`、`tools status`、`tools policy` 和按需执行的 `tools doctor`，检查仓库状态、平台、可选 CLI、认证和 token 优化工具。
2. **归一化并激活策略**：默认运行 `review start` 获取 `runId` 并立即激活 token-efficiency 策略。多个范围统一去重后评选全局 Top 5。`scope normalize` 与 `efficiency activate` 保留给恢复和高级脚本。
3. **初始化产物并记录候选**：代理按 [`review-rubric.md`](../skills/review-fix-ship/references/review-rubric.md) 完成 review，将带简要示例的 findings 写入外部 JSON，再运行：

   ```bash
   node "$reviewctl" artifacts init preview --repo <repo> --run-id <run-id>
   node "$reviewctl" artifacts init run     --repo <repo> --run-id <run-id> --preview-token <token> --confirm
   node "$reviewctl" state record-findings --repo <repo> --run-id <run-id> --file <findings.json>
   node "$reviewctl" state activate --repo <repo> --run-id <run-id> --id RF-001
   ```

4. **隔离修复**：用户选择 branch 或 worktree。先预览，再确认创建：

   ```bash
   node "$reviewctl" workspace preview --repo <repo> --run-id <run-id> --finding-id RF-001 --mode worktree [--start-ref <ref> --target-branch <branch>]
   node "$reviewctl" workspace create  --repo <repo> --run-id <run-id> --finding-id RF-001 --mode worktree [--start-ref <ref> --target-branch <branch>] --preview-token <token> --confirm
   ```

   单个 `base...head` comparison 会从 `head` 创建修复 workspace，并将后续 PR/MR 目标设为 `base`。混合 diff scope 或尚未读取元数据的远端 review scope 必须显式提供 `--start-ref` 与 `--target-branch`。
   每个 preview 都会返回一次性 `previewToken`。对应 create 或 run 必须传入该 token；缺失、过期、重复使用或参数漂移都会被拒绝。

5. **计划批准**：代理生成外部行动计划。用户明确批准后，状态才能进入 `plan_approved`，随后才允许编码。
6. **编码与自检**：完成代码变更、项目原生测试和 diff 自我 review。权威记录保存在外部状态目录，镜像写入 `.review-fix-ship/runs/<run-id>/workspaces/RF-001/self-review.md`。
7. **受控交付**：依次预览并单独确认 commit、push、PR/MR 创建。执行命令必须携带匹配 preview 返回的一次性 token。`commit preview` 与 `commit run` 还必须通过重复 `--file <path>` 明确列出相同预期文件；执行时会拒绝任何缺失或额外 staged 文件。push preview 和 push run 都要求当前 `HEAD` 与已自检并记录的 commit 完全一致；出现追加提交时必须重新自检和确认。任何一步都不会自动跳过用户确认。

## Token 优化工具

运行 `preflight`、`tools status` 或 `tools policy` 后，skill 会输出统一 execution policy。默认使用 `review start` 作为探索前门禁，它会完成 scope 归一化、记录 run 状态并激活效率策略，默认优先启用 `caveman lite` 与显式 RTK wrapper：

| 工具 | 适用场景 | 缺失时 |
| --- | --- | --- |
| `caveman` | 使用 `lite` 压缩进度消息和总结 | 手工保持简短输出 |
| `rtk` | Git 读取、diff、搜索、文件读取和枚举、测试、lint、构建、手工 provider 读取 | 使用定向原生命令并记录回退 |
| CodeGraph | 结构探索、调用链、影响面、受影响测试 | 使用 `rg` 和定向读取 |

CodeGraph 首次初始化会创建 `.codegraph/`，skill 必须先询问确认，再运行：

```bash
codegraph init -i
```

`rtk` 在原生 Windows 下可以使用过滤能力，但自动 Bash hook 有限制，因此 skill 会显式调用 `rtk`。WSL 按 Linux 处理。`reviewctl` 状态命令、`remote fetch` 内部 provider 调用和 Git 写操作始终保持 raw。

首次使用某类 RTK route 时记录一次；任何 native 回退都记录原因：

```bash
node "$reviewctl" efficiency record --repo <repo> --run-id <run-id> --route rtk-search --outcome used
node "$reviewctl" efficiency record --repo <repo> --run-id <run-id> --route rtk-test --outcome fallback --reason detail-hidden
node "$reviewctl" efficiency status --repo <repo> --run-id <run-id>
```

可用 route：`rtk-git-read`、`rtk-diff`、`rtk-search`、`rtk-file-read`、`rtk-file-list`、`rtk-test`、`rtk-lint`、`rtk-build`、`rtk-provider-read`。

可用回退原因：`tool-unavailable`、`unsupported-command`、`wrapper-failed`、`detail-hidden`、`raw-required`。

审计为声明式状态记录，不代理执行任意 shell。可读镜像位于 `.review-fix-ship/runs/<run-id>/efficiency.md` 与 `efficiency.json`。`rtk gain` 仍为可选能力，不进入必需流程。

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

机器状态不进入目标仓库，可通过 `--state-home <path>` 覆盖。完成 `artifacts init` 后，可读镜像位于：

```text
<repo-or-worktree>/.review-fix-ship/runs/<run-id>/
```

默认将 `.review-fix-ship/` 写入 Git common directory 的 `info/exclude`。只有显式使用 `--track-ignore` 时才会修改根 `.gitignore`。

## 恢复与查看

```bash
node "$reviewctl" version
node "$reviewctl" state status --repo <repo> --latest
node "$reviewctl" artifacts list --repo <repo> --run-id <run-id>
node "$reviewctl" artifacts show --repo <repo> --run-id <run-id> [--finding-id RF-001] [--kind <kind>]
node "$reviewctl" efficiency status --repo <repo> --run-id <run-id>
node "$reviewctl" remote fetch --repo <repo> --run-id <run-id>
node "$reviewctl" state defer  --repo <repo> --run-id <run-id> --finding-id RF-001 --reason <text>
node "$reviewctl" state finish --repo <repo> --run-id <run-id> --finding-id RF-001 --outcome <committed|pushed|submitted>
```

`state select` 仅作为兼容别名保留，并且同样只接受一个 finding。新流程使用 `state activate`。

## 验证

```bash
node --check scripts/reviewctl.mjs
node --test scripts/reviewctl.test.mjs
node scripts/reviewctl.mjs help
```

仓库根目录额外运行 `node scripts/smoke-installed-skill.mjs`。基础测试不依赖 Python、npm、`gh`、`glab`、`rtk` 或 CodeGraph。

## 待完善事项

见 [roadmap.md](roadmap.md)。
