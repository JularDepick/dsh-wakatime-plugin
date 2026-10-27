<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.4.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.4.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: quantify every dsh Agent interaction as a visualized performance metric and automatically sync it to WakaTime, using data to showcase your productivity with Agent.

---


## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- Credential: only a personal OAuth access token is supported (prefix `waka_tok_`); plugin API keys are no longer accepted. Exactly one credential is stored locally and it can be overwritten or cleared at any time, and changing it never touches local stats; the credential is guarded by a local mini-backend and never exposed to the frontend, and every read surface only echoes the first and last 8 characters with a fixed run of 8 stars in between
- Scheduled batch reporting: pushes once at startup, then loops by a configurable interval (default 60 seconds); when the backlog reaches 20 entries it merges about a tenth of the backlog into one bulk request (capped at WakaTime's limit of 25 per request), keeping each heartbeat's own timestamp
- Push queue with retries: unsent heartbeats are persisted and survive a restart; failures return to the tail of the queue and are retried up to 3 times per heartbeat, and once attempts are exhausted or a payload error (400/404/422) occurs the entry shows up in the report log, where the failed row can be clicked to requeue it; a rejected credential (401/403) never drops heartbeats, the whole batch stays in the queue until the credential works again; every record carries a detail summary (the categories plus project/branch of that push, and the failure reason when it failed)
- Single local dataset: stats totals, cloud snapshot, pending queue, and report log exist as one set, independent of the credential, so changing credentials loses nothing and there is no longer a per-credential cache to manage
- Token statistics: precisely record the input/output Token count of each Agent call
- Agent collaboration battle stats: globally aggregated prompt characters, model thinking time, output TOKEN total, effective TOKEN usage, cache hit TOKEN total, and average output speed, viewable anytime in the Web interface; the stats table can toggle its cell borders, and numbers can be grouped by thousands or ten thousands
- Instant configuration: open the config view from the "Settings" button at the top right of the WakaTime tab to change the credential, reporting options, and interface switches in one place; changes apply immediately, with no save button
- Cloud sync merge: with a credential configured, automatically sync the latest WakaTime cloud AI summary (last 7 days) and merge it into local battle stats, taking the maximum of each comparable metric for cloud/local consistency; changing the credential invalidates the cloud snapshot and re-syncs automatically; results are cached locally, so switching tabs or refreshing the page does not re-request the cloud
- Global AI session tracking: all heartbeats unify into one overall AI session, with automatic detection of the project and Git branch that the session working directory belongs to (subdirectories and worktrees supported)
- Local totals survive restarts: local-only metrics such as LLM thinking time and estimated prompt tokens are written to the local data file and keep accumulating across dsh restarts instead of resetting to zero
- Local-first: credentials and configuration data are stored locally by default, fully controlled by the user


## Installation

```bash
# Install via the DSH plugin command (available after publishing to npm)
dsh plugin --profile <name> add dsh-wakatime-plugin

# Or install directly from the GitHub source (auto-builds on install, see below)
dsh plugin --profile <name> add github:JularDepick/dsh-wakatime-plugin

# Or install from the released tarball locally (prebuilt, no build required)
dsh plugin --profile <name> add dsh-wakatime-plugin-0.4.0.tgz
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
- Later versions: any dsh version above 0.2.1-rc.3 (including the 0.2.1 release and 0.3.x) is rejected by this plugin until it is tested and the upper bound is raised.
- Upgrading from 0.3.0: the first start migrates automatically. One OAuth token is picked from the saved credential list as the only credential (plugin API keys are no longer accepted because the official API limits them to writing, so users who only saved an API key need to switch to a personal OAuth token), and the per-credential datasets are merged into one (stats summed item by item, pending queue and failed tasks deduplicated by identity, newest cloud snapshot kept); on a missing data file, the older `stats.json` and `heartbeats.json` are merged in as well. After the migration the local dataset is decoupled from the credential, so later credential changes no longer affect stats. The `statsScope` config field and the `WAKATIME_API_KEY` environment variable are gone; leftover entries in an existing `cordis.yml` are not rejected but no longer read, so they have no effect, and other defaults are unchanged (`tableBorders` on, `digitGrouping` `thousand`).
- Back up `~/.dsh/plugins/wakatime` before upgrading. 0.3.0 and 0.4.0 must not share the same data directory (the older build rewrites the new structure as empty legacy data and loses stats), and do not downgrade after upgrading; restore from the backup if you must. The first migration archives the legacy data file as `buckets.json.v2.<timestamp>.bak`, and a corrupt or unrecognized file is likewise archived as `*.corrupt.*.bak` or `*.unknown.*.bak` before being rebuilt.


## Usage

After installing and enabling the plugin, paste a personal OAuth access token in the credential section of the config view:

- **OAuth access token**: prefix `waka_tok_`. Open https://wakatime.com/oauth while signed in to get a personal token (no app needed for personal use); for custom scopes or acting for others, create an app at https://wakatime.com/apps and request write_heartbeats, read_summaries and email through the `scope` argument;
- **Plugin API keys** (prefix `waka_`) are no longer supported: the official API limits them to writing, while stats reads and cloud sync need read permission, so pasting one is rejected with a hint to use a personal token;
- A `waka_sec_` value is an OAuth client secret, not a credential: pasting it is rejected as well.

Ways to configure:

- **Manually**: in the WakaTime tab of the Web interface, open the config view via the "Settings" button at the top right and paste it there (the input validates the format first; overwrite only, never shown);
- **Agent-assisted**: ask the Agent to call the `wakatime_config` tool (op=set_credential) to configure it for you;
- **Environment variable**: set `WAKATIME_OAUTH_TOKEN` (a temporary credential taking precedence over the file, never written to disk).

Only one credential is kept: saving again overwrites the previous one (local stats keep accumulating), and "Clear credential" returns to the signed-out state while local stats stay intact. When `WAKATIME_OAUTH_TOKEN` is set it takes precedence over the file, so saving and clearing are both rejected with a hint until you remove the variable and restart dsh.

Switches and the report interval in the config view apply immediately, with no save button (numeric fields commit on blur or Enter).

The plugin then tracks AI interactions in DSH and reports them to WakaTime on a scheduled basis.

| Tool | Purpose |
|:---:|:---:|
| `wakatime_config` | Read/update plugin config (op=get/set); credentials: `set_credential` saves or replaces the OAuth access token; overwrite only, never shown |
| `wakatime_logout` | Clear the local credential (local stats are kept) |
| `wakatime_status` | Show the authorization status (never echoes the key) |
| `wakatime_stats` | Show Agent collaboration battle stats (prompt characters, estimated prompt Token, model thinking duration, output TOKEN total, effective TOKEN usage, cache hit TOKEN total, input TOKEN total, average output speed; same source as the UI stats table) |


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
    digitGrouping: thousand # Digit grouping: thousand (groups of 3) or myriad (groups of 4); display only
```

Environment variables:

| Variable | Description |
|:---:|:---:|
| `WAKATIME_OAUTH_TOKEN` | WakaTime OAuth access token (temporary credential taking precedence over the file) |
| `WAKATIME_DEBUG` | Enable debug logging |
| `WAKATIME_CONFIG_DIR` | Override the credential config directory (default `$DSH_HOME/plugins/wakatime`, that is `~/.dsh/plugins/wakatime`) |
| `DSH_HOME` | dsh home directory, affects the default credential config location (default `~/.dsh`) |
| `NODE_USE_ENV_PROXY` | Set to `1` to route plugin requests through the environment proxy variables `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (requires Node 24 or later) |


## Platforms & Paths

- Platforms: Windows, macOS, Linux (WSL); credentials and configuration live at `$DSH_HOME/plugins/wakatime/config.json` by default, that is `~/.dsh/plugins/wakatime/config.json` in the usual case; a local data file `buckets.json` in the same directory holds the single set of stats totals, cloud snapshot, pending queue, and report log (independent of the credential); this directory is shared by every dsh profile of the same user and writes are guarded by file locks plus incremental merging, so do not edit it by hand; after an upgrade or an abnormal data file you will find timestamped `*.bak` archives there for verification or recovery.
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
