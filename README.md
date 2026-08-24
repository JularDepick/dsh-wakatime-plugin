<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.1.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.1.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

一个 dsh 插件:将 DSH 的每一次 Agent 交互量化为可视化表现指标,自动同步至 WakaTime——用数据展示你与 Agent 协作的生产力。

## 特性

- 自动追踪、量化并上报 DSH 中的 AI Agent 工作数据至 WakaTime 平台
- API Key 认证:仅需一个 WakaTime API Key,经本地小后端代理保管,前端永不接触明文
- 定时批量上报:启动时上报一次,之后按可配置间隔(默认 60 秒)批量同步
- Token 统计:精确记录每次 Agent 调用的 input/output Token 数量
- Agent 协作战绩:全局汇总提示词总量、LLM 思考总时长、输出 Token、API 有效 Token 消耗等表现指标,在 Web 界面随时查看
- 云端同步合并:配置 API Key 后自动同步云端最近 7 天的 AI 汇总,与本地战绩对应指标取最大值合并展示,保证云端与本地一致
- 会话追踪:全局统一组织 AI 会话数据(全部心跳归为一个整体 AI 会话),自动识别当前项目
- 本地优先:凭证和配置数据默认存储在本地,用户完全掌控

## 安装

```bash
# 通过 DSH 插件命令安装(发布到 npm 后可用)
dsh plugin --profile <name> add dsh-wakatime-plugin

# 或从 GitHub 源码直接安装(安装时自动构建,见下方说明)
dsh plugin --profile <name> add github:JularDepick/dsh-wakatime-plugin

# 或使用发布 tarball 本地安装(预构建产物,无需构建)
dsh plugin --profile <name> add release/tarball/dsh-wakatime-plugin-0.1.0.tgz
```

> 从 GitHub 源码安装拉取的是源码而非构建产物,pnpm 会在安装时运行包的 `prepare` 构建脚本。pnpm 10 及以上默认拒绝执行 git 依赖的构建脚本,首次 `add` 会失败:把 pnpm 打印的包键(形如 `dsh-wakatime-plugin`)加入该 profile 的 `pnpm-workspace.yaml` 后再重新执行:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> 该授权意味着允许该包的代码在安装时于你的机器上执行,请只对源码可信的包授权。

## 使用

安装并启用插件后,配置 WakaTime API Key(在 wakatime.com/settings/api-key 生成):

- **手动**:在 Web 界面会话区域的 WakaTime 标签页粘贴保存(仅覆盖、不回显);
- **Agent 引导**:让 Agent 调用 `wakatime_config` 工具(op=set_apikey)代替你完成配置;
- **环境变量**:设置 `WAKATIME_API_KEY`(优先于文件配置)。

已配置 API Key 后,可在标签页执行「清除 API Key」回退到未登录状态。

此后插件会自动追踪 DSH 中的 AI 交互,按定时节奏批量上报至 WakaTime。

| 工具 | 用途 |
|:---:|:---|
| `wakatime_config` | 查看/修改插件配置(op=get/set);覆盖写入 API Key(op=set_apikey,仅覆盖不可查看) |
| `wakatime_logout` | 清除本地 API Key |
| `wakatime_status` | 查看认证状态(不回显 Key 明文) |
| `wakatime_stats` | 查看 Agent 协作战绩(提示词、思考时长、Token 消耗) |

## 配置

插件的配置通过 DSH 的 `cordis.yml` 提供:

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # 是否启用数据上报
    locale: zh-CN          # 界面语言(host 工具文案;Web UI 语言跟随 dsh web)
    reportInterval: 60     # 定时上报间隔(秒),启动时上报一次后循环
    reportEnabled: true    # 是否开启定时上报
    includeTokens: true    # 是否上报 Token 用量
    includePrompts: true   # 是否上报提示词长度
    debug: false           # 调试日志开关
```

环境变量:

| 变量名 | 描述 |
|:---:|:---|
| `WAKATIME_API_KEY` | WakaTime API Key(优先于文件配置) |
| `WAKATIME_DEBUG` | 启用调试日志 |
| `WAKATIME_CONFIG_DIR` | 覆盖凭证配置存放目录(默认 `~/.dsh/plugins/wakatime`) |

## 发布与分发

标准分发流程(在仓库根目录手动执行):

```bash
# 1. 检查类型并构建产物(tsdown 输出 dist/)
pnpm typecheck
pnpm build

# 2. 打包标准 npm tarball(含 dist 与 cordis.patch.yml,不含 node_modules 与源码)
pnpm pack

# 3. 分发到发布目录(Windows PowerShell)
New-Item -ItemType Directory -Force -Path release\npmjs, release\tarball | Out-Null
Move-Item -Force dsh-wakatime-plugin-0.1.0.tgz release\npmjs\
Copy-Item release\npmjs\dsh-wakatime-plugin-0.1.0.tgz release\tarball\
```

```bash
# 3. 分发到发布目录(bash)
# mkdir -p release/npmjs release/tarball
# mv -f dsh-wakatime-plugin-0.1.0.tgz release/npmjs/
# cp release/npmjs/dsh-wakatime-plugin-0.1.0.tgz release/tarball/
```

产物与用途:

| 目录 | 产物 | 用途 |
|:---:|:---|:---|
| `release/npmjs/` | 标准 npm 包 tarball | 发布到 npm registry 的素材(将来执行 `npm publish`) |
| `release/tarball/` | 同一标准 tarball | 本地/离线安装:`dsh plugin --profile <name> add <tgz 路径>` |

> 两个目录存放同一标准 npm tarball 的两种分发渠道;产物为预构建形态,安装无需构建权限。仓库未提交 `dist/` 与 `release/`(见 .gitignore),从 GitHub 源码安装依赖 `prepare` 构建,从 tarball 安装则可离线使用。

## 相关链接

- dsh 官方仓库: https://github.com/deepseek-ai/deepseek-harness
- dsh 官方插件开发文档: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime 官方: https://wakatime.com

## 许可证

采用 **MIT License**,详见 [LICENSE](./LICENSE)。

## 版权声明

Copyright &copy; 2026 JularDepick,详见 [COPYRIGHT](./COPYRIGHT)。