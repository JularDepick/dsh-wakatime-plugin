<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.2.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.2.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: quantify every dsh Agent interaction as a visualized performance metric and automatically sync it to WakaTime, using data to showcase your productivity with Agent.

---


## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- API key authentication: one WakaTime API key, guarded by a local mini-backend, never exposed to the frontend
- Scheduled batch reporting: reports once at startup, then batches by a configurable interval (default 60 seconds)
- Token statistics: precisely record the input/output Token count of each Agent call
- Agent collaboration battle stats: globally aggregated prompt volume, LLM thinking time, output tokens, and API effective token usage, viewable anytime in the Web interface
- Instant configuration: open the config view from the "Settings" button at the top right of the WakaTime tab to change the API key and reporting options in one place; changes apply immediately, with no save button
- Cloud sync merge: with an API key configured, automatically sync the latest WakaTime cloud AI summary (last 7 days) and merge it into local battle stats, taking the maximum of each comparable metric for cloud/local consistency; results are cached locally, so switching tabs or refreshing the page does not re-request the cloud
- Global AI session tracking: all heartbeats unify into one overall AI session, with automatic detection of the project and Git branch that the session working directory belongs to (subdirectories and worktrees supported)
- Local totals survive restarts: local-only metrics such as LLM thinking time and estimated prompt tokens are written to a local snapshot and keep accumulating across dsh restarts instead of resetting to zero
- Local-first: credentials and configuration data are stored locally by default, fully controlled by the user


## Installation

```bash
# Install via the DSH plugin command (available after publishing to npm)
dsh plugin --profile <name> add dsh-wakatime-plugin

# Or install directly from the GitHub source (auto-builds on install, see below)
dsh plugin --profile <name> add github:JularDepick/dsh-wakatime-plugin

# Or install from the released tarball locally (prebuilt, no build required)
dsh plugin --profile <name> add dsh-wakatime-plugin-0.2.0.tgz
```

> Installing from the GitHub source fetches source code rather than build artifacts, and pnpm runs the package's `prepare` build script on install. pnpm 10+ refuses to run git dependencies' build scripts until explicitly allowed, so the first `add` will fail: add the package key printed by pnpm (like `dsh-wakatime-plugin`) to that profile's `pnpm-workspace.yaml`, then re-run:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> This authorization means the package's code executes on your machine during installation, so only authorize packages whose source you trust.


## Usage

After installing and enabling the plugin, configure a WakaTime API key (generate one at wakatime.com/settings/api-key):

- **Manually**: in the WakaTime tab of the Web interface, open the config view via the "Settings" button at the top right and paste it there (overwrite only, never shown);
- **Agent-assisted**: ask the Agent to call the `wakatime_config` tool (op=set_apikey) to configure it for you;
- **Environment variable**: set `WAKATIME_API_KEY` (takes precedence over the file).

After configuring an API key, you can clear it in the API key section of the config view to return to the logged-out state.

Switches and the report interval in the config view apply immediately, with no save button (numeric fields commit on blur or Enter).

The plugin then tracks AI interactions in DSH and reports them to WakaTime on a scheduled basis.

| Tool | Purpose |
|:---:|:---:|
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
|:---:|:---:|
| `WAKATIME_API_KEY` | WakaTime API key (takes precedence over the file) |
| `WAKATIME_DEBUG` | Enable debug logging |
| `WAKATIME_CONFIG_DIR` | Override the credential config directory (default `$DSH_HOME/plugins/wakatime`, that is `~/.dsh/plugins/wakatime`) |
| `DSH_HOME` | dsh home directory, affects the default credential config location (default `~/.dsh`) |
| `NODE_USE_ENV_PROXY` | Set to `1` to route plugin requests through the environment proxy variables `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (requires Node 24 or later) |


## Platforms & Paths

- Platforms: Windows, macOS, Linux (WSL); credentials and configuration live at `$DSH_HOME/plugins/wakatime/config.json` by default, that is `~/.dsh/plugins/wakatime/config.json` in the usual case; a battle-stats snapshot `stats.json` lives in the same directory, and deleting it resets the local totals.
- Permissions: on POSIX platforms the config directory and file are tightened to `0700` and `0600` respectively; Windows has no POSIX permission bits and relies on user-profile ACLs.
- Project and branch detection: based on the session working directory, the project name comes from the Git repository root (sessions in a repository subdirectory or a worktree belong to the same project); the branch comes from the Git head file, and stays empty on a detached HEAD.
- Network: single requests time out after 30 seconds and are retried as network failures; report requests carry plugin and host identification, so WakaTime can classify the editor and operating system; to use a proxy, set `NODE_USE_ENV_PROXY=1` together with `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (requires Node 24 or later).


## Publish & Distribute

Standard distribution workflow (run manually at the repository root):

```bash
# 1. Type-check and build artifacts
pnpm typecheck
pnpm build

# 2. Pack the standard npm tarball (contains build artifacts, cordis.patch.yml, LICENSE/COPYRIGHT, and the zh/en READMEs; no source or dependencies)
#    pnpm pack triggers the prepare build again
pnpm run pack
```

Artifacts and purposes:

| Artifact | Purpose |
|:---:|:---:|
| `dsh-wakatime-plugin-<version>.tgz` | Local/offline install: `dsh plugin --profile <name> add <tgz path>`; also serves as material for publishing to the npm registry (future `npm publish`) |

> The artifact is prebuilt, so installation requires no build permission. Installing from the GitHub source relies on the `prepare` build, while installing from the tarball works offline.


## Related Links

- dsh official repository: https://github.com/deepseek-ai/deepseek-harness
- dsh official plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime official: https://wakatime.com


## Copyright

Copyright &copy; 2026 JularDepick, see [COPYRIGHT](./COPYRIGHT).


## License

Licensed under the **MIT License**, see [LICENSE](./LICENSE).
