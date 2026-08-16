<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-waka-time-plugin/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English]
| [简体中文](./README.md)

</div>

Quantify every AI interaction of DeepSeek Harness (DSH) into visualized battle achievements, synchronize them to WakaTime automatically, and prove your Agent productivity with data.

## Features

- Automatically track, quantify, and report AI Agent work data in DSH to WakaTime
- Support the official WakaTime OAuth 2.0 login flow, no manual API Key input required
- Heartbeat reporting: report DSH activity to the WakaTime API in Heartbeat format
- Token statistics: precisely record the input/output Token count of each Agent call
- Session tracking: organize data by DSH session, automatically detect the current project
- Local-first: credentials and configuration data are stored locally by default, fully controlled by the user

## Installation

```bash
# Install via the DSH plugin command (available after release)
dsh plugin --profile <name> add dsh-wakatime-plugin

# Or install directly from GitHub
dsh plugin --profile <name> add github:JularDepick/dsh-waka-time-plugin
```

## Usage

After installing and enabling the plugin, it automatically tracks AI interactions in DSH and reports them to WakaTime. First use requires completing WakaTime account authorization (see "Configuration" below).

## Configuration

Plugin configuration is provided through the DSH `cordis.yml`:

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # Whether to enable data reporting
    locale: en-US          # UI language
    clientId: ''           # WakaTime OAuth App Client ID (or use environment variable)
    clientSecret: ''       # WakaTime OAuth App Client Secret (or use environment variable)
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

## Related Links

- dsh official repository: https://github.com/deepseek-ai/deepseek-harness
- dsh official plugin development docs: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime official: https://wakatime.com

## License

Licensed under the **MIT License**, see [LICENSE](./LICENSE).

## Copyright

Copyright &copy; 2026 JularDepick, see [COPYRIGHT](./COPYRIGHT).