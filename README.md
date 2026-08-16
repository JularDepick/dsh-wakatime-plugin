<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-waka-time-plugin/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

将 DeepSeek Harness (DSH) 的每一次 AI 交互量化为可视化战绩,自动同步至 WakaTime,用数据证明你的 Agent 生产力。

## 特性

- 自动追踪、量化并上报 DSH 中的 AI Agent 工作数据至 WakaTime 平台
- 支持 WakaTime OAuth 2.0 官方登录流程,无需手动输入 API Key
- 心跳上报:将 DSH 活动以 Heartbeat 格式上报至 WakaTime API
- Token 统计:精确记录每次 Agent 调用的 input/output Token 数量
- 会话追踪:按 DSH 会话(Session)维度组织数据,自动识别当前项目
- 本地优先:凭证和配置数据默认存储在本地,用户完全掌控

## 安装

```bash
# 通过 DSH 插件命令安装(待发布后可用)
dsh plugin --profile <name> add dsh-wakatime-plugin

# 或从 GitHub 直接安装
dsh plugin --profile <name> add github:JularDepick/dsh-waka-time-plugin
```

## 使用

安装并启用插件后,插件会自动追踪 DSH 中的 AI 交互并上报至 WakaTime。首次使用需要完成 WakaTime 账号授权(见下方"配置")。

## 配置

插件的配置通过 DSH 的 `cordis.yml` 提供:

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # 是否启用数据上报
    locale: zh-CN          # 界面语言
    clientId: ''           # WakaTime OAuth App Client ID(或使用环境变量)
    clientSecret: ''       # WakaTime OAuth App Client Secret(或使用环境变量)
    heartbeatInterval: 120 # 心跳上报最小间隔(秒)
    includeTokens: true    # 是否上报 Token 用量
    includePrompts: true   # 是否上报提示词长度
    debug: false           # 调试日志开关
```

环境变量:

| 变量名 | 描述 |
|:---:|:---|
| `WAKATIME_CLIENT_ID` | WakaTime OAuth App Client ID(优先于配置项) |
| `WAKATIME_CLIENT_SECRET` | WakaTime OAuth App Client Secret(优先于配置项) |
| `WAKATIME_DEBUG` | 启用调试日志 |

## 相关链接

- dsh 官方仓库: https://github.com/deepseek-ai/deepseek-harness
- dsh 官方插件开发文档: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime 官方: https://wakatime.com

## 许可证

采用 **MIT License**,详见 [LICENSE](./LICENSE)。

## 版权声明

Copyright &copy; 2026 JularDepick,详见 [COPYRIGHT](./COPYRIGHT)。