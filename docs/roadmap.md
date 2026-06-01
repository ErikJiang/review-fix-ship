# Roadmap

## 优先级 P1

- 在 GitHub Actions 中确认 macOS、Ubuntu 和原生 Windows 的首次 CI 运行结果。
- 分别在 Codex 与 GitHub Copilot CLI 中安装 skill 并完成一次真实仓库交互 smoke test。
- 增加 CodeGraph CLI 的受控初始化子命令：只在用户确认后执行 `codegraph init -i`，并自动检查 `.gitignore` 是否需要忽略 `.codegraph/`。

## 优先级 P2

- 增加自动化兼容性检查，确认 Copilot cloud agent、Copilot CLI 和 VS Code agent mode 的行为差异。
- 增加 repository template 自动发现与交互选择，覆盖多个 GitHub PR template 和 GitLab MR template。
- 在产生真实用户后评估状态 schema 迁移机制；预发布阶段旧 run 直接拒绝并要求重建。

## 优先级 P3

- 增加 token 节省统计：汇总 `rtk gain`、CodeGraph 使用次数和原生命令回退次数。
- 为更多代码托管平台增加 adapter，例如 Gitea 和 Bitbucket。
- 增加可选的团队共享状态导出包，默认仍保持仓库外部存储。
