<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-waka-time-plugin/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

一个 dsh 插件:将 DSH 的每一次 Agent 交互量化为可视化表现指标,自动同步至 WakaTime——用数据展示你与 Agent 协作的生产力。

## 特性

- 自动追踪、量化并上报 DSH 中的 AI Agent 工作数据至 WakaTime 平台
- 支持 WakaTime OAuth 2.0 官方登录流程,无需手动输入 API Key
- 心跳上报:将 DSH 活动以 Heartbeat 格式上报至 WakaTime API
- Token 统计:精确记录每次 Agent 调用的 input/output Token 数量
- 战绩面板:全局汇总心跳、Token、工具调用等表现指标,在 Web 界面随时查看你的 AI 生产力数据
- 会话追踪:全局统一组织 AI 会话数据(全部心跳归为一个整体 AI 会话),自动识别当前项目
- 本地优先:凭证和配置数据默认存储在本地,用户完全掌控

## 安装

```bash
# 通过 DSH 插件命令安装(待发布后可用)
dsh plugin --profile <name> add dsh-wakatime-plugin

# 或从 GitHub 直接安装
dsh plugin --profile <name> add github:JularDepick/dsh-waka-time-plugin
```

## 使用

安装并启用插件后,让 Agent 调用 `wakatime_login` 工具即可启动 WakaTime OAuth 授权流程(自动打开浏览器,授权后自动保存凭证);此后插件会自动追踪 DSH 中的 AI 交互并上报至 WakaTime。

| 工具 | 用途 |
|:---:|:---|
| `wakatime_login` | 启动 WakaTime OAuth 2.0 授权登录 |
| `wakatime_logout` | 撤销授权并清除本地凭证 |
| `wakatime_status` | 查看当前认证状态 |
| `wakatime_stats` | 查看会话战绩(心跳、Token 用量、工具调用) |

## 配置

插件的配置通过 DSH 的 `cordis.yml` 提供:

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # 是否启用数据上报
    locale: zh-CN          # 界面语言
    clientId: ''           # OAuth App Client ID(默认已内置,留空使用默认)
    clientSecret: ''       # OAuth App Client Secret(留空为 public client 模式)
    callbackPort: 5843     # OAuth 本地回调端口
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
| `WAKATIME_CONFIG_DIR` | 覆盖凭证配置存放目录(默认 `~/.dsh/plugins/wakatime`) |

## 相关链接

- dsh 官方仓库: https://github.com/deepseek-ai/deepseek-harness
- dsh 官方插件开发文档: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime 官方: https://wakatime.com

## 许可证

采用 **MIT License**,详见 [LICENSE](./LICENSE)。

## 版权声明

Copyright &copy; 2026 JularDepick,详见 [COPYRIGHT](./COPYRIGHT)。