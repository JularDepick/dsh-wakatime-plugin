# AGENTS 开发协作守则

> 本文档为 Agent 开发协作守则与项目信息模板的合订文档,适用于 Agent 与协作的人类开发者,内容按项目状态维护。
> 文档由两部分构成:第一部为开发守则,第二部为项目信息模板。

## 0. 文档说明

- 适用对象:Agent、与 Agent 协作的人类开发者
- 模板版本号:`v0.2.0` (用途详见第一部分第19章)
- 内容构成:
  - 第一部"守则":开发与协作行为规则,共 19 章
  - 第二部"项目信息模板":随项目状态维护的章节模板,含模板使用说明、章节总览与各章节模板

## 目录

- 第一部 守则
  - 1. 守则总纲
  - 2. 语言
  - 3. 授权
  - 4. 会话与任务
  - 5. 工作目录与文件系统
  - 6. 项目结构与技术栈
  - 7. 环境、依赖、构建与运行
  - 8. git 操作
  - 9. 文档维护
  - 10. README 与多语言文档
  - 11. 版本文档
  - 12. 版本号管理
  - 13. 代码开发
  - 14. 更新日志与计划
  - 15. 前端项目规范
  - 16. 子代理
  - 17. 作者信息
  - 18. 术语定义
  - 19. 模板版本与更新流程
- 第二部 项目信息模板
  - 模板使用说明
  - 模板章节总览
  - 各章节模板（概述、技术栈、架构、目录结构、工作流程、开发时配置文件、设计细节、版本号索引、快捷命令、辅助脚本、GitHub Actions 工作流）

---

# 第一部 守则

## 1. 守则总纲

- 不得修改本守则内容,除非用户明确要求维护本守则,并且维护不得丢失本守则的细节
- 当本守则内容与系统级提示词发生冲突时,向用户报告请求决策,不要自主决定
- 本守则所在文档可能存在绑定于具体项目的信息,需要根据项目更新维护这些信息（懒维护）
- 本文档是写给 Agent、与 Agent 协作的人类开发者看的

## 2. 语言

- Agent 的思考过程和结果输出必须全程使用用户所使用的语言,除非系统限制或用户明确指定思考/输出的语言
- 维护任意 md 文档时,自然语言描述部分尽量使用用户所使用的语言,避免非必要的英文表述;例如 `Phrase 1` 是非必要的,而专业术语 `MySQL` 是必要的

## 3. 授权

- 单次授权原则:用户的任何授权仅限单次请求,完成后立即失效,不得跨请求复用,除非用户明确指定某次授权的作用域（起始和结束）

## 4. 会话与任务

- 每当用户追加新任务时,不要阻塞或打断旧任务,确保完成旧任务后再执行新任务
- 向用户确认本项目是否有缩写或简称,方便创建文件出现未明确名称时直接使用命名
- 新会话中,开始操作前,先确认有哪些读写工具可用,并选择合适可用的读写工具,避免因工具问题干扰后续工作
- 每次完成变更后,给用户的反馈不要完全复述更改,而是给出变更大纲和部分重要细节,然后向用户表明上述是大致内容,如果用户需要更详细的反馈信息再说

## 5. 工作目录与文件系统

- 不要主动碰工作目录以外的地方（除非用户明确要求）;如果有这个需求的话,需要询问用户是否能在工作目录下解决,并由用户决策解决方案
- 当需要使用临时目录时,直接在工作目录下创建 `temp/` 或 `.agents/` 文件夹,不要碰工作目录以外的地方
- 相对路径原则:项目各处涉及项目内路径问题优先使用相对路径,避免环境依赖,保证项目迁移部署后仍正常工作

## 6. 项目结构与技术栈

- 工作目录下,如果用户没有特别指定,那么 `src/` 就是功能性的源码目录,其余内容则是辅助性和说明性的内容;另外要明确目录结构,严禁混淆使用
- 必须明确开发技术栈,每当有变更技术栈的需求时需要提醒用户进行确认
- 当目录结构（包括文件）发生改变时,及时更新 `.gitignore` 文件

## 7. 环境、依赖、构建与运行

- 当发现开发环境、依赖、模块等内容缺失时,不要自主下载、修复或操作,而是告知用户缺失了什么、它有什么用、缺失它会产生什么影响、安装它会操作文件系统哪个位置,让用户决策
- 不要主动构建产物、运行测试,除非用户明确要求或授权
- 不要主动清理构建缓存等非代码内容,避免构建进度丢失、重复下载,除非用户明确要求或授权

## 8. git 操作

- git 权限分级:

| 权限级别 | 命令/操作 | 使用条件 |
|:---:|:---:|:---:|
| 读取 | `git log` `git status` `git diff` | 可随时使用 |
| 写入 | `git add` `git commit` `git push` `git reset` `git amend` | 需用户当次对话明确授权（如"提交"、"push"、"合并"） |

- git 提交规范:
  - 暂存更改只允许使用 `git add .` ,所以要先检查维护 git 忽略文件
  - 对于大改动,询问用户是否要 commit 标题包含版本号（如果包含的话,后续是否要迭代版本号以及怎么迭代）,body 记录功能性变化（与上一版本比较）、git表观变化
  - 小改动则使用不含版本号的 commit 标题
- git commit 的内容请保证干净,不要包含 git 操作相关的信息,例如不要在 commit 内容里记录合并过多个 commit 这一操作
- 用户未明确要求时,不要动 tag 和 release,也不要 push
- 不要更改用户的 `LICENSE` `COPYRIGHT` 等项目长久性文件,除非用户明确提出要求变更

## 9. 文档维护

- 任意文档中不要提及时间顺序、工时计算、预估耗时、预期效果,因为开发是 Agent 在做实现而不是人类开发者
- 任意文档中不得使用 emoji 字符
- 维护任意 md 文档时,应该全量或逐段落加载文档内容,避免遗漏导致部分内容过时或有误
- 维护任意 md 文档时,允许改写、转换说法,但是不得丢失细节,除非用户明确提出额外要求
- 维护任意 md 文档时,如果使用到表格,应该默认使用 `|:---:|` 单元格居中
- 文档的版本徽章显示文字中,版本号不带 v 字母前缀
- 遇到文档中有过时内容时,及时清理

## 10. README 与多语言文档

- 项目 README 文档的维护应该以中文版的 `README.md` 或 `README_zh-CN.md` 为核心,最后再翻译成英文版的 `README_en-US.md` 或 `README.md`;主 README 使用何种自然语言由用户决定
- 项目 README 文档内介绍功能特性的位置不要介绍非功能性的细节
- 项目 README 文档可以参考本文档内的非守则内容,但不要照搬,而是针对产品用户、开发者、社区协作者的群体特性选取
- 项目文档多语言版本维护规则:允许同一文档的不同语言版本之间通过链接相互跳转,跨文档链接要保证语言一致性（如果需要）;例如 `README_zh-CN.md` 内允许通过链接跳转到不同语言版本的 README,但是只链接到中文版的 HELP 文档（如果有）

## 11. 版本文档

- `v版本号-*.md` 属于版本文档,星号部分表示具体功用性名称;本条规则占用 git 忽略规则 `v*-*.md`,后续规则冲突时需要提醒用户该规则已被占用;注意本条所提版本号在具体文件实例上要变更为用户指定的具体值,如 `v1.0.0-*.md` 是针对 1.0.0 版本的版本文档
- 版本文档严格绑定于某个历史版本时期,新版本的变更不要覆盖记录到旧版本文档中,而是在旧版本文档中标注该版本文档在最新版本（明确版本号）中已经发生变更;例如旧版本中的某个 UI 设计细节在最新版本中发生了变更,此时不要破坏旧版本文档,而是在最新版本文档中记录这一变更、在旧版本文档中标注这一变更,即新旧版本文档的内容互指
- `docs/` 目录下预设以下版本文档,属于模板文档,默认不主动创建,当用户明确要求时才创建;当用户的需求符合某个版本文档功能性质时可以向用户提出启用建议;当项目正在开发的版本号远高于某个文档绑定的版本号时,不再维护该文档（如果用户要求维护之,则建议用户复制部分内容进新版本的同功能文档,保留旧版文档）:

| 版本文档 | 面向对象 | 主要说明 |
|:---:|:---:|:---:|
| `v版本号-发行说明.md` | 使用项目产物的用户 | 文档结构仅按需包含"新增、修复、优化、兼容性"几个标题,表述适当、合理、简洁、完整,不得复杂化。此类文档只描述目标版本相对于上一版本的用户可见变化量:不描述上一版本不存在的实现过程（如新增功能的内部细节修正）,不表述更新过程中的反复变化（变化路径）。当从未创建过类似文档而用户要求创建时,需要用户指定本次要求时的上一版本号。判断上一版本功能存在与否以 git 历史（上一版本提交）为准,不依据文档 |
| `v版本号-*机制(与规范)?.md` | 项目开发者 | 保证开发者能快速查阅和对照,用于描述某个版本加入的功能的机制与规范、进行功能上抽象级别的**总结**;允许包含示例代码、设计细节,但是不得包含具体的实现代码和语法、变量名称等代码细节 |
| `v版本号-可改进清单.md` | 项目开发者 | 保证开发者能快速查阅和对照,用于记录该版本时用户未实现的想法、Agent 推荐的改进;该文档只做简单的记录,不制定方案或计划 |
| `v版本号-前驱版本待办排期清单.md` | 项目开发者 | 保证开发者能快速查阅和对照,用于排期目标版本及其前驱版本的待办项。待办项按预期版本号升序排列（同一版本内按添加先后顺序）。每项必须包含以下字段:变更级别（主版本级=不兼容旧版/次版本级=破坏性变更/修订版本级=无破坏变更）、预期版本号（已确定实现版本时填写具体版本号;未确定具体实现版本但明确早于目标版本时以"早于v\<目标版本\>（匿名）"标注;预期版本不得晚于目标版本）、添加版本（该待办最初被记录时项目正在进行的版本号）、来源文档（该待办迁移自的文档路径;原创待办填写本清单自身和添加版本）、内容（待办的具体描述,含变更级别判定依据或前置审计结论时一并写入）、依赖关系（与其他待办的配套/前置关系,如依赖某待办则须同版本实施,无依赖填无）、当前状态（基于项目正在开发的版本号实时更新的状态"未实施/实施中/已实施"）。迁移自其他文档的待办保留其添加版本标注,实施完成时更新当前状态 |

## 12. 版本号管理

- 版本号使用标准的 `<主版本号>.<次版本号>.<修订版本号>` 格式,例如 `0.1.0` ,一般习惯性地携带前缀字母v,例如 `v0.1.0`
- 当不确定版本号时,应该从 git log 查看后向用户确认正在开发的项目的版本号,不允许自动迭代版本号
- 只有在用户明确重新指定新版本号后才能弃用旧版本号,新版本号要及时同步到项目源码和文档各处
- 当项目最新状态不兼容旧版本（有冲突）时,仅提醒用户注意迭代版本号,但不做版本号迭代兜底
- 版本号迭代后,及时更新项目文档中的全量内容到最新状态
- 推荐用户在根目录下创建 `version.index.md` ,自动维护该文档记录版本号在项目中出现的位置,具体到文件路径和行数位置,方便版本号更迭时快速查看版本号位置

## 13. 代码开发

- 合理组织代码保证代码结构化,避免结构混乱不利于后续开发
- 充分发挥面向对象思维,开发过程中及时封装对象
- 在模块内具有复用价值的对象和功能要提取成模板转移进独立代码文件,方便后续开发复用引入
- 代码中可个性化修改但不影响项目核心功能的设计细节（指后文定义的设计细节）,需要以全局常量/宏/独立代码文件之一的形式隔离储存,便于开发者知悉和维护
- 当项目多次尝试修复同一个问题未成功解决时,完整阅读所有代码后再动手
- 代码内禁止使用 emoji,并避免代码内的无用连续空白符
- 代码注释根据语言全部使用跨行注释,精简注释内容,减少无效注释字符

## 14. 更新日志与计划

- 用户没有明确要求时,不要撰写任何更新日志、CHANGELOG,不要储存项目状态,避免过期内容污染项目
- 当用户要求要写更新日志时,每次 git commit 操作后,必须在 `CHANGELOG.md` 末尾追加本次 commit 变更的简要说明（用 commit 编号做一级标题,commit 内容首行做二级标题,标题后的段落适当补充标题未说清的内容）
  - 注意 `CHANGELOG.md` 文件不记录对 git 未追踪文件的变更,也不记录自己的变更;其内容可以比 commit 内容更详细;如果内容缺失,则从最新一个 commit 的后续才开始记录
  - 注意 `CHANGELOG.md` 文件默认被 git 追踪,且 git 记录中不描述该文件的变更
  - 需要在 `CHANGELOG.md` 页脚（使用引用块）明确该文件记录落后于 git 记录一个 commit（追加变更日志时不可能提前知晓未提交的 commit 的 hash 编号）
- 当 Agent 工作必须需要写计划、日志、报告等文档时,优先使用 `temp/` 或 `.agents/` 文件夹,避免使用 `docs/` 文件夹、避免污染项目本体

## 15. 前端项目规范

- 前端网页项目不要使用浏览器原生弹窗提醒,而是使用自定义飘窗提醒
- 前端网页项目不要使用浏览器原生弹窗进行二次确认,而是在原按钮上执行"替换为确认按钮-3s 内点击确认-超时回归初始状态"流程
- 前端网页项目默认隐藏浏览器侧边滚动条（如果有）,然后告知用户（允许用户回退该操作）
- 前端网页项目的表格、select 控件默认文本水平居中
- 日期格式化:默认使用 `yyyy-MM-dd HH:mm:ss+HH:mm` 格式,除非用户明确指定使用别的格式

## 16. 子代理

- 合理利用子代理（如果有）并行任务,以加快项目进程或避免已有上下文污染思考;注意设定子代理个数上限（默认 5）避免并发超限
- 处理好子代理的上下文继承关系,已过期用不上的子代理及时关闭或销毁,避免占用资源

## 17. 作者信息

- 项目作者已确认: 是
- 项目作者:[JularDepick](https://github.com/JularDepick)
- 前后端项目请在后端代码注释头、每一个前端页面底部标注作者信息,并在控制前端页面的代码里定义宏或常量,方便开发者动态替换前端页面作者信息
- 提醒用户是否要修改本段落的项目作者信息,得到答复后标记“项目作者已确认”为“是”

## 18. 术语定义

| 术语 | 定义 |
|:---:|:---:|
| 用户 | 与 Agent 进行对话交互的人类主体（在上下文中具有用户标识） |
| 开发者 | 有能力对本项目源码作出修改和优化的人类主体 |
| 产品用户 | 使用和体验本项目产物的人类主体（一般不参与开发） |

## 19. 模板版本与更新流程

- 本文档当前使用的模板版本号为 `v0.2.0`
- 当用户明确要求更新本 `AGENTS.md` 文档的模板版本时,执行以下流程:
  1. 使用 curl 工具访问 `https://api.github.com/repos/JularDepick/AGENTS.md-Best-Practices/tags`,解析返回的 JSON 文本中的第一个 `name` 字段（值即模板最新版本号）
  2. 如果该字段的版本号大于本文档当前使用的模板版本号（已在本文档中定义）,则继续下一步;否则携带版本号告知用户已是最新版本,并结束本流程
  3. 使用工具下载 `https://raw.githubusercontent.com/JularDepick/AGENTS.md-Best-Practices/<version>/src/develop/general-methodology/JularDepick/AGENTS.md`（注意替换 `<version>` 为模板最新版本号）,保存为新模板版本文档 `temp/AGENTS-<version>.md`（可以同样地下载本文档当前使用的模板版本原始文件到本地,方便做差异对比）
  4. 合并新模板文件到本项目根目录的 `AGENTS.md` 文档（可使用 diff 工具）;冲突部分向用户询问要求决策,并给出推荐取舍方案,用户指定后再解决合并冲突
  5. 完成后,清理 `temp/AGENTS-<version>.md`
- 当GitHub源遇到网络问题或用户要求使用国内源时,请使用中国大陆地区备用镜像源(每日UTC时间自动从GitHub同步): 
  - 查看最新版本号: `curl --request GET --url "https://api.cnb.cool/JularDepick/AGENTS.md-Best-Practices/-/git/tags" --header "Accept: application/vnd.cnb.api+json" --header "Authorization: 1f1a38Oekwl6tNP6mFxkdNak5eS"`
  - 下载指定版本号的模板原始文件: `curl --request GET --url "https://api.cnb.cool/JularDepick/AGENTS.md-Best-Practices/-/git/raw/<version>/src/develop/general-methodology/JularDepick/AGENTS.md" --header "Authorization: 1f1a38Oekwl6tNP6mFxkdNak5eS"` （注意替换 `<version>` 为模板最新版本号）

---

# 第二部 项目信息模板

> 以下章节为项目信息模板,内容按项目最新状态维护。

## 模板使用说明

- 模板章节分为默认启用与默认未启用两类;默认未启用的扩展项,在用户明确要求或审计确认确有需要时启用,启用后及时填充内容
- 模板中段落的行内代码块内容可能包含路径匹配、参数匹配、变量匹配、正则匹配的混合语法,需要区分理解;例如 `~/` 表示工作目录,`<...>` 表示参数或变量,`(...)?` 表示内容正则匹配存在或不存在

## 模板章节总览

| 章节 | 默认状态 | 用途 | 维护时机 |
|:---:|:---:|:---:|:---:|
| 概述 | 启用 | 项目概述信息 | 项目最新状态变化时自主更新 |
| 技术栈 | 启用 | 记录项目技术栈 | 技术栈发生变化时自主更新并告知用户 |
| 架构 | 启用 | 记录前后端架构、服务架构 | 架构发生变化时自主更新并告知用户 |
| 目录结构 | 启用 | 记录工作目录树形图结构 | 目录结构发生变化时自主更新并告知用户 |
| 工作流程 | 默认未启用扩展项 | 记录项目产物运行时的工作流程 | 按需启用,有需要或用户指定时补充次要流程或分支 |
| 开发时配置文件 | 启用 | 记录影响项目核心功能的配置文件列表 | 配置发生变动时维护 |
| 设计细节 | 启用 | 记录可个性化修改但不影响核心功能的设计细节 | 设计细节发生变动时维护 |
| 版本号索引 | 启用 | 记录当前版本号 | 版本号迭代后更新 |
| 快捷命令 | 启用 | 记录 Agent 开发时使用的命令 | 按项目实际需求选择性补充 |
| 辅助脚本 | 默认未启用扩展项 | 记录工作目录 `scripts?/` 内的辅助脚本 | 按需启用、按需撰写 |
| GitHub Actions 工作流 | 默认未启用扩展项 | 记录 `.github/workflows/` 内的规范化工作流配置 | 用户明确指出有对应需求时才启用 |

## 各章节模板

### 概述

这是一个 dsh 插件项目,插件把 DeepSeek Harness (DSH) 的每次 AI 交互量化为可视化战绩,自动同步至 WakaTime:以心跳(Heartbeat)批量上报(定时节奏)、精确统计每次 Agent 调用的 input/output Token 与 LLM 思考时长、全局统一组织 AI 会话数据(全部心跳归为一个整体 AI 会话,entity 按会话区分)、以 WakaTime API Key 认证(Key 经本地小后端代理,仅覆盖写入不可查看)。

- 插件名称规范:`dsh-<核心名称>-plugin`,本项目核心名称为 `wakatime`,包名 `dsh-wakatime-plugin`
- 插件入口导出 `name`(值 `wakatime`)与 `apply(ctx, config)`,配置经 Schemastery schema 校验
- 文档语言核心:中文(`README.md` 为中文,英文为额外文档 `README_en-US.md`)

### 技术栈

| 类别 | 选型 |
|:---:|:---:|
| 语言 | TypeScript(ESM) |
| 插件框架 | dsh 0.1.5-rc.1(基于 Cordis,`@deepseek-ai/cordis` ^4.0.2) |
| 配置校验 | `@deepseek-ai/schemastery` ^3.18.2 |
| 事件采集 | `@deepseek-ai/dsh-session` ^0.1.5-rc.1(`session/event` 类型与声明合并) |
| 工具注册 | `@deepseek-ai/dsh-tools` ^0.1.5-rc.1(`defineTool`) |
| Web UI(浏览器端) | React 18 + `@deepseek-ai/dsh-client-ui-slots` slot 核心 + `@deepseek-ai/dsh-client-ui-renderer` 运行时(平台模块由宿主提供) |
| 样式 | CSS Modules(lightningcss 内联编译,`--dsw-alias-*` 语义 token) |
| 网络 | Node 内置 fetch(无第三方 HTTP 依赖) |
| 包管理 | pnpm |
| 构建 | tsdown(产物 `.mjs/.d.mts` 与 `client.js`,生态包外部化由宿主提供) |
| 目标环境 | Node.js(dsh 宿主)+ 浏览器(dsh web GUI) |

> 当项目技术栈发生变化时需要自主更新并告知用户

### 架构

插件运行于 DSH 宿主内,遵循 Cordis 生命周期(Fiber 状态机),注册的能力在卸载时自动清理,手动资源用 `ctx.effect()`。模块划分为:

- `src/index.ts` 入口:导出 `name`/`inject`/`apply(ctx, config)`,装配各模块
- `src/collector/` 采集面:监听 `session/event`,由 user/message 记录提示词长度与 Token 估算、step/start 开启计时 + assistant/message 携带的计时流 stream(经 `assistantStreamFirstTokenTime`)fold LLM 思考时长、assistant/message 入队 AI 编码心跳(携带 Token 用量)、tool/call 入队调试心跳
- `src/heartbeat/` 心跳引擎:本地缓冲 + 定时批量上报(启动一次 + 每 reportInterval 秒),未认证缓冲丢弃,失败入离线队列补报;选项可变(Web 写入后即时生效);维护上报记录日志(调试级)
- `src/auth/` 认证管理:WakaTime API Key(环境变量优先、配置文件兜底),只允许覆盖写入,任何读取面不回显明文;配置时先经 /users/current 验证
- `src/http/` HTTP 层:fetch 封装(API Key 走 HTTP Basic)、WakaTimeError 分类、429/5xx 指数退避重试
- `src/config-manager/` 本地凭证与配置管理(用户目录 JSON 0600,目录可用环境变量覆盖)
- `src/runtime-config/` 运行时可变配置:Web 设置页写入项即时生效并持久化到 settings 块,重启合并恢复
- `src/stats/` 全局战绩聚合(心跳、工具调用、Token 用量、提示词字符与估算、思考时长、API 有效消耗)
- `src/tools/` 工具注册:wakatime_config/logout/status/stats(Agent 可覆盖修改配置与 API Key,不可查看 Key 明文)
- `src/webui/` 小后端:在 dsh host webserver 上注册状态/配置/API Key 覆盖与清除/上报日志/云端同步路由(仅 web profile,服务可选跟随)
- `src/project/` 项目与分支检测(cwd basename 与 .git/HEAD)
- `src/translation/` 翻译加载器与 `xx-YY.ini` 文案(host 工具文案)
- `src/client/` 浏览器端(Web UI):`apply` 注册会话区域视图标签栏 wakatime 标签页(`conversation.view` 槽,Agent 协作战绩 + API Key 覆盖 + 上报日志 + 配置区),语言跟随 dsh web UI 语言切换(zh/en 字典),经 `/api/wakatime/*` 与小后端通信

> 当项目架构发生变化时需要自主更新并告知用户

### 目录结构

```
src/
├── index.ts              # 插件入口:name/inject/apply(ctx, config),装配模块
├── config.ts             # Config 接口 + Schemastery Schema(默认值写入 schema)
├── constants.ts          # 全局常量与设计细节(端点、上报参数、环境变量名)
├── errors.ts             # NotAuthenticatedError
├── translation/          # 翻译加载器(index.ts)与 xx-YY.ini 文案
├── http/                 # HTTP 层(types.ts + index.ts)
├── auth/                 # API Key 认证管理(types.ts + index.ts)
├── heartbeat/            # 心跳引擎(缓冲+定时批量;types.ts + index.ts)
├── collector/            # 会话事件采集(types.ts + index.ts)
├── config-manager/       # 配置管理(types.ts + index.ts)
├── runtime-config.ts     # 运行时可变配置(Web 写入即时生效 + 持久化)
├── stats/                # 全局战绩(index.ts)
├── tools/                # 工具注册(index.ts)
├── project/              # 项目/分支检测(index.ts)
├── webui/                # 小后端路由(types.ts + index.ts)
└── client/               # 浏览器端(apply + locales + WakatimeTab + 样式)
docs/
├── dsh-dev-docs/         # 已收录的 dsh 插件开发文档(先读 index.agent.md 速查表)
├── repo-spec/            # Tag & Release 规范
├── tech-spec/            # 项目技术规范与经验(translation-ini 规范、dsh web tab 经验等)
└── wsl-deploy-testing.md # WSL 部署测试经验(基线/部署流程/验证清单/常见问题排查)
.agents/                  # Agent 工作目录:交接文档/经验文档/临时脚本/包管理器缓存重定向(已 gitignore)
temp/                     # 研究材料与临时产物(已 gitignore)
release/                  # 发布产物(已 gitignore):标准 npm tarball 单产物 dsh-wakatime-plugin-<版本>.tgz
```

> 当目录结构发生变化时需要自主更新并告知用户

### 工作流程

插件在 DSH 宿主内的运行时流程:

1. DSH 加载 profile,按 patch 层插入 `dsh-wakatime-plugin` 插件行
2. Cordis 校验配置(Schemastery schema),填充默认值
3. `apply(ctx, config)` 执行:按 `config.locale` 初始化翻译,装配认证/心跳/采集/统计/工具各模块,注册 `session/event` 监听、四个工具、定时上报与离线补报定时器、小后端路由(web profile 提供 webserver 时挂载 `/api/wakatime/*`)
4. 会话事件驱动:user/message 记录提示词长度与 Token 估算;step/start 开启每步计时,assistant/message 携带的计时流 stream(经 `assistantStreamFirstTokenTime`)fold 每步 LLM 思考时长;assistant/message 以 `ai coding` 类别入队主心跳(携带 input/output Token 与提示词长度);tool/call 以 `debugging` 类别入队轻量心跳
5. 心跳入本地缓冲,启动加载时批量上报一次、之后每 `reportInterval` 秒批量上报(bulk);429/5xx 指数退避重试;失败进入离线队列由定时器补报;未配置 API Key 时缓冲丢弃
6. API Key 经小后端管理:手动在 Web 标签页输入(仅覆盖、不回显)或 Agent 经 `wakatime_config` 工具覆盖写入,已配置后可在标签页清除(二次确认,回退未登录);`wakatime_config` 还可读改全部配置项,`wakatime_logout` 清除 Key,`wakatime_status`/`wakatime_stats` 查看状态与战绩;web profile 下浏览器端 client 插件自动注册会话区域视图标签栏 wakatime 标签页(`conversation.view` 槽,Agent 协作战绩 + 云端同步合并 + API Key 覆盖与清除 + 上报日志 + 配置区,语言跟随 dsh web)
7. 插件卸载时,所有注册(事件监听、定时器、工具、Web 路由)由框架与 effect 自动清理

### 开发时配置文件

- `package.json` — 包清单:声明 `dsh.bundle`(patch 层)、`main`/`types`(对齐 tsdown 产物 `.mjs/.d.mts`)、`files`(仅 dist 与 cordis.patch.yml + LICENSE/COPYRIGHT/中英 README,LICENSE 由 npm 自动附加而 COPYRIGHT 需显式列出)、依赖与脚本(含 `prepare` 构建脚本,支持 git 安装场景)
- `cordis.patch.yml` — patch 层:按包名插入插件行 `dsh-wakatime-plugin`
- `pnpm-workspace.yaml` — 声明独立 workspace(`packages: ['.']`),规避用户主目录同名文件被 pnpm 11 当作 workspace 根;并置 `minimumReleaseAge: 0` 放宽刚发布 rc 包的供应链策略
- `tsconfig.json` — TypeScript 编译配置(严格模式、bundler 解析)
- `tsdown.config.ts` — 构建配置:ESM 产物、类型声明、copy 翻译 ini 到产物
- `.gitignore` — 忽略依赖/产物/临时目录

### 设计细节

- 插件名称:`dsh-wakatime-plugin`,入口 `name` 为 `wakatime`
- 默认语言与回退语言:`zh-CN`;翻译文件目录 `src/translation/`(host 工具文案;Web UI 语言跟随 dsh web 的 zh/en 切换)
- 凭证与配置存放:用户目录下 `~/.dsh/plugins/wakatime/config.json`(环境变量 `WAKATIME_CONFIG_DIR` 可覆盖目录);API Key 存于此文件(0600),只允许覆盖写入,任何读取面不回显明文
- 认证:WakaTime API Key(HTTP Basic,username=api_key);环境变量 `WAKATIME_API_KEY` 优先于配置文件;配置时先经 `/users/current` 验证并缓存用户名
- 定时上报:启动加载时批量上报一次,之后每 `reportInterval` 秒(默认 `60`,可配)循环;`reportEnabled` 开关;批量上限 `25` 条;重试最多 `5` 次、指数退避(1s 起、30s 封顶、倍率 2);离线队列上限 `1000` 条、补报周期 `30` 秒;上报记录日志保留 `50` 条(Web 可展开查看);AI 编码心跳类别 `ai coding`、工具心跳类别 `debugging`;AI 会话全局标识 `dsh_waka_time_plugin`(全部心跳归为一个整体 AI 会话,entity 按会话区分)
- 量化指标(Agent 协作战绩,不统计/不展示/不上报心跳数与工具调用数):提示词总量(官方 `ai_prompt_length` 口径:字符数,与上报一致)、提示词 Token 估算(字符数 ÷ 系数 `1.5`,本地辅助展示)、LLM 思考总时长(步骤开始 → 首个输出 token,官方 fold 算法,官方无上报字段,仅本地展示)、输出 TOKEN 总量(官方 `ai_output_tokens`)、API 有效 TOKEN 消耗(输入+输出,官方仅 `ai_input_tokens`/`ai_output_tokens`,缓存命中 Token 无官方字段不并入)
- 工具面:wakatime_config(读改全部配置;`set_apikey` 仅覆盖写入 API Key)/ wakatime_logout(清除 Key)/ wakatime_status / wakatime_stats
- 云端同步并入战绩:已配置 API Key 时,标签页加载后自动同步一次并支持手动按钮,拉取 WakaTime summaries 近 7 天的 AI 聚合,与本地战绩对应指标(提示词字符、输出 TOKEN、API 有效消耗)取最大值合并展示,同步时间与状态显示在战绩卡头部;仅读取不修改云端,失败静默并显示错误态
- API Key 清除:标签页登录卡提供「清除 API Key」按钮(确认流:3 秒内二次点击确认,超时回归),经小后端 `POST /api/wakatime/apikey/clear` 清除本地 Key 并回退未登录
- Web UI:浏览器端在会话区域视图标签栏注册 wakatime 标签页(`conversation.view` 槽,id `wakatime`,order `20`),展示 Agent 协作战绩(云端同步合并取最大值,头部含同步状态与按钮)、API Key 覆盖与清除区、上报记录日志与配置区;小后端经 webserver 服务挂载 `GET /api/wakatime/status`、`POST /api/wakatime/config`、`POST /api/wakatime/apikey`、`GET /api/wakatime/logs`、`GET /api/wakatime/sync`、`POST /api/wakatime/apikey/clear`(仅 web profile);client 产物 `dist/client.js`(`exports["./client"]` 声明,host 自动扫描)
- 环境变量:`WAKATIME_API_KEY`/`WAKATIME_DEBUG`/`WAKATIME_CONFIG_DIR`

设计细节均隔离于 `src/constants.ts`(索引:默认语言/回退语言/翻译目录、凭证目录/文件名、WakaTime API 端点(含 summaries 与云端同步区间)、定时上报间隔/批量/重试/离线队列/补报周期/日志上限/心跳类别/AI 会话全局标识/提示词估算系数、Web UI 路由路径(含同步)、环境变量名)。

> 当项目状态中的设计细节具体值与本段落设计细节值发生冲突时,需要向用户报告请求决策,不要自行决定

### 版本号索引

- 当前版本:v0.1.1

> 版本号中 x 表示十进制数,不限制位数,无前导 0

- 版本格式遵循 `docs/repo-spec/tag-release-spec.md`(Tag `<版本号>`,Release `<版本号>-dsh-<dsh版本号>`)
- 版本号迭代时,同步更新 `version.index.md` 所列文件(见该文件同步清单)

### 快捷命令

```
# 安装依赖
pnpm install
# 类型检查
pnpm typecheck
# 构建产物(tsdown,输出 dist/)
pnpm build
# 打包 tarball 并输出到 release/(构建产物在 dist/,完整流程见 README「发布与分发」章节)
pnpm pack --pack-destination release
```

### 项目启动

新会话接手项目时按以下流程启动:

1. 完整阅读根目录 `AGENTS.md`:守则区为硬约束;项目绑定区(概述/技术栈/架构/目录结构/设计细节/版本号索引)随项目状态懒维护
2. 读 `version.index.md` 与 git log,确认当前真实版本号并向用户汇报确认;版本格式遵循 `docs/repo-spec/tag-release-spec.md`
3. 读核心 README(中文版 `README.md`)与项目技术文档(`docs/tech-spec/`),掌握既定机制设计,机制细节遵循 specs 不重复抄录
4. 读 `docs/dsh-dev-docs/<版本>/` 已收录的 dsh 插件开发文档:先读 `index.agent.md` 速查表,涉及框架机制时精读基础篇与框架篇;未收录时回官方仓库 `docs/user/develop` 查阅
5. 动手前的关键技术决策先列给用户裁决;涉及安装/构建/测试须经授权

### 开发经验

dsh 插件开发与构建测试要点(浓缩自模板初始化经验,项目实选已登记于本文件各处):

- 插件本质:导出 `name` + `inject` + `apply(ctx, config)` 的 TypeScript 模块;`ctx` 是上下文,经它注册能力(工具、事件、资源);三种形态(函数/对象/类),一般函数形式即可
- 配置:导出同名 `Config` 类型 + Schemastery `Schema`(默认值写入 schema,如 `src/config.ts`);无效配置在加载期响亮失败;不导出普通对象
- 工具:经 `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))` 注册,`output.render` 把规范值转成面向模型的内容;需要 `inject: ['tools']`
- 生命周期:插件 Fiber 状态机;经 `ctx` 的注册在卸载时自动清理;手动资源用 `ctx.effect(() => cleanup)`
- 服务与依赖:服务是挂在 `ctx` 上的命名能力;`inject` 声明必需依赖,可选依赖用 `ctx.get()`;服务消失会触发依赖插件自动卸载并在恢复后重载
- 事件:`ctx.on`/`ctx.emit`,四种模式(emit 广播/bail 短路/serial 顺序/waterfall 流水线,waterfall 监听器必须调用 `next()`);类型安全用声明合并扩展事件接口;监听器也是效果,卸载自动移除
- bundle 打包:包清单声明 `dsh.bundle` 与 patch 层(`cordis.patch.yml`);patch 以插件包名插入插件行,加载顺序按 profile bundles 列表;后应用的层按行胜出(整行替换,不深度合并);`dsh plugin --profile <name> add <包>` 安装;git 安装只拉源码,需 `prepare` 脚本且用户授权构建
- 版本对齐:dsh 各包版本须与本地运行环境对齐(本地实测 0.1.5-rc.1 系列:`dsh-tools`/`dsh-session`/`dsh-llm`/`dsh-client-ui-*` 均 0.1.5-rc.1、`cordis` 4.0.2、`schemastery` 3.18.2);带 rc 的包需核对 registry 的 next 标签;0.1.1-rc.2→0.1.5-rc.1 是次版本升级,类型声明有破坏性改动(`assistant/chunk` 事件移除、`isTokenDelta` 移至 `@deepseek-ai/dsh-llm/assistant-stream`、`dsh-client-runtime` 拆分消失、`dsh-client-ui-slots` 变纯类型核心、`ctx.slots` 声明移至 `dsh-client-ui-renderer/client`),本插件已对应适配(typecheck/build/smoke 全过;升级前先下载 tarball 哈希对比,脚本见 `.agents/compare-pkgs.mjs`)
- pnpm 11 坑(升级依赖时踩过):(1) 用户主目录存在 `pnpm-workspace.yaml`(仅 `allowBuilds` 配置)时,pnpm 11 会把它当 workspace 根,子项目报「No projects found」——在项目根创建 `pnpm-workspace.yaml`(`packages: ['.']`)声明独立 workspace 即可;(2) 刚发布的 rc 包会触发 `minimumReleaseAge` 供应链策略报「entries that the active policies reject」,在项目 `pnpm-workspace.yaml` 置 `minimumReleaseAge: 0` 放宽;(3)`pnpm install` 触发 `prepare` 脚本 spawn 会被沙箱 EPERM 拦截,用 `--ignore-scripts` 装完后单独 `pnpm build`
- pnpm 11.22 构建/打包沙箱经验:(1) `pnpm run <script>` 执行前自动做依赖状态检查(runDepsStatusCheck),即使依赖 up-to-date 也会内部执行一次 `pnpm install` 并触发 root 的 `prepare`(递归 build),prepare 的 pipe-spawn 被沙箱 EPERM 拦截导致外层命令失败——用 `pnpm --config.verify-deps-before-run=false run <script>` 跳过检查(CLI 配置项,环境变量 `npm_config_verify_deps_before_run=false` 实测不生效);(2) `pnpm pack` 不触发 prepare,沙箱内可直接运行,但 pack 不支持 `--ignore-scripts` 选项;(3) pack 产物内 package.json 的 scripts 会被 pnpm 混淆(移除 prepare 等发布生命周期脚本),属正常行为,不影响 tarball 安装(git 源码安装读仓库自身清单)
- 缓存重定向:npm/pnpm 写缓存到工作区外会被拒(EPERM),store/cache 重定向到工作区内(本仓库 `.agents/`);pnpm content-addressable store 落到 `.pnpm-store/`(已在 .gitignore)
- 产物后缀:tsdown 产物为 `.mjs`/`.d.mts`,`package.json` 的 `main`/`types` 必须与真实产物对齐
- file:// import:Node 动态 import 绝对路径必须转 `file://`(Windows 报 ERR_UNSUPPORTED_ESM_URL_SCHEME)
- 冒烟测试:临时脚本放 `.agents/`,对构建产物断言入口导出、配置默认值、翻译加载回退;`pnpm pack` 后列 tarball 内容核对打包边界(`files` 收窄,避免源码混入)
- PowerShell 每次调用独立无状态,必要时传 `workdir`;控制台中文乱码不代表文件损坏(UTF-8 正常)
- 维护规则:按需检查 dsh 插件开发者文档是否过时,过时则按官方收录流程更新到 `docs/dsh-dev-docs/<新版本>/`
- Web UI 插件:给 dsh web 新增 tab/UI 的完整机制与踩坑见 `docs/tech-spec/dsh-web-tab-experience.md`(client 产物格式、平台模块表、slot 纪律、数据通道选型);项目实例细节另见 `.agents/web-tab-experience.md`
- WSL 部署测试:基线环境、两种部署流程、启动命令、服务端与浏览器端验证清单、常见问题排查见 `docs/wsl-deploy-testing.md`;部署与启动由用户人工执行(Agent 不发起 WSL 操作,不请求权限升级),复验结论按该文档第八节回写
- Agent 工作目录 `.agents/`:交接提示词(`NEXT-SESSION.md`)、经验文档(`web-tab-experience.md`)、临时脚本(`smoke.mjs`/`compare-pkgs.mjs`)与 npm/pnpm 缓存重定向(`npm-cache`/`pnpm-*`)均置于 `.agents/`(守则第 5/14 章:临时与工作文档优先 `temp/` 或 `.agents/`;整个目录已 gitignore,换工作区时需自行迁移)
- 外部插件依赖纪律:宿主包(`@deepseek-ai/cordis`、`dsh-tools`、`dsh-session`、`dsh-llm`、`schemastery`)必须声明为 peerDependencies(+ devDependencies 镜像用于本地构建),**严禁放 dependencies**——否则 pnpm 把副本装进 profile(nodeLinker: hoisted 平铺),宿主 loader 解析内置行命中副本,dsh-tools 的 `TOOL_RUNTIME_SCHEDULER`(unique symbol)分裂,agent-loop 取不到 scheduler,全部工具调用崩溃(`Cannot read properties of undefined (reading 'prepare')`);正确模式参照 dsh-github-plugin

### 辅助脚本（默认未启用扩展项）

> 主要指放在工作目录 `scripts?/` 文件夹内的脚本文件,是由 Agent 撰写并维护的,需要按需撰写;辅助脚本的存在主要是为了补充 Agent 技能/工具能力的不足、减轻批量工作时的上下文负担、供给 GitHub 工作流自动化调用。主要功能包括但不限于:
>
> - 测试与罗列可用的开发环境
> - 执行快捷命令的组合和扩展
> - 执行文件内容的检索与替换
> - 获取与解析网络页面的内容
> - 复制核心产物到发布包目录
>
> 辅助脚本的具体实现形式需要根据开发环境决定:简单任务一般用 bat/cmd/bash 脚本即可解决,复杂任务应该使用 Python 脚本解决（此时如果缺失 Python 环境则提醒用户建议安装）。
> 当文件夹名称冲突时选择备选辅助脚本文件夹名称（其一):`assist-scripts?/` `assist/`

### GitHub Actions 工作流（默认未启用扩展项）

> 指工作目录下与 `.git/` 文件夹同时存在的 `.github/workflows/` 目录,用于储存 GitHub 远程仓库的规范化工作流配置文件。当用户明确指出项目有如下需求（或部分需求）时才允许启用（默认不启用):
>
> - 自动化构建并发布发行版（Releases）:在代码合并或打标签时,自动构建产物并创建/更新 Release,同时上传构建产物
> - 自动化触发部署（Deployments）:在特定条件（如推送到 `main` 分支）下,自动触发部署任务至指定环境（测试,预发布,生产）,并回传部署状态
> - 自动化打包与托管软件包（Packages）:构建成功后,自动将项目打包为符合规范的格式（如 npm、Docker 镜像等）,并推送至 GitHub Packages 进行版本管理
> - 自动化执行辅助脚本:在构建或部署前后,自动执行脚本以动态调整目录结构,复制和移动文件,确保后续步骤运行环境正确
> - 自动化运行测试（单元/集成测试）:在代码推送或合并请求时,自动执行单元测试、集成测试,并生成测试报告;若测试失败则阻断后续构建和发布流程
> - 自动化代码质量检查（Lint 与安全扫描）:在构建前自动运行代码风格检查、静态分析以及依赖安全漏洞扫描,确保代码符合规范且无已知高危漏洞
> - 自动化生成变更日志与更新文档:在 Release 发布时,自动根据 Conventional Commits 规范生成 `CHANGELOG.md`,并自动构建和部署项目文档（如 GitHub Pages）至指定分支
> - 自动化清理过期资源:定期或每次发布后,自动删除不再使用的旧 Release 预发布版本、过期的包（Packages）版本或临时构建缓存,以节省存储空间
>
> 除通用辅助脚本外,由 GitHub Actions 工作流调用的脚本应该放在 `.github/scripts?/` 下,避免与项目的（辅助）脚本文件夹混淆