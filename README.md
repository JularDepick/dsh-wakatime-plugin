<div align="center">

# dsh-wakatime-plugin

[![Version](https://img.shields.io/badge/Version-0.5.0-green)](https://github.com/JularDepick/dsh-wakatime-plugin/tree/v0.5.0)
[![Copyright](https://img.shields.io/badge/Copyright-JularDepick-0066AA)](./COPYRIGHT)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

[English](./README_en-US.md)
| [简体中文]

</div>

一个 dsh 插件: 将 DSH 的每一次 Agent 交互量化为可视化表现指标,自动同步至 WakaTime,用数据展示你与 Agent 协作的生产力.

---


## 特性

- 自动追踪,量化并上报 DSH 中的 AI Agent 工作数据至 WakaTime 平台
- 凭证(双槽): 写入槽用 WakaTime API Key(`waka_` 开头上报心跳),读取槽用个人 OAuth 访问令牌(`waka_tok_` 开头读取账号与云端战绩),两槽缺一即视为未配置且必须属于同一个 WakaTime 用户(保存时自动取证);每槽可单独保存或更换,清除凭证清两槽,更换凭证不影响本地战绩;凭证经本地小后端保管,前端永不接触明文,任何读取面只回显首尾各 8 个字符, 中间固定 8 个星号
- 定时批量上报: 启动时推送一轮,之后按可配置间隔(默认 60 秒)循环;积压达到 20 条时按积压量的十分之一合并成一次批量请求(单批不超过 WakaTime 的 25 条上限),每条心跳保留自己的时间戳
- 推送队列与重试: 未发送的心跳落盘保留,重启不丢(检测到旧版数据, 等待确认迁移期间除外,那时插件只读运行);失败自动回到队尾重试,单条最多 3 次,耗尽或遇到 400/404/422 等载荷错误即进入上报记录,可在界面上点击该失败行重新排队重试;凭证失效(401, 以及提示权限不足的 403)不会丢心跳,整批移到队尾轮转等待凭证恢复,其余 403 按可重试失败计数;每条记录都带详情(本次上报的类别与项目/分支,失败时附失败原因)
- 单一本地数据: 战绩累计, 云端快照, 待发送队列与上报记录只有一份,与凭证无关,更换凭证不丢数据,也不再按凭证拆分多份缓存
- Token 统计: 精确记录每次 Agent 调用的 input/output Token 数量
- Agent 协作战绩: 全局汇总提示词字符总量,模型思考总时长,输出 TOKEN 总量,有效 TOKEN 消耗量,缓存命中 TOKEN 总量与平均输出速度等表现指标,在 Web 界面随时查看;战绩表支持开关边框显示,数值可按千位或万位分隔
- 配置即改即生效: 在 WakaTime 标签页右上角「配置」切换出配置视图,双槽凭证管理,上报参数与界面开关在同一处完成,改动立即生效,无需保存
- 云端同步合并: 读取槽配置后自动同步云端最近 7 天的 AI 汇总,与本地战绩对应指标取最大值合并展示,保证云端与本地一致;更换凭证后云端快照作废并自动重新同步;同步结果本地缓存,切换标签页与刷新页面不重复请求云端
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
dsh plugin --profile <name> add dsh-wakatime-plugin-<版本>.tgz
```

> 从 GitHub 源码安装拉取的是源码而非构建产物,pnpm 会在安装时运行包的 `prepare` 构建脚本;pnpm 10 及以上默认拒绝执行 git 依赖的构建脚本,首次 `add` 会失败: 把 pnpm 打印的包键(形如 `dsh-wakatime-plugin`)加入该 profile 的 `pnpm-workspace.yaml` 后再重新执行:

> ```yaml
> allowBuilds:
>   dsh-wakatime-plugin: true
> ```

> 该授权意味着允许该包的代码在安装时于你的机器上执行,请只对源码可信的包授权.


## 兼容性

- dsh 版本: 支持实测区间 `>=0.2.1-rc.1 <=0.2.2-rc.1`,共用同一份产物,无需按版本分别安装;dsh 0.2.2-rc.1 宿主自身要求 Node.js `>=24.9.0`,在该版本上运行以宿主要求为准.
- 安装校验: 包清单以 `engines.dsh` 与宿主包对等依赖声明实测版本区间 `>=0.2.1-rc.1 <=0.2.2-rc.1`;若安装或启动时报插件与当前 dsh 版本不兼容,说明当前 dsh 版本尚未实测,不在区间内.
- 后续版本: 高于 0.2.2-rc.1 的 dsh 版本(含 0.2.2 正式版,0.2.2-rc.2 与 0.3.x)都会被本插件拒绝,需要等待插件实测并推进上界.
- 从 0.3.0 升级: 凭证在首次启动自动迁移(凭证列表转换为双槽: 插件密钥进写入槽, OAuth 令牌进读取槽;只存过插件密钥的用户还需再补一个个人 OAuth 令牌到读取槽); 本地数据改为在 Web 界面上确认后迁移: 检测到 0.3.0 旧版数据时插件只读运行(不覆盖旧文件),在上报记录标题下方显示一行红字「存在旧版数据, 点击迁移」,点击后把分凭证的多份数据合并为一份(战绩逐项求和, 待发送队列按心跳身份计数归并(同毫秒的重复心跳计数相加, 不再丢弃其中一条), 云端快照取最新;0.3.0 的失败列表不继承,迁移后为空,只保留批次级上报记录),更早版本的 `stats.json` 与 `heartbeats.json` 在数据文件缺失时并入,迁移成功后红字消失;确认迁移之前本进程的战绩只留在内存,重启会丢,看到红字后请尽快点击; 迁移后本地数据与凭证解耦,此后更换凭证不再影响战绩;`statsScope` 配置项与 `WAKATIME_API_KEY` 环境变量在 0.4.0 移除(0.5.0 起该变量重新启用, 语义改为写入槽 API Key 的临时凭证, 详见「使用」一节),旧 `cordis.yml` 里的残留项不会被拒绝,但插件不再读取,其余默认值不变(`tableBorders` 默认开启,`digitGrouping` 默认 `thousand`).
- 从 0.4.x 升级: 已保存的 OAuth 令牌自动迁移到**读取槽**(它是个人令牌, 只有读取权限), 写入槽留空, 因此升级后上报会暂停(心跳留在队列, 一条都不丢), 需要到 https://wakatime.com/settings/api-key 生成 API Key 并填进写入槽, 补齐后积压自动续传;配置文件结构版本由 3 升到 4, 旧文件归档为 `config.json.v3.<时间戳>.bak`;本地数据文件结构不变, 战绩与待发送队列照旧.0.4.0 起移除的 `WAKATIME_API_KEY` 环境变量在 0.5.0 重新启用, 语义改为「写入槽 API Key」的临时凭证
- 升级前请备份 `~/.dsh/plugins/wakatime` 目录;0.3.0 与 0.4.0 不能同时使用同一数据目录(旧版本会把新版结构重写成空的旧结构,导致战绩丢失),升级后也不要回退,确需回退时先用备份恢复.0.4.x 与 0.5.0 同样不能混跑: 0.5.0 把配置文件结构版本升到 4, 0.4.x 没有结构版本闸门, 读到 v4 配置会当成损坏文件归档为 `config.json.corrupt.<时间戳>.bak` 并重建空配置, 凭证随之被清空;同一用户下的多个 dsh profile 共用这个目录(见「平台与路径」), 只要有一个 profile 还在跑 0.4.x, 就会把另一个 profile 已升级的配置覆盖掉, 因此升级时请把所有 profile 一并升级, 不要只升其中一个.在界面上点击迁移后会把旧数据文件归档为 `buckets.json.v2.<时间戳>.bak`,更早版本的 `stats.json` 与 `heartbeats.json` 在数据文件缺失时被并入, 并入后同样归档为 `*.legacy.*.bak`; 损坏或无法识别的文件会把原件归档为 `*.corrupt.*.bak` 或 `*.unknown.*.bak` 后重建.写入槽的 API Key 没有读取面, 保存时以一条空载荷心跳探测(合法密钥被拒为 400/422 即视为可写, 401/403 判为密钥不可用并拒绝保存, 探测本身不写任何数据);写入槽被服务端拒绝或两槽被判定为不同账号时, 心跳留在队列轮转不丢, 主视图显示原因与积压条数.


## 使用

安装并启用插件后,在配置视图的凭证区分别填写两槽:

- **写入槽: WakaTime API Key**(前缀 `waka_` 加 36 位 UUID, 共 41 字符,到 https://wakatime.com/settings/api-key 获取)负责心跳上报;官方该密钥是 `write-only` 的插件专用凭证, 无法读取账号与战绩, 所以需要第二槽;
- **读取槽: 个人 OAuth 访问令牌**(前缀 `waka_tok_`,登录后访问 https://wakatime.com/oauth 获取)负责账号资料与云端战绩同步;
- 两槽必须属于**同一个 WakaTime 用户**: 保存时插件会写一条带唯一标记的探测心跳, 用读取槽回读确认后立刻删除, 报表里不留数据点(账号上的 `last_heartbeat_at` 与插件统计元数据仍会更新);若确认是不同账号, 保存会被拒绝并提示原因;无法确认(网络或权限不足)时照常保存, 并在主视图给出"两槽尚未确认是同一个账号"的提示;
- 前缀 `waka_sec_` 是 OAuth 应用密钥(client secret), 两槽都不能用, 粘贴会被拒绝;把令牌填进写入槽或把 API Key 填进读取槽会按"凭证类型与槽位不符"拒绝.

配置方式:

- **手动**: 在 Web 界面会话区域的 WakaTime 标签页,点右上角「配置」进入配置视图后逐槽粘贴保存(输入框会先做格式校验,仅覆盖,不可查看);
- **Agent 引导**: 让 Agent 调用 `wakatime_config` 工具(op=set_credential,带 `slot` 指定 `write` 或 `read`, 并以 `secret` 传入凭证原文)代替你完成配置;
- **环境变量**: `WAKATIME_API_KEY`(写入槽)与 `WAKATIME_OAUTH_TOKEN`(读取槽)作为临时凭证优先于文件配置,不落盘.

每槽只保留一份凭证: 再次保存即覆盖该槽(本地战绩继续累计),「清除凭证」清两槽并回退到未登录状态(本地战绩保留).若某槽设置了对应环境变量,该槽的保存会被拒绝并提示;清除时该槽会被跳过(另一槽照清,提示里点名跳过的是哪一槽),两槽都被环境变量占住才会整体失败,需要先移除变量再重启 dsh.

两槽缺一时插件视为未配置: 心跳不会推送但会留在队列继续累积,补齐后自动续传.
配置视图里的开关与上报间隔改动即时生效,无需另点保存(数字字段在失焦或回车后写入).

此后插件会自动追踪 DSH 中的 AI 交互,按定时节奏批量上报至 WakaTime.

| 工具 | 用途 |
|:---:|:---:|
| `wakatime_config` | 查看/修改插件配置(op=get/set);凭证操作: `set_credential` 需带 `slot`(`write` 收 API Key,`read` 收 OAuth 访问令牌)与 `secret`(凭证原文),仅覆盖不可查看 |
| `wakatime_logout` | 清除两槽本地凭证(本地战绩保留) |
| `wakatime_status` | 查看两槽认证状态,同账号结论与上报运行态(积压条数,失败数,最近成功时刻,凭证被拒原因;不回显明文) |
| `wakatime_stats` | 查看 Agent 协作战绩(提示词字符总量,提示词 Token 估算,模型思考总时长,输出 TOKEN 总量,有效 TOKEN 消耗量,缓存命中 TOKEN 总量,输入 TOKEN 总量,平均输出速度;与界面战绩表同源) |


## 配置

插件的配置通过 DSH 的 `cordis.yml` 提供:

配置优先级: `cordis.yml` 是配置来源;在界面配置视图里改过的项会写入本地配置文件的 settings 块,并在之后覆盖 `cordis.yml` 的同名项.本地只记录界面上显式改动过的键,没改过的项仍回落到 `cordis.yml`,因此把某项改回 `cordis.yml` 里时,先在界面上改动它一次或清空本地配置文件的 settings 块.

```yaml
- id: wakatime
  name: dsh-wakatime-plugin
  config:
    enabled: true          # 总开关: 关闭后新心跳直接丢弃, 队列里的旧心跳保留
    locale: zh-CN          # 界面语言(host 工具文案;Web UI 语言跟随 dsh web)
    reportInterval: 60     # 定时上报间隔(秒, 取值 1 到 3600),启动时上报一次后循环
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
| `WAKATIME_OAUTH_TOKEN` | WakaTime OAuth 访问令牌(读取槽临时凭证, 作为临时凭证优先于文件配置) |
| `WAKATIME_API_KEY` | WakaTime API Key(写入槽临时凭证, 同样优先于文件配置) |
| `WAKATIME_DEBUG` | 启用调试日志 |
| `WAKATIME_CONFIG_DIR` | 覆盖凭证配置存放目录(默认 `$DSH_HOME/plugins/wakatime`,即 `~/.dsh/plugins/wakatime`) |
| `DSH_HOME` | dsh home 目录,影响凭证配置目录的默认位置(默认 `~/.dsh`) |
| `NODE_USE_ENV_PROXY` | 置为 `1` 时让插件请求走环境代理变量 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`(需 Node 24 及以上) |


## 平台与路径

- 运行平台: Windows, macOS, Linux(WSL);凭证与配置默认位于 `$DSH_HOME/plugins/wakatime/config.json`,即通常的 `~/.dsh/plugins/wakatime/config.json`;同目录下另有本地数据文件 `buckets.json`,保存唯一一份战绩累计, 云端快照, 待发送队列与上报记录(与凭证无关);该目录被同一用户下的多个 dsh profile 共用,写入有文件锁与增量合并保护,不建议手工编辑;升级或数据文件异常时该目录内会出现带时间戳的 `*.bak` 归档文件,可据此核对或恢复.
- 权限: POSIX 平台下配置目录与文件分别收紧为 `0700` 与 `0600`;Windows 无 POSIX 权限位,依赖用户目录 ACL.
- 项目与分支识别: 以会话工作目录为基准,项目名取 Git 仓库根目录名,会话位于仓库子目录或 worktree 中也归到同一项目;分支名解析 Git 头文件,detached HEAD 时分支留空.
- 网络: 单次请求超时 30 秒,超时按网络失败重试;上报请求带插件与宿主标识,便于 WakaTime 归类编辑器与操作系统;需要走代理时设置 `NODE_USE_ENV_PROXY=1` 并配置 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`(需 Node 24 及以上).


## 发布与分发

标准分发流程(在仓库根目录手动执行):

```bash
# 1. 检查类型并构建产物
pnpm typecheck
pnpm build

# 2. 打包标准 npm tarball(含构建产物,cordis.patch.yml,scripts/ 构建与打包脚本,LICENSE/COPYRIGHT,中英 README;不含 src/ 源码目录与依赖)
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
