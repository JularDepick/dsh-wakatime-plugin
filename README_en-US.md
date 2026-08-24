<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.1.1-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.1.1)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: quantify every dsh Agent interaction as a visualized performance metric and automatically sync it to WakaTime — use data to showcase your productivity with Agent.

## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- API key authentication: one WakaTime API key, guarded by a local mini-backend, never exposed to the frontend
- Scheduled batch reporting: reports once at startup, then batches by a configurable interval (default 60 seconds)
- Token statistics: precisely record the input/output Token count of each Agent call
- Agent collaboration battle stats: globally aggregated prompt tokens, LLM thinking time, output tokens, API effective token usage, viewable anytime in the Web interface
- Cloud sync merge: with an API key configured, automatically sync the latest WakaTime cloud AI summary (last 7 days) and merge it into local battle stats, taking the maximum of each comparable metric for cloud/local consistency
- Global AI session tracking: all heartbeats unify into one overall AI session, with automatic project detection
- Local-first: credentials and configuration data are stored locally by default, fully controlled by the user

## Installation

```bash
# Install via the DSH plugin command (available after publishing to npm)
dsh plugin --profile <name> add dsh-wakatime-plugin

# Or install directly from the GitHub source (auto-builds on install, see below)
dsh plugin --profile <name> add github:JularDepick/dsh-wakatime-plugin

# Or install from the released tarball locally (prebuilt, no build required)
dsh plugin --profile <name> add release/dsh-wakatime-plugin-0.1.1.tgz
```

> Installing from the GitHub source fetches source code rather than build artifacts, and pnpm runs the package's `prepare` build script on install. pnpm 10+ refuses to run git dependencies' build scripts until explicitly allowed, so the first `add` will fail: add the package key printed by pnpm (like `dsh-wakatime-plugin`) to that profile's `pnpm-workspace.yaml`, then re-run:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> This authorization means the package's code executes on your machine during installation — only authorize packages whose source you trust.

## Usage

After installing and enabling the plugin, configure a WakaTime API key (generate one at wakatime.com/settings/api-key):

- **Manually**: paste it into the WakaTime tab of the Web interface (overwrite only, never echoed back);
- **Agent-assisted**: ask the Agent to call the `wakatime_config` tool (op=set_apikey) to configure it for you;
- **Environment variable**: set `WAKATIME_API_KEY` (takes precedence over the file).

After configuring an API key, you can clear it in the tab to return to the logged-out state.

The plugin then tracks AI interactions in DSH and reports them to WakaTime on a scheduled basis.

| Tool | Purpose |
|:---:|:---|
| `wakatime_config` | Read/update plugin config (op=get/set); overwrite the API key (op=set_apikey, overwrite only, never shown) |
| `wakatime_logout` | Clear the local API key |
| `wakatime_status` | Show the authorization status (never echoes the key) |
| `wakatime_stats` | Show Agent collaboration battle stats (prompts, thinking time, token usage) |

## Configuration

Plugin configuration is provided through the DSH `cordis.yml`:

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # Whether to enable data reporting
    locale: zh-CN          # Host tool copy language (Web UI follows the dsh web language)
    reportInterval: 60     # Scheduled report interval (seconds); reports once at startup, then loops
    reportEnabled: true    # Whether to enable scheduled reporting
    includeTokens: true    # Whether to report Token usage
    includePrompts: true   # Whether to report prompt length
    debug: false           # Debug logging switch
```

Environment variables:

| Variable | Description |
|:---:|:---|
| `WAKATIME_API_KEY` | WakaTime API key (takes precedence over the file) |
| `WAKATIME_DEBUG` | Enable debug logging |
| `WAKATIME_CONFIG_DIR` | Override the credential config directory (default `~/.dsh/plugins/wakatime`) |

## Publish & Distribute

Standard distribution workflow (run manually at the repository root):

```bash
# 1. Type-check and build artifacts (tsdown outputs dist/)
pnpm typecheck
pnpm build

# 2. Pack the standard npm tarball directly into release/ (contains dist and cordis.patch.yml, no node_modules or source)
pnpm pack --pack-destination release
```

Artifacts and purposes:

| Artifact | Purpose |
|:---:|:---|
| `release/dsh-wakatime-plugin-<version>.tgz` | Local/offline install: `dsh plugin --profile <name> add <tgz path>`; also serves as material for publishing to the npm registry (future `npm publish`) |

> The artifact is prebuilt, so installation requires no build permission. The repository does not commit `dist/` or `release/` (see .gitignore): installing from the GitHub source relies on the `prepare` build, while installing from the tarball works offline.

## Related Links

- dsh official repository: https://github.com/deepseek-ai/deepseek-harness
- dsh official plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime official: https://wakatime.com

## License

Licensed under the **MIT License**, see [LICENSE](./LICENSE).

## Copyright

Copyright &copy; 2026 JularDepick, see [COPYRIGHT](./COPYRIGHT).