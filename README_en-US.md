<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.3.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.3.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: quantify every dsh Agent interaction as a visualized performance metric and automatically sync it to WakaTime, using data to showcase your productivity with Agent.

---


## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- Dual credential authentication: both a plugin API key and an OAuth access token work, guarded by a local mini-backend and never exposed to the frontend; since 2026-11-01 WakaTime limits API keys to plugin activity submission, so account and stats reads need an OAuth token
- Scheduled batch reporting: pushes once at startup, then loops by a configurable interval (default 60 seconds); when the backlog reaches 20 entries it merges about a tenth of the backlog into one bulk request (capped at WakaTime's limit of 25 per request), keeping each heartbeat's own timestamp
- Push queue with retries: unsent heartbeats are persisted and survive a restart; failures return to the tail of the queue and are retried up to 3 times per heartbeat, and once attempts are exhausted or a terminal error (401/403/400 and friends) occurs the entry shows up in the report log, where the failed row can be clicked to requeue it; every record carries a detail summary (the categories plus project/branch of that push, and the failure reason when it failed)
- Per-account data isolation: every credential keeps its own local data (stats totals, cloud snapshot, pending queue, report log), so switching credentials never credits one account's data to another; data collected while no credential is configured is claimed by the first credential configured afterwards, and no account's data is ever cleaned up automatically; the "API key caches" section in the config view shows each credential's own stats and lets you remove a cache unused for 30 days (keys shown there keep only the first and last 8 characters, everything else is masked with `*`, and the plaintext never leaves the local backend)
- Stats display scope: switch between "all API keys" and "current API key" in the config view (the former is the default)
- Token statistics: precisely record the input/output Token count of each Agent call
- Agent collaboration battle stats: globally aggregated prompt characters, model thinking time, output TOKEN total, effective TOKEN usage, cache hit TOKEN total, and average output speed, viewable anytime in the Web interface; the stats table can toggle its cell borders, and numbers can be grouped by thousands or ten thousands
- Instant configuration: open the config view from the "Settings" button at the top right of the WakaTime tab to change the credential, reporting options, and interface switches in one place; changes apply immediately, with no save button
- Cloud sync merge: with a credential configured, automatically sync the latest WakaTime cloud AI summary (last 7 days) and merge it into local battle stats, taking the maximum of each comparable metric for cloud/local consistency; results are cached locally, so switching tabs or refreshing the page does not re-request the cloud
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
dsh plugin --profile <name> add dsh-wakatime-plugin-0.3.0.tgz
```

> Installing from the GitHub source fetches source code rather than build artifacts, and pnpm runs the package's `prepare` build script on install. pnpm 10+ refuses to run git dependencies' build scripts until explicitly allowed, so the first `add` will fail: add the package key printed by pnpm (like `dsh-wakatime-plugin`) to that profile's `pnpm-workspace.yaml`, then re-run:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> This authorization means the package's code executes on your machine during installation, so only authorize packages whose source you trust.


## Compatibility

- dsh versions: supports the tested 0.2.1-rc.1 through 0.2.1-rc.3 (including 0.2.1-rc.2); all share one artifact, so no per-version install is needed.
- Install check: the manifest declares the tested version range `>=0.2.1-rc.1 <=0.2.1-rc.3` in `engines.dsh` and in the peer ranges of the host packages; if installation or startup reports the plugin as incompatible with the running dsh version, that dsh version has not been tested and is outside the range.
- Later versions: dsh 0.3.x requires a matching newer plugin artifact.
- Upgrading from v0.2.0: configuration and API keys carry over; the old `stats.json` and `heartbeats.json` are merged into the current API key's data bucket on first start and are kept on disk but no longer written; new config fields have defaults (`tableBorders` on, `statsScope` `all`), so an existing `cordis.yml` needs no change.


## Usage

After installing and enabling the plugin, configure a WakaTime credential. Two kinds are supported; pick one with the credential-type segmented control in the config view:

- **Plugin API key**: generate one at wakatime.com/settings/api-key; it submits coding activity (heartbeats);
- **OAuth access token**: create a personal token at wakatime.com/settings and select the write_heartbeats, read_summaries and email scopes; it reads the account profile and stats (WakaTime requires a token for reads since 2026-11-01).

Both kinds support three ways to configure:

- **Manually**: in the WakaTime tab of the Web interface, open the config view via the "Settings" button at the top right and paste it there (overwrite only, never shown);
- **Agent-assisted**: ask the Agent to call the `wakatime_config` tool (op=set_apikey or op=set_token) to configure it for you;
- **Environment variable**: set `WAKATIME_API_KEY` or `WAKATIME_OAUTH_TOKEN` (takes precedence over the file).

When only one credential is configured, both activity submission and reads use it; when both are configured, heartbeats go through the plugin key and reads go through the OAuth token.

After configuring a credential, you can clear it in the credential section of the config view to return to the logged-out state.

Switches and the report interval in the config view apply immediately, with no save button (numeric fields commit on blur or Enter).

The plugin then tracks AI interactions in DSH and reports them to WakaTime on a scheduled basis.

| Tool | Purpose |
|:---:|:---:|
| `wakatime_config` | Read/update plugin config (op=get/set); overwrite the plugin key (op=set_apikey) or the OAuth token (op=set_token), overwrite only, never shown |
| `wakatime_logout` | Clear every local credential |
| `wakatime_status` | Show the authorization status (never echoes the key) |
| `wakatime_stats` | Show Agent collaboration battle stats (prompt characters, model thinking duration, output and effective TOKEN, cache hit TOKEN, average output speed, current stats display scope; same source as the UI stats table) |


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
    tableBorders: true     # Whether the stats table shows cell borders (display only)
    statsScope: all        # Stats display scope: all = every API key, current = current API key
    digitGrouping: thousand # Digit grouping: thousand (groups of 3) or myriad (groups of 4); display only
```

Environment variables:

| Variable | Description |
|:---:|:---:|
| `WAKATIME_API_KEY` | WakaTime plugin key (takes precedence over the file) |
| `WAKATIME_OAUTH_TOKEN` | WakaTime OAuth access token (takes precedence over the file; preferred for reads) |
| `WAKATIME_DEBUG` | Enable debug logging |
| `WAKATIME_CONFIG_DIR` | Override the credential config directory (default `$DSH_HOME/plugins/wakatime`, that is `~/.dsh/plugins/wakatime`) |
| `DSH_HOME` | dsh home directory, affects the default credential config location (default `~/.dsh`) |
| `NODE_USE_ENV_PROXY` | Set to `1` to route plugin requests through the environment proxy variables `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (requires Node 24 or later) |


## Platforms & Paths

- Platforms: Windows, macOS, Linux (WSL); credentials and configuration live at `$DSH_HOME/plugins/wakatime/config.json` by default, that is `~/.dsh/plugins/wakatime/config.json` in the usual case; a per-key data-bucket file `buckets.json` lives in the same directory, holding one set of local data per API key (stats totals, cloud snapshot, pending queue, report log), so deleting a single bucket resets that account's local data and deleting the whole file clears every account's local data (cloud data can still be synced again).
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

Licensed under the **Apache-2.0 License**, see [LICENSE](./LICENSE).
