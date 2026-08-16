<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-waka-time-plugin/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

A plugin for dsh: quantify every dsh Agent interaction as a visualized performance metric and automatically sync it to WakaTime — use data to showcase your productivity with Agent.

## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- Support the official WakaTime OAuth 2.0 login flow, no manual API Key input required
- Heartbeat reporting: report DSH activity to the WakaTime API in Heartbeat format
- Token statistics: precisely record the input/output Token count of each Agent call
- Performance metrics panel: globally aggregated heartbeats, tokens, and tool calls, viewable anytime in the Web interface
- Global AI session tracking: all heartbeats unify into one overall AI session, with automatic project detection
- Local-first: credentials and configuration data are stored locally by default, fully controlled by the user

## Installation

```bash
# Install via the DSH plugin command (available after release)
dsh plugin --profile <name> add dsh-wakatime-plugin

# Or install directly from GitHub
dsh plugin --profile <name> add github:JularDepick/dsh-waka-time-plugin
```

## Usage

After installing and enabling the plugin, ask the Agent to call the `wakatime_login` tool to start the WakaTime OAuth authorization flow (a browser opens automatically and credentials are saved after authorization). The plugin then tracks AI interactions in DSH and reports them to WakaTime automatically.

| Tool | Purpose |
|:---:|:---|
| `wakatime_login` | Start the WakaTime OAuth 2.0 authorization login |
| `wakatime_logout` | Revoke the authorization and clear local credentials |
| `wakatime_status` | Show the current authorization status |
| `wakatime_stats` | Show session battle stats (heartbeats, token usage, tool calls) |

## Configuration

Plugin configuration is provided through the DSH `cordis.yml`:

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # Whether to enable data reporting
    locale: en-US          # UI language
    clientId: ''           # OAuth App Client ID (built-in default is used when empty)
    clientSecret: ''       # OAuth App Client Secret (empty means public client mode)
    callbackPort: 5843     # OAuth local callback port
    heartbeatInterval: 120 # Minimum heartbeat reporting interval (seconds)
    includeTokens: true    # Whether to report Token usage
    includePrompts: true   # Whether to report prompt length
    debug: false           # Debug logging switch
```

Environment variables:

| Variable | Description |
|:---:|:---|
| `WAKATIME_CLIENT_ID` | WakaTime OAuth App Client ID (takes precedence over config) |
| `WAKATIME_CLIENT_SECRET` | WakaTime OAuth App Client Secret (takes precedence over config) |
| `WAKATIME_DEBUG` | Enable debug logging |
| `WAKATIME_CONFIG_DIR` | Override the credential config directory (default `~/.dsh/plugins/wakatime`) |

## Related Links

- dsh official repository: https://github.com/deepseek-ai/deepseek-harness
- dsh official plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime official: https://wakatime.com

## License

Licensed under the **MIT License**, see [LICENSE](./LICENSE).

## Copyright

Copyright &copy; 2026 JularDepick, see [COPYRIGHT](./COPYRIGHT).