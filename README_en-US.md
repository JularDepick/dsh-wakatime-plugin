<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.5.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.5.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: quantify every dsh Agent interaction as a visualized performance metric and automatically sync it to WakaTime, using data to showcase your productivity with Agent.

---


## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- Credentials (two slots): the write slot takes a WakaTime API key (prefix `waka_`) and reports heartbeats, while the read slot takes a personal OAuth access token (prefix `waka_tok_`) and reads the account plus cloud stats; a missing slot counts as unconfigured, the two slots must belong to the same WakaTime user (verified automatically on save), each slot can be saved or replaced on its own, "Clear credential" clears both, and changing credentials never touches local stats; credentials are guarded by a local mini-backend and never exposed to the frontend, and every read surface only echoes the first and last 8 characters with a fixed run of 8 stars in between
- Scheduled batch reporting: pushes once at startup, then loops by a configurable interval (default 60 seconds); when the backlog reaches 20 entries it merges about a tenth of the backlog into one bulk request (capped at WakaTime's limit of 25 per request), keeping each heartbeat's own timestamp
- Push queue with retries: unsent heartbeats are persisted and survive a restart (except while legacy data waits for the migration you confirm in the Web UI, when the plugin runs read-only); failures return to the tail of the queue and are retried up to 3 times per heartbeat, and once attempts are exhausted or a payload error (400/404/422) occurs the entry shows up in the report log, where the failed row can be clicked to requeue it; a rejected credential (401, plus any 403 whose message indicates a permission problem) never drops heartbeats, the whole batch rotates to the queue tail until the credential works again, while other 403 responses count as retryable failures; every record carries a detail summary (the categories plus project/branch of that push, and the failure reason when it failed)
- Single local dataset: stats totals, cloud snapshot, pending queue, and report log exist as one set, independent of the credential, so changing credentials loses nothing and there is no longer a per-credential cache to manage
- Token statistics: precisely record the input/output Token count of each Agent call
- Agent collaboration battle stats: globally aggregated prompt characters, model thinking time, output TOKEN total, effective TOKEN usage, cache hit TOKEN total, and average output speed, viewable anytime in the Web interface; the stats table can toggle its cell borders, and numbers can be grouped by thousands or ten thousands
- Instant configuration: open the config view from the "Settings" button at the top right of the WakaTime tab to change both credential slots, reporting options, and interface switches in one place; changes apply immediately, with no save button
- Cloud sync merge: with the read slot configured, automatically sync the latest WakaTime cloud AI summary (last 7 days) and merge it into local battle stats, taking the maximum of each comparable metric for cloud/local consistency; changing the credential invalidates the cloud snapshot and re-syncs automatically; results are cached locally, so switching tabs or refreshing the page does not re-request the cloud
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
dsh plugin --profile <name> add dsh-wakatime-plugin-<version>.tgz
```

> Installing from the GitHub source fetches source code rather than build artifacts, and pnpm runs the package's `prepare` build script on install. pnpm 10+ refuses to run git dependencies' build scripts until explicitly allowed, so the first `add` will fail: add the package key printed by pnpm (like `dsh-wakatime-plugin`) to that profile's `pnpm-workspace.yaml`, then re-run:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> This authorization means the package's code executes on your machine during installation, so only authorize packages whose source you trust.


## Compatibility

- dsh versions: supports the tested range `>=0.2.1-rc.1 <=0.2.2-rc.1`; all share one artifact, so no per-version install is needed. dsh 0.2.2-rc.1 hosts themselves require Node.js `>=24.9.0`, which prevails when running on that version.
- Install check: the manifest declares the tested version range `>=0.2.1-rc.1 <=0.2.2-rc.1` in `engines.dsh` and in the peer ranges of the host packages; if installation or startup reports the plugin as incompatible with the running dsh version, that dsh version has not been tested and is outside the range.
- Later versions: any dsh version above 0.2.2-rc.1 (including the 0.2.2 release, 0.2.2-rc.2 and 0.3.x) is rejected by this plugin until it is tested and the upper bound is raised.
- Upgrading from 0.3.0: the credential migrates automatically on the first start (the saved credential list is converted into the two slots: a plugin API key goes to the write slot and an OAuth token goes to the read slot, so a user who only saved an API key still needs a personal OAuth token in the read slot). The local dataset is migrated only after you confirm it in the Web UI: when 0.3.0 data is detected the plugin runs read-only (the old file is never overwritten) and shows a red line reading "Legacy data found, click to migrate" right below the report log title; clicking it merges the per-credential datasets into one (stats summed item by item, pending queue merged by heartbeat identity with counters summed (same-millisecond duplicates no longer lose one side), newest cloud snapshot kept; the 0.3.0 failed-task list is not inherited and comes out empty, keeping only batch-level report entries), merges the older `stats.json` and `heartbeats.json` in when the data file is missing, and the red line disappears once it succeeds. Until you confirm the migration, this run keeps new stats in memory only, so they are lost on restart; click the red line as soon as you see it. After the migration the local dataset is decoupled from the credential, so later credential changes no longer affect stats. The `statsScope` config field and the `WAKATIME_API_KEY` environment variable were removed in 0.4.0 (that variable is back since 0.5.0 as a temporary write-slot API key, see Usage below); leftover entries in an existing `cordis.yml` are not rejected but no longer read, and other defaults are unchanged (`tableBorders` on, `digitGrouping` `thousand`).
- Upgrading from 0.4.x: the saved OAuth token migrates automatically into the **read slot** (it is a personal token and only has read permission) and the write slot starts empty, so reporting pauses after the upgrade (heartbeats keep queueing and none are lost); generate an API key at https://wakatime.com/settings/api-key, put it in the write slot, and the backlog resumes on its own. The config file structure version goes from 3 to 4 and the old file is archived as `config.json.v3.<timestamp>.bak`; the local data file keeps its structure, so stats and the pending queue carry over. The `WAKATIME_API_KEY` environment variable removed in 0.4.0 is back in 0.5.0 with a new meaning: a temporary write-slot API key
- Back up `~/.dsh/plugins/wakatime` before upgrading. 0.3.0 and 0.4.0 must not share the same data directory (the older build rewrites the new structure as empty legacy data and loses stats), and do not downgrade after upgrading; restore from the backup if you must. 0.4.x and 0.5.0 must not run side by side either: 0.5.0 raises the config structure version to 4, while 0.4.x has no structure-version gate and treats a v4 config as corrupt, archiving it as `config.json.corrupt.<timestamp>.bak` and rebuilding an empty config, which silently clears the credentials. Every dsh profile of the same user shares this directory (see Platforms & Paths), so as long as one profile still runs 0.4.x it can overwrite the config upgraded by another; upgrade all profiles together rather than just one. The migration you confirm in the Web UI archives the legacy data file as `buckets.json.v2.<timestamp>.bak`, the even older `stats.json` and `heartbeats.json` are merged in when the data file is missing and are then archived as `*.legacy.*.bak`, and a corrupt or unrecognized file is likewise archived as `*.corrupt.*.bak` or `*.unknown.*.bak` before being rebuilt. The API key has no read surface, so saving probes it with one empty-payload heartbeat (a valid key answers 400/422, which counts as writable; 401/403 marks the key as rejected and blocks the save; the probe itself writes no data). While the write slot is rejected by the server, or the two slots are confirmed to be different accounts, heartbeats stay queued instead of being dropped, and the main view shows the reason plus the backlog count.


## Usage

After installing and enabling the plugin, fill in both slots in the credential section of the config view:

- **Write slot: WakaTime API key** (prefix `waka_` plus a 36 character UUID, 41 characters in total; generate it at https://wakatime.com/settings/api-key) reports heartbeats. The official docs mark it as write-only and plugin-only and it cannot read the account or stats, which is why the second slot exists;
- **Read slot: personal OAuth access token** (prefix `waka_tok_`, from https://wakatime.com/oauth while signed in) reads the account profile and syncs cloud stats;
- Both slots must belong to the **same WakaTime user**: on save the plugin writes one probe heartbeat with a unique marker, reads it back through the read slot, and deletes it right away, so no data point remains in the reports (the account's `last_heartbeat_at` and the plugin stats metadata still update); if the two slots are confirmed to be different accounts the save is rejected with a reason, and when the check cannot be completed (network or scope problems) the save still goes through while the main view shows a "the two slots are not confirmed as the same account" notice;
- A `waka_sec_` value is an OAuth client secret and works in neither slot; pasting a token into the write slot or an API key into the read slot is rejected as a wrong credential type for that slot.

Ways to configure:

- **Manually**: in the WakaTime tab of the Web interface, open the config view via the "Settings" button at the top right and save each slot there (the input validates the format first; overwrite only, never shown);
- **Agent-assisted**: ask the Agent to call the `wakatime_config` tool (op=set_credential with `slot` set to `write` or `read` and `secret` carrying the credential) to configure it for you;
- **Environment variables**: `WAKATIME_API_KEY` (write slot) and `WAKATIME_OAUTH_TOKEN` (read slot) act as temporary credentials that take precedence over the file and are never written to disk.

Each slot keeps a single credential: saving again overwrites that slot (local stats keep accumulating), and "Clear credentials" clears both slots and returns to the signed-out state while local stats stay intact. When the matching environment variable is set for a slot, saving that slot is rejected with a hint, clearing skips that slot (the other slot is still cleared and the notice names what was skipped), and only when both slots are supplied by environment variables does the clear fail as a whole; remove the variable and restart dsh to take back control.

While either slot is missing the plugin counts as unconfigured: heartbeats are not pushed but keep queueing, and they resume automatically once both slots are filled in.
Switches and the report interval in the config view apply immediately, with no save button (numeric fields commit on blur or Enter).

The plugin then tracks AI interactions in DSH and reports them to WakaTime on a scheduled basis.

| Tool | Purpose |
|:---:|:---:|
| `wakatime_config` | Read/update plugin config (op=get/set); credentials: `set_credential` requires `slot` (`write` takes an API key, `read` takes an OAuth access token) and `secret` (the credential itself); overwrite only, never shown |
| `wakatime_logout` | Clear both local credential slots (local stats are kept) |
| `wakatime_status` | Show both slot statuses, the same-account verdict, and the transmission state (queued count, failed count, last success time, credential rejection reason; never echoes any plaintext) |
| `wakatime_stats` | Show Agent collaboration battle stats (prompt characters, estimated prompt Token, model thinking duration, output TOKEN total, effective TOKEN usage, cache hit TOKEN total, input TOKEN total, average output speed; same source as the UI stats table) |


## Configuration

Plugin configuration is provided through the DSH `cordis.yml`:

Precedence: `cordis.yml` is the configuration source; values changed in the Web UI configuration view are written to the local settings block and from then on override the same keys in `cordis.yml`. Only keys explicitly changed in the UI are recorded, so untouched keys still follow `cordis.yml`; to hand a key back to `cordis.yml`, change it once in the UI or clear the local settings block.

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # master switch: when off, new heartbeats are dropped while queued ones are kept
    locale: zh-CN          # Host tool copy language (Web UI follows the dsh web language)
    reportInterval: 60     # Scheduled report interval (seconds, 1..3600); reports once at startup, then loops
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
| `WAKATIME_OAUTH_TOKEN` | WakaTime OAuth access token (temporary read-slot credential taking precedence over the file) |
| `WAKATIME_API_KEY` | WakaTime API key (temporary write-slot credential, also taking precedence over the file) |
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

# 2. Pack the standard npm tarball (contains build artifacts, cordis.patch.yml, the scripts/ build and pack helpers, LICENSE/COPYRIGHT, and the zh/en READMEs; no src/ source tree or dependencies)
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
