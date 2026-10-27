<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.4.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.4.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

一个 dsh 插件: 将 DSH 的每一次 Agent 交互量化为可视化表现指标,自动同步至 WakaTime,用数据展示你与 Agent 协作的生产力.

---


## 特性

- 自动追踪,量化并上报 DSH 中的 AI Agent 工作数据至 WakaTime 平台
- 凭证: 只支持个人 OAuth 访问令牌(前缀 `waka_tok_`),插件密钥不再支持;本地只保存一份凭证,可随时覆盖保存或清除,更换凭证不影响本地战绩;凭证经本地小后端保管,前端永不接触明文,任何读取面只回显首尾各 8 个字符、中间固定 8 个星号
- 定时批量上报: 启动时推送一轮,之后按可配置间隔(默认 60 秒)循环;积压达到 20 条时按积压量的十分之一合并成一次批量请求(单批不超过 WakaTime 的 25 条上限),每条心跳保留自己的时间戳
- 推送队列与重试: 未发送的心跳落盘保留,重启不丢;失败自动回到队尾重试,单条最多 3 次,耗尽或遇到 400/404/422 等载荷错误即进入上报记录,可在界面上点击该失败行重新排队重试;凭证失效(401/403)不会丢心跳,整批留在队列等待凭证恢复;每条记录都带详情(本次上报的类别与项目/分支,失败时附失败原因)
- 单一本地数据: 战绩累计、云端快照、待发送队列与上报记录只有一份,与凭证无关,更换凭证不丢数据,也不再按凭证拆分多份缓存
- Token 统计: 精确记录每次 Agent 调用的 input/output Token 数量
- Agent 协作战绩: 全局汇总提示词字符总量,模型思考总时长,输出 TOKEN 总量,有效 TOKEN 消耗量,缓存命中 TOKEN 总量与平均输出速度等表现指标,在 Web 界面随时查看;战绩表支持开关边框显示,数值可按千位或万位分隔
- 配置即改即生效: 在 WakaTime 标签页右上角「配置」切换出配置视图,凭证管理,上报参数与界面开关在同一处完成,改动立即生效,无需保存
- 云端同步合并: 配置凭证后自动同步云端最近 7 天的 AI 汇总,与本地战绩对应指标取最大值合并展示,保证云端与本地一致;更换凭证后云端快照作废并自动重新同步;同步结果本地缓存,切换标签页与刷新页面不重复请求云端
- 会话追踪: 全局统一组织 AI 会话数据(全部心跳归为一个整体 AI 会话),自动识别会话工作目录所属项目与 Git 分支(支持子目录与 worktree)
- 本地累计保留: LLM 思考总时长与提示词 Token 估算等本地独有指标写入本地数据文件,重启 dsh 后继续累加,不会归零
- 本地优先: 凭证和配置数据默认存储在本地,用户完全掌控


## 安装

```bash
# 通过 DSH 插件命令安装(发布到 npm 后可用)
dsh plugin --profile <name> add dsh-wakatime-plugin

# 或从 GitHub 源码直接安装(安装时自动构建,见下方说明)
dsh plugin --profile <name> add github:JularDepick/dsh-wakatime-plugin

# 或使用发布 tarball 本地安装(预构建产物,无需构建)
dsh plugin --profile <name> add dsh-wakatime-plugin-0.4.0.tgz
```

> 从 GitHub 源码安装拉取的是源码而非构建产物,pnpm 会在安装时运行包的 `prepare` 构建脚本;pnpm 10 及以上默认拒绝执行 git 依赖的构建脚本,首次 `add` 会失败: 把 pnpm 打印的包键(形如 `dsh-wakatime-plugin`)加入该 profile 的 `pnpm-workspace.yaml` 后再重新执行:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> 该授权意味着允许该包的代码在安装时于你的机器上执行,请只对源码可信的包授权.


## 兼容性

- dsh 版本: 支持实测过的 0.2.1-rc.1 至 0.2.1-rc.3(含 0.2.1-rc.2),共用同一份产物,无需按版本分别安装.
- 安装校验: 包清单以 `engines.dsh` 与宿主包对等依赖声明实测版本区间 `>=0.2.1-rc.1 <=0.2.1-rc.3`;若安装或启动时报插件与当前 dsh 版本不兼容,说明当前 dsh 版本尚未实测,不在区间内.
- 后续版本: 高于 0.2.1-rc.3 的 dsh 版本(含 0.2.1 正式版与 0.3.x)都会被本插件拒绝,需要等待插件实测并推进上界.
- 从 0.3.0 升级: 首次启动自动迁移: 从已保存的凭证列表里挑出一份 OAuth 令牌作为唯一凭证(插件密钥因官方只允许写入、无法读取战绩而不再支持,只保存过插件密钥的用户需要改用个人 OAuth 令牌),分凭证的多份本地数据合并为一份(战绩逐项求和、待发送队列与失败任务按标识去重合并、云端快照取最新),更早版本的 `stats.json` 与 `heartbeats.json` 在数据文件缺失时并入;迁移后本地数据与凭证解耦,此后更换凭证不再影响战绩;`statsScope` 配置项与 `WAKATIME_API_KEY` 环境变量已移除,旧 `cordis.yml` 里的残留项不会被拒绝,但插件不再读取,因此不生效,其余默认值不变(`tableBorders` 默认开启,`digitGrouping` 默认 `thousand`).
- 升级前请备份 `~/.dsh/plugins/wakatime` 目录;0.3.0 与 0.4.0 不能同时使用同一数据目录(旧版本会把新版结构重写成空的旧结构,导致战绩丢失),升级后也不要回退,确需回退时先用备份恢复.首次迁移会把旧数据文件归档为 `buckets.json.v2.<时间戳>.bak`,损坏或无法识别的文件同样会把原件归档为 `*.corrupt.*.bak` 或 `*.unknown.*.bak` 后重建.


## 使用

安装并启用插件后,在配置视图的凭证区粘贴个人 OAuth 访问令牌即可:

- **OAuth 访问令牌**: 前缀 `waka_tok_`,登录后访问 https://wakatime.com/oauth 获取(页面直接给出个人令牌,自用无需创建应用);需要自定义 scope 或供他人使用时,在 https://wakatime.com/apps 创建应用,授权时以 `scope` 参数申请 write_heartbeats、read_summaries、email;
- **插件密钥**(前缀 `waka_`)不再支持: 官方把它限定为写入专用,而战绩读取与云端同步需要读取权限,粘贴会被拒绝并提示改用个人令牌;
- 前缀 `waka_sec_` 是 OAuth 应用密钥,不能当凭证使用,粘贴同样会被拒绝.

配置方式:

- **手动**: 在 Web 界面会话区域的 WakaTime 标签页,点右上角「配置」进入配置视图后粘贴保存(输入框会先做格式校验,仅覆盖,不可查看);
- **Agent 引导**: 让 Agent 调用 `wakatime_config` 工具(op=set_credential)代替你完成配置;
- **环境变量**: 设置 `WAKATIME_OAUTH_TOKEN`(作为临时凭证优先于文件配置,不落盘).

只保留一份凭证: 再次保存即覆盖原凭证(本地战绩继续累计),「清除凭证」回退到未登录状态(本地战绩保留).若设置了 `WAKATIME_OAUTH_TOKEN`,环境变量优先于文件配置,此时保存与清除都会被拒绝并提示,需要先移除该变量再重启 dsh.

配置视图里的开关与上报间隔改动即时生效,无需另点保存(数字字段在失焦或回车后写入).

此后插件会自动追踪 DSH 中的 AI 交互,按定时节奏批量上报至 WakaTime.

| 工具 | 用途 |
|:---:|:---:|
| `wakatime_config` | 查看/修改插件配置(op=get/set);凭证操作: `set_credential` 保存或更换 OAuth 访问令牌,仅覆盖不可查看 |
| `wakatime_logout` | 清除本地凭证(本地战绩保留) |
| `wakatime_status` | 查看认证状态(不回显 Key 明文) |
| `wakatime_stats` | 查看 Agent 协作战绩(提示词字符总量,提示词 Token 估算,模型思考总时长,输出 TOKEN 总量,有效 TOKEN 消耗量,缓存命中 TOKEN 总量,输入 TOKEN 总量,平均输出速度;与界面战绩表同源) |


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
    tableBorders: true     # 战绩表是否显示表格边框(纯展示项)
    digitGrouping: thousand # 数位分隔符: thousand 千位(3 位一组)/ myriad 万位(4 位一组),纯展示项
```

环境变量:

| 变量名 | 描述 |
|:---:|:---:|
| `WAKATIME_OAUTH_TOKEN` | WakaTime OAuth 访问令牌(作为临时凭证优先于文件配置) |
| `WAKATIME_DEBUG` | 启用调试日志 |
| `WAKATIME_CONFIG_DIR` | 覆盖凭证配置存放目录(默认 `$DSH_HOME/plugins/wakatime`,即 `~/.dsh/plugins/wakatime`) |
| `DSH_HOME` | dsh home 目录,影响凭证配置目录的默认位置(默认 `~/.dsh`) |
| `NODE_USE_ENV_PROXY` | 置为 `1` 时让插件请求走环境代理变量 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`(需 Node 24 及以上) |


## 平台与路径

- 运行平台: Windows, macOS, Linux(WSL);凭证与配置默认位于 `$DSH_HOME/plugins/wakatime/config.json`,即通常的 `~/.dsh/plugins/wakatime/config.json`;同目录下另有本地数据文件 `buckets.json`,保存唯一一份战绩累计、云端快照、待发送队列与上报记录(与凭证无关);该目录被同一用户下的多个 dsh profile 共用,写入有文件锁与增量合并保护,不建议手工编辑;升级或数据文件异常时该目录内会出现带时间戳的 `*.bak` 归档文件,可据此核对或恢复.
- 权限: POSIX 平台下配置目录与文件分别收紧为 `0700` 与 `0600`;Windows 无 POSIX 权限位,依赖用户目录 ACL.
- 项目与分支识别: 以会话工作目录为基准,项目名取 Git 仓库根目录名,会话位于仓库子目录或 worktree 中也归到同一项目;分支名解析 Git 头文件,detached HEAD 时分支留空.
- 网络: 单次请求超时 30 秒,超时按网络失败重试;上报请求带插件与宿主标识,便于 WakaTime 归类编辑器与操作系统;需要走代理时设置 `NODE_USE_ENV_PROXY=1` 并配置 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`(需 Node 24 及以上).


## 发布与分发

标准分发流程(在仓库根目录手动执行):

```bash
# 1. 检查类型并构建产物
pnpm typecheck
pnpm build

# 2. 打包标准 npm tarball(含构建产物,cordis.patch.yml 与 LICENSE/COPYRIGHT/中英 README,不含源码与依赖)
#    pnpm pack 会触发 prepare 再次构建
pnpm run pack
```

产物与用途:

| 产物 | 用途 |
|:---:|:---:|
| `dsh-wakatime-plugin-<版本>.tgz` | 本地/离线安装: `dsh plugin --profile <name> add <tgz 路径>`;亦可作为发布到 npm registry 的素材(将来执行 `npm publish`) |

> 产物为预构建形态,安装无需构建权限.从 GitHub 源码安装依赖 `prepare` 构建,从 tarball 安装则可离线使用.


## 相关链接

- dsh 官方仓库: https://github.com/deepseek-ai/deepseek-harness
- dsh 官方插件开发文档: https://github.com/deepseek-ai/deepseek-harness/tree/main/docs/user/develop
- WakaTime 官方: https://wakatime.com


## 版权声明

Copyright &copy; 2026 JularDepick,详见 [COPYRIGHT](./COPYRIGHT).


## 许可证

采用 **Apache-2.0 License**,详见 [LICENSE](./LICENSE).
