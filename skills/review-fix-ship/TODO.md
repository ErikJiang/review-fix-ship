# TODO

## 优先级 P1

- 在 GitHub Actions 中确认 macOS、Ubuntu 和原生 Windows 的首次 CI 运行结果。
- 使用 GitHub CLI `>= 2.90.0` 运行 `gh skill publish --dry-run`，验证 public preview 发布流程。
- 分别在 Codex 与 GitHub Copilot CLI 中安装 skill 并完成一次真实仓库 smoke test。
- 增加 CodeGraph CLI 的受控初始化子命令：只在用户确认后执行 `codegraph init -i`，并自动检查 `.gitignore` 是否需要忽略 `.codegraph/`。
- 增加 PR/MR 远端读取适配：通过 `gh pr diff` 和 `glab mr diff` 将远端 diff 缓存到外部状态目录。
- 为 `rtk` 增加更细的命令选择表，并记录每次运行实际采用的压缩路径。

## 优先级 P2

- 增加 `tools doctor`：检查 Node、Git、`gh`、`glab`、`rtk`、CodeGraph 版本和认证状态。
- 增加自动化兼容性检查，确认 Copilot cloud agent、Copilot CLI 和 VS Code agent mode 的行为差异。
- 增加 repository template 自动发现与交互选择，覆盖多个 GitHub PR template 和 GitLab MR template。
- 增加多 finding 合并处理模式，同时保留默认独立 branch/worktree。
- 增加状态 schema 迁移机制，为后续版本兼容已有 run。

## 优先级 P3

- 增加 token 节省统计：汇总 `rtk gain`、CodeGraph 使用次数和原生命令回退次数。
- 为更多代码托管平台增加 adapter，例如 Gitea 和 Bitbucket。
- 增加可选的团队共享状态导出包，默认仍保持仓库外部存储。
