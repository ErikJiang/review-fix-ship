# Provider Adapters

## GitHub

Use the optional `gh` adapter:

```text
gh pr view <url> --json number,title,baseRefName,headRefName,files,url
gh pr diff <url>
gh pr create --title <title> --body-file <file> --base <base> [--draft]
```

Do not call `gh pr create --dry-run` as a preview. GitHub CLI documents that it may still push.

## GitLab

Use the optional `glab` adapter:

```text
glab mr view <url>
glab mr diff <url>
glab mr create --title <title> --description <body> --target-branch <base> --source-branch <branch> [--draft]
```

Do not pass `--fill`, `--push`, or `--yes`. Keep preview generation local.

## Missing CLI

Treat `gh` and `glab` as optional. When the relevant adapter is absent:

1. Continue local branch, path, and diff analysis where possible.
2. Generate the English draft locally.
3. Report that remote read or submission is unavailable.
4. Ask the user to install and authenticate the CLI only if they want the remote action.

Do not install CLIs automatically.

## Templates

Before using bundled templates, check repository conventions:

- GitHub: `.github/pull_request_template.md` and `.github/PULL_REQUEST_TEMPLATE/*.md`
- GitLab: `.gitlab/merge_request_templates/*.md`

Use an existing repository template when one clearly applies. Otherwise use the bundled provider asset.
