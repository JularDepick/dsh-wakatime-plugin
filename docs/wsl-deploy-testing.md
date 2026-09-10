# WSL 部署测试经验(wsl-deploy-testing)

> 面向接手本插件仓库的 Agent 会话:总结 WSL 环境下的部署步骤、验证清单与常见问题排查,供后继会话直接复用,避免反复试错。实机测试由人工完成(Agent 不代跑部署与启动),复验结论由人工反馈后回写本文档与 `.agents/NEXT-SESSION.md`。随项目状态维护,换 dsh 版本时对照 `docs/dsh-dev-docs/<版本>/` 与依赖版本核对。
> 本文档系从 `dsh-system-monitor-plugin` 项目的同功能经验文档适配而来(通用机制部分沿用,项目特定内容已替换为本项目)。
>
> 部署测试状态:v0.1.1 已完成 dsh 0.1.5-rc.1 适配(typecheck/build/smoke 通过),真机部署与验证待用户执行;下方验证清单按本项目实测口径更新。

## 一、适用环境(基线)

| 项 | 值 |
|:---:|:---:|
| WSL 发行版 | Ubuntu-24.04 |
| dsh 版本 | 0.1.5-rc.1(全局安装于 `/usr/lib/node_modules/@deepseek-ai/dsh`;WSL 侧由用户更新,上一状态为 0.1.1-rc.2) |
| web profile | `~/.dsh/profiles/web` |
| 插件包 | dsh-wakatime-plugin v0.1.1(已适配 dsh 0.1.5-rc.1) |
| 发布物 | `release/dsh-wakatime-plugin-0.1.1.tgz` |

- 沙箱内访问 WSL 常被文件策略拒绝(E_ACCESSDENIED / `wsl.exe` 需更高权限),部署与启动命令由人工在 WSL 终端执行;
- 部署分工约定(用户明确):**部署全部由用户自行执行**,Agent 不发起任何 WSL 部署/启动操作(也不请求 WSL 权限升级);Agent 的职责是修复代码 + 构建打包(`release/` 单产物交付);
- 部署测试约定(用户明确):只安装最新构建的插件包到 WSL dsh(`dsh plugin --profile web add <最新 tgz>`),不自动开启端口,服务启动由用户自行控制;
- 0.1.5-rc.1 的 `dsh web` 是 `--profile web` 的硬编码别名;`--host`、`--port`、`--no-open` 由 web-app 的 webStartup 插件解析为服务值(缺省回退 127.0.0.1:3080),端口可自选以避开占用。

## 二、部署流程(两种,任选其一)

1. tarball 分发(发布物安装):
   - 将 `release/` 下的 tgz 传入 WSL;
   - `dsh plugin --profile web add <tarball>`;
   - 同版本覆盖安装失败时,先 `dsh plugin --profile web remove dsh-wakatime-plugin` 再 add;
   - profile 安装时有 peer 警告属正常(可 `pnpm peers check` 复查),不影响启动;旧实例存在时需先 kill 再启动新实例加载插件。
2. 直接部署工作流(开发迭代,免 pack/add 往返):
   - 构建后把 `dist/`(`index.mjs`、`index.d.mts`、`client.js`、翻译 ini)、`package.json`、`cordis.patch.yml` 复制到 `~/.dsh/profiles/web/node_modules/dsh-wakatime-plugin/` 覆盖;
   - 重启 dsh web 生效(client.js 变化走 rev 刷新)。

## 三、启动(人工执行)

```sh
NODE_PATH=~/.dsh/profiles/web/node_modules dsh web --no-open --host 127.0.0.1 --port 3081
```

- 部署测试规则:部署只负责安装最新构建的插件包,不自动启动服务,启动由人工手动执行;
- 0.1.5-rc.1 启动会打印带令牌的 URL(`http://127.0.0.1:3081/?token=...`),浏览器必须打开该 URL(无令牌访问首页 401,带令牌首次访问 303 下发 cookie 后跳转;服务重启令牌更换);
- `NODE_PATH` 在 0.1.1-rc.2 时代是第三方 profile 插件客户端面被托管的必要条件;0.1.5-rc.1 的发现机制已优先走 Loader 自身解析,带 `NODE_PATH` 启动实测托管正常,不带 `NODE_PATH` 的对比未测(见第六节);
- 停止:先 `wsl bash -c "pkill -f '[d]sh web'"` 再确认端口释放(`pkill -f` 会误杀包含同文本的命令行自身,须用 `'[d]sh web'` 字符类技巧且与后续操作拆分为独立命令)。

## 四、验证清单(服务端,curl 即可)

| 检查点 | 预期结果 |
|:---:|:---:|
| `GET /api/wakatime/status` | 200;JSON 含 `configured`、`config`(enabled/reportInterval/reportEnabled/includeTokens/includePrompts/debug)与 `stats.aggregate`;任一响应不含 API Key 明文 |
| `GET /api/wakatime/logs` | 200;上报记录数组(空数组亦可);已配置后经一次心跳周期应有记录 |
| `POST /api/wakatime/apikey` | 携带 `{ "apiKey": "..." }` 提交;有效 Key 200 且 `ok:true`(不回显 Key);无效 Key 400 且不保存;`POST /api/wakatime/apikey/clear` 清除后 `status.configured` 为 false |
| `GET /api/wakatime/sync` | 已配置时 200 且 `ok:true` 携带 summaries 聚合(失败返回原因);未配置时 `ok:false` 与原因 |
| 插件 client.js | 0.1.5-rc.1 为批量 URL:`/plugins/??dsh-wakatime-plugin/client.js&rev=<BOOT 条目的 rev>`(旧单包路径 `/plugins/<包名>/client.js` 直接 404);200 且内容以 `var module = { exports: {} }` 包装头开头 |
| 首页 HTML | 以启动 URL 的 `?token=` 访问:`curl -L -c jar -b jar "<url>"`(401 → 303 下发 cookie 后 200);`__DSH_BOOT__` 含 `"id":"dsh-wakatime-plugin"` 条目,其 `url` 字段即批量 client.js 地址 |

## 五、验证清单(浏览器端,人工实机)

- 会话页标签栏出现「WakaTime」tab(tab 栏在标签数大于 1 时显示;无会话时 tab 不可见,属固有属性);
- 战绩卡:提示词字符/提示词 Token 估算/LLM 思考总时长/输出 TOKEN/API 有效消耗数值合理;思考时长为真实会话值(0.1.5 新口径:assistant/message 计时流 stream 结算,值得抽查首 token 时刻合理性);
- 云端同步:已配置 API Key 时自动同步一次,战绩卡头部显示同步时间与状态;点击同步按钮可手动刷新;云端与本地对应指标取最大值合并;
- API Key:输入新 Key 保存成功(验证后存储,不回显),状态行显示真实用户名(优先公开 username,不回退 Anonymous User);「清除 API Key」按钮 3 秒内二次点击确认后清除并回退未登录;
- 上报记录:展开可见时间/条数/结果/详情,失败项「未配置」文案正确映射;
- 配置区:开关/数字行点击文本可切换或聚焦,保存后状态刷新;
- tab 标签文案与面板文案跟随界面语言切换(zh/en),切换后无硬编码中文残留;
- UI 布局:战绩数字等宽对齐、表格居中、响应式折行正常;异常时用浏览器 DevTools 实测该 tab 的盒模型与宿主包裹容器(0.1.5-rc.1 的 conversation 包已重构,宿主包裹层需按新包复核)。

## 六、关键待复验点(0.1.5-rc.1)

- `NODE_PATH` 是否已非必需:客户端面发现(`locatePkgJson`)在 0.1.5-rc.1 优先走 Loader 自身解析(`internal.resolveSync` v2 + 最近祖先 manifest),无 Node 内部时才回退 `createRequire().resolve('<包名>/package.json')`。已实测:带 `NODE_PATH` 启动,客户端面托管正常(BOOT 注入条目、批量 URL 200);不带 `NODE_PATH` 的对比未测(对比方法:另起端口不带 `NODE_PATH` 启动,检查 BOOT 条目与批量 client.js URL;若不带亦可托管,回写部署经验);
- LLM 思考总时长真实值:0.1.5 移除 `assistant/chunk` 事件后,思考时长改由 `assistantStreamFirstTokenTime(stream)` 从 assistant/message 计时流读取,真机事件流下值得抽查;
- 工具面在 0.1.5-rc.1 宿主的调用验证:先核对 profile 顶层无宿主包副本(WSL 曾发生过 `TOOL_RUNTIME_SCHEDULER` symbol 分裂导致的工具崩溃,修复见第七节);
- i18n 语言切换后 tab 标签即时跟随(label 为 thunk,不重新注册)。

## 七、常见问题与排查

| 现象 | 排查方向 |
|:---:|:---:|
| web profile 启动聚合报错(加载期模块错误,阻塞整个 profile) | 逐条看首个失败 entry 的报错;0.1.1-rc.2 时期构建的第三方插件在 0.1.5-rc.1 宿主可能不兼容(实例:dsh-wakatime-plugin v0.1.1 引用已被 0.1.5-rc.1 移除的 `@deepseek-ai/dsh-llm/message` 的 `isTokenDelta`,ESM 静态导入加载期失败;v0.1.1 已适配——迁移至 `dsh-llm/assistant-stream`);宿主升级前先核对 profile 内各插件兼容性 |
| web profile 启动聚合报错(client bundle 缺失) | `exports["./client"]` 指向的产物不存在:先构建再部署;核对 `dist/client.js` 存在且与 `package.json` 的 exports 对齐 |
| `/plugins/<包名>/client.js` 404 | 0.1.5-rc.1 已改用批量 URL(`/plugins/??<包名>/client.js&rev=...`,取 BOOT 条目的 `url` 字段),单包路径不再存在;若批量 URL 也 404,确认启动命令带 `NODE_PATH`(或复验第六节结论)与插件行以包名插入 patch |
| 首页 401 | 0.1.5-rc.1 需以启动打印 URL 的 `?token=` 访问(303 下发 cookie);重启换令牌 |
| 浏览器 console 报 `exports is not defined` | client bundle 的 `module`/`exports` 定义未并入 banner(tsdown 0.22 无 intro,静默忽略),需重新构建 |
| 浏览器解析失败(require 未注册的包) | 外部化清单与宿主平台模块表不符:多余的外部化包不在 seed 表内,运行时 require 抛错;核对 `tsdown.config.ts` 的 `PLATFORM_MODULES`(0.1.5-rc.1 表见 `docs/tech-spec/dsh-web-tab-experience.md`,旧词如 `@deepseek-ai/dsh-client-web-react` 已从宿主表移除) |
| 工具调用崩溃(`Cannot read properties of undefined (reading 'prepare')`) | 宿主 `healProfilesModuleFallback` 维护 profile 平面 symlink,插件 peer 应解析到宿主实例;若 web profile 顶层 `node_modules/@deepseek-ai/` 存在宿主包真实副本(hoisted 平铺),Node 最近优先命中副本导致 `TOOL_RUNTIME_SCHEDULER` 分裂。修复:删 `~/.dsh/profiles/web/node_modules/@deepseek-ai/{cordis,cosmokit,dsh-tools,schemastery}`(保留 dsh-wakatime-plugin),**不要先跑 pnpm install**(可能重装副本),直接启动验证 |
| tab 不出现但 client.js 200 | 浏览器 console 报错优先;检查 `__DSH_BOOT__` 条目;服务端正常不代表浏览器端就绪,组件崩溃有 per-entry 错误边界 |
| client.js 更新不生效 | client-modules 按 rev 刷新:硬刷新浏览器(清缓存)后再看 |
| 同版本 tarball 覆盖安装失败 | 先 remove 再 add |
| 服务端数据接口正常但面板无数据 | 检查浏览器端 fetch `/api/wakatime/*` 是否被同源策略/路由拦截;面板数据只经 host webserver 端点出口 |

## 八、复验结论回写

人工完成实机测试后,按结论更新:

1. 验证通过的项:在 `.agents/NEXT-SESSION.md` 待办中勾除对应条目;
2. `NODE_PATH` 对比结论:更新 `AGENTS.md` 开发经验段的 WSL/发布版部署条目与 `.agents/NEXT-SESSION.md` 关键技术结论;
3. UI 布局若仍异常:收集异常区域截图或描述与 DevTools 盒模型数据,由 Agent 定点修复;
4. 所在 dsh 版本再次更迭:本文档基线表、验证点与待复验项一并核对更新。

> 本文档与 `.agents/NEXT-SESSION.md` 均不随包发布(见 `package.json` 的 `files` 白名单)。