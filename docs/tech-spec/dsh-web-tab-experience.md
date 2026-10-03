# 给 dsh Web 界面新增 tab 页/UI(外部插件通用经验)

> 面向 dsh 插件开发者:总结外部插件为 dsh Web GUI 贡献 UI(尤其是新增 tab 页)的完整机制与落地要点。
> 以会话区域「对话/轨迹」视图标签栏新增 tab 为实例,同样适用于「设置-插件」页等其他挂载点。
> 机制基于官方仓库源码(见文末索引)与 0.2.0-rc.2 发布包核对;本经验为静态总结,换版本时以对应发布包类型声明为准。

## 一、总体流程(五个步骤)

1. **package.json 声明 client 面**:声明 `dsh.client`(`platform: 'web'`,`inject` 仅信息性)与 `exports["./client"]`(指向 client 构建产物)
2. **构建 client 产物**:tsdown 输出固定名 `dist/client.js`,格式为 `window.__ModuleLoader__.load({ id, factory })` 的 CJS 包装
3. **写浏览器端代码**:`src/client/` 下 `apply(ctx)` 用 `ctx.slots.inject(...)` + `ctx.slots.register(...)` 注册组件
4. **host 自动发现与 serve**:无需修改 patch/loader 行——host 的 ClientModuleRegistry 按 loader 条目(entry name = 包名)扫描 `package.json`,serve `/plugins/<包名>/client.js`,并把条目注入 `window.__DSH_BOOT__`
5. **(可选)数据通道**:浏览器端需要 host 数据时,用 host 的 webserver 服务注册自定义路由,浏览器同源 fetch

## 二、会话区域 tab 挂载点(conversation.view)

### 槽契约

| 项 | 值 |
|:---:|:---:|
| 槽名 | `conversation.view`(官方声明于 `@deepseek-ai/dsh-client-ui-conversation/client`) |
| kind / scope | list / session |
| 注册 options | `id`、`order`、`label`(可为 `() => string` 跟随语言) |
| owner props | `inspect` / `onInspectDone`(跨视图检查交接,可选,不消费即可) |
| 组件 props | `PropsRuntime<'conversation.view'>`(含会话座位 sessionId/useSession/useSessions,**不强制使用**) |

### 注册代码(官方 ui-trajectory 同模式)

```ts
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'my-tab',
  order: 20,
  label: () => 'My Tab',
}, MyTabComponent))
```

- 必须用 `ctx.slots.inject` 等待声明(槽由 ui-conversation 声明,外部包可能先于它激活);注册进未声明槽是加载期响亮失败
- 类型:组件文件 type-only import `@deepseek-ai/dsh-client-ui-conversation/client` 使 SlotMap 合并生效;`inject: ['slots', 'locale']` 即可(只有需要读会话数据时才额外注入会话服务)
- 官方范例文件:`packages/client/ui-trajectory/src/client/index.ts`

### 会话区域 tab 的行为特性(重要)

1. **tab 栏在 `tabs.length > 1` 时才显示**:web profile 默认已有「对话」(chat)与「轨迹」(trajectory),新增第三个必然显示 tab 栏
2. **scope session 只是座位,不是数据约束**:组件可以完全不消费 sessionId/useSession,直接 fetch host 的全局接口做**全局统计**(如跨会话聚合数据)
3. **tab 栏随会话页出现**:无会话时(hero 页)会话区域不存在,tab 不可见;这是该槽的固有属性
4. **组件崩溃有 per-entry 错误边界**:只黑掉自身 tab,不影响会话页其他区域

### 备选挂载点

「设置-插件」页的 `settings.plugins.tab`(list/root,options id/order/label),类型声明在 `@deepseek-ai/dsh-client-ui-settings/client`。与 conversation.view 的注册代码完全同构,只换槽名。官方范例:`packages/client/ui-settings-plugins/src/client/index.ts`。

## 三、关键机制细节

### 1. client 产物格式(必须逐项对齐)

官方预设见 `packages/client/tsdown.client.ts` 的 `clientConfig`:

| 项 | 值 |
|:---:|:---:|
| format / platform | cjs / browser |
| entryFileNames | `client.js`(固定名,host 按此路径 serve) |
| external | 平台模块表(见下);0.1.5 起 `@deepseek-ai/dsh-client-runtime` 拆分消失,不再有官方 client 子路径豁免词 |
| noExternal | 其余全部内联(tsdown 默认会把 dependencies 外部化,必须用 noExternal 覆盖) |
| banner / footer | `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {` / `return module.exports; } });`(tsdown 会格式化多行,断言勿用单行匹配) |
| intro | `var module = { exports: {} }; var exports = module.exports;` |
| dts | false(类型由 tsc 走 lib/types,别让 dts 包装 banner) |
| define | `process.env.NODE_ENV` 与 `import.meta.env.MODE`(zustand 等内联库需要) |
| CSS Modules | 自定义插件:lightningcss 编译 `.module.css` 为 hashed classMap + 注入 `<style data-plugin>`(tsdown 自带 css 管线不处理,需虚拟 id 包装,后缀不能是 `.css`) |

平台模块表(宿主冻结模块表中的 seed 词;0.2.0-rc.2 实测自 web-frontend bundle,自 0.1.5-rc.1 起未变:旧版的 `dsh-client-web-react`/`dsh-client-ui-attachment`/`dsh-client-schema-form` 已移除,新增 `dsh-client-store`/`dsh-client-ui-dockkit`):

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
@deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
```

> 0.1.5 起的 client 端机制变化:浏览器插件 `apply(ctx)` 的上下文即 cordis 的 `Context`(不再有 `ClientContext` 类型,各官方包的 `ClientContext` 只是 `@deepseek-ai/cordis` 的 `Context` 别名);`ctx.slots`(SlotRegistry)声明在 `@deepseek-ai/dsh-client-ui-renderer/client`,`dsh-client-ui-slots` 退化为纯类型核心(SlotMap/LocaleNamespaceMap/Props* 声明合并点);client 插件声明 `dsh.client.inject` 时按需列出 locale/conversation/ui-renderer 等包入(参照官方 ui-trajectory 的 inject 列表)。
>
> 0.1.7 的增量(与本插件无关,记录以备后续):slot 系统新增可复用 Component Factory(`SlotFactoryMap`/`registerFactory`/`renderFactorySlot`),组件 props 由四 shares 扩展为五 shares(增加 `PropsRenderFactories`);`conversation.view` 仍是普通 list/session 槽,`ctx.slots.register/inject` 签名未变,仅其 owner props 由 `inspect`/`onInspectDone` 改为 `inspectCall`/`viewRequest`/`openView`/`completeViewRequest`(不消费 owner props 的标签页不受影响)。
>
> 0.2.0 的增量(实测无影响):平台模块表、`/client` 子路径导出与 slot 相关声明(含 `conversation.view` 的 kind/scope/owner)逐行未变;声明层改动集中在 `dsh-client-ui-conversation` 的 composer/input 面(如新增 `input/submission-analytics`)与 `dsh-session` 的一个新增导出,均不在本插件的使用面内。

### 2. 跨插件协作纪律(构建期 purity 门强制)

- 浏览器 bundle 只能 value-import 平台模块表内的包;其他 `@deepseek-ai/*` 一律 **type-only import**(声明合并、类型),运行时经 cordis 服务(`ctx.slots` / `ctx.locale` / `ctx.settingsScope` / `ctx.remote` / `ctx.connection`)协作
- type-only import 在打包时擦除,不会触发构建期 purity 检查
- 官方构建链有 `dsh-client-bundle-purity` 插件把违规 value import 变成构建错误,建议保留

### 3. slot 系统(注册 = 声明 + 授权)

- 组件 props 是四 shares 交集:`PropsRuntime<K>`(SlotMap owner + 框架座位)+ `PropsRenderSlots<S>`(children 渲染权)+ `PropsStore<H>`(store 座位)+ 注册时 `inject` 返回的业务面;声明 `locale` 时另有 `t` 座位
- 无 children 的组件直接 `PropsRuntime<'槽名'>` 即可(注册点类型会自动校验)
- `ctx.slots.inject('槽名', factory)` 等待他人声明的槽;factory 返回 register 的 disposer(可 yield 多个)

### 4. 数据通道选型(浏览器端展示 host 数据)

| 方案 | 结论 |
|:---:|:---:|
| 转发事件(remote $on) | 白名单在官方 api/remotes 静态声明,外部插件**不可扩充** |
| Typert remote(host-plugin-inventory 模式) | 最正规但需整套 typert 生成链,单包插件过重 |
| host webserver 路由 | 最轻:host 侧 `ctx.get('webServer', false)` 可选获取 + `register({ kind: 'exact', path, handler })`,浏览器同源 fetch;服务晚出现时用 `ctx.on('internal/service')` 补挂 |

## 四、会话区域 tab 的视觉适配基线

外部 tab 与官方 tab 并排显示,视觉必须同源。以下事实决定了第三方 tab 要自备什么,以及样式只能依赖 token 的原因。

### 宿主容器给与不给的东西

| 项 | 事实 | 结论 |
|:---:|:---|:---|
| 槽包装器 | `div[data-slot="conversation.view"][style="display:contents"]`,不产生盒子 | tab 根元素直接是 viewArea 的 flex 子项 |
| viewArea | `display:flex;flex-direction:column;flex:1;min-height:0`,无内边距、无最大宽度、无背景、无 overflow | **内边距、内容列宽、背景、滚动全由 tab 自备** |
| 滚动 | 宿主 `.scrollBody{overflow-y:auto}` 同时包住 viewArea 与 composer 座位 | 非 overlay 路线随页面滚,不要再套一层 `overflow:auto` 制造双滚动条 |
| 可继承变量 | `--dsh-chat-content-width`、`--dsh-composer-side-clearance:16px`(定义在宿主 `.body` 上)、`--dsh-composer-height`(宿主测量后写入 scroller) | 内容列宽与左右留白直接继承,不要写死像素 |

两条互斥路线,**不要混用**:

1. **随页面滚(照官方 chat tab)**:根元素自备 `padding:16px calc(var(--dsh-composer-side-clearance) + 16px)`,内容列 `width:100%;max-width:var(--dsh-chat-content-width);margin:0 auto`,不设 `data-conversation-composer-overlay`;
2. **整页盒 + 内部滚动(照官方 trajectory tab)**:根元素加 `data-conversation-composer-overlay` 属性,自备 `width/height:100%` + `background:var(--dsw-alias-bg-layer-1)` + `overflow:hidden`,滚动容器底部留 `calc(var(--dsh-composer-height,152px) + 16px)`。

> 变体:不需要阅读型版心时,路线 1 可再放宽为**铺满** —— 不设内容列 `max-width`,只留 `padding:12px var(--dsh-composer-side-clearance) 24px` 让内容铺满 viewArea;信息层级改由分区标题 + `0.5px` 分隔线组织,不再自建卡片材质(本仓库 wakatime 标签页即此路线,战绩区用独立表格呈现)。放弃内容列宽后要注意窄窗口下列宽的收敛:表格用 `table-layout:fixed` + `colgroup` 比例,长文本列允许换行,避免出现横向滚动。

### 官方控件与版式范式(可照抄)

平台模块表内的 `@deepseek-ai/dsh-client-ui-primitives` 虽是官方组件库,但官方插件开发守则**明文禁止外部插件 require 任何 Harness Client 包**(否则宿主实现变更即失效,且抛错组件会黑掉整个槽条目)。正确做法是**复制其标记、样式与行为到插件内**,只保留 `--dsw-alias-*` token 依赖,并改名到自己的类名前缀下:

| 控件/范式 | 照抄要点 |
|:---:|:---|
| Button | 基类 `inline-flex` + `gap:4px` + `radius-md`;`md` H36/padding 0 14px/14px 字号,`sm` H28/padding 0 10px/12px 字号 + `radius-sm`;`primary` = `button-primary-fill` + `label-primary-foreground`;`outline` = `0.5px border-l3`;禁用 `opacity:.4` |
| Switch | `36x20`、`padding:2px`、`radius:999px` + `corner-shape:round`(胶囊必须显式关闭全局 superellipse),开态 `aria-checked='true'` 驱动背景 `brand-primary`,关态轨道 `border-l3`、滑块 `switch-thumb`,滑块 `translateX(16px)` + `120ms` 过渡 |
| Input | 高 32px、`padding:0 8px`、`border:.5px border-l4`、`radius-md`、`background:bg-layer-1`,焦点只改 `border-color`,`::placeholder` 用 `label-dimmed` |
| 设置表单字段 | 字段 `flex column; gap:6px; padding:12px 0`,字段间 `border-top:.5px border-l2`;标签 13px/500 `label-primary`;输入高 34px、`padding:0 12px`、`border:.5px border-l4`、`radius-md`、`background:bg-layer-3`,焦点 `outline:none` + 改边框色;提示 12px `label-tertiary` |
| 设置卡片 | `border:.5px var(--dsw-alias-settings-card-stroke)` + `radius-xl` + `background:var(--dsw-alias-settings-card-fill)`;卡内 `padding:12px 14-16px`;卡标题 14px/500/20px;分组间 `.5px border-l2` + `padding-top:14px` |
| 表格 | `border-spacing:0;table-layout:fixed;width:100%` + `font:var(--dsw-font-xxs-12)`;表头 `position:sticky;top:0`、高 30px、`border-bottom:.5px border-l2`;单元格高 30px、`border-bottom:.5px border-l1`;行 hover `interactive-bg-hover` |
| 指标数字 | `dl{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px}`,`dt` 用 `label-tertiary`、`dd` 用 `label-secondary` + `font-variant-numeric:tabular-nums` + 右对齐 |
| Tag(状态标签) | `radius:999px` + `corner-shape:round` + `padding:1px 8px` + 11px/500;success 用 `color-mix(state-success-primary 10%, transparent)` 做底、文字同色;outline 用 `.5px border-l4` + `label-tertiary` |
| 可折叠行 | 24px 行高、前导 16px 图形盒 + `gap:6px`、标题 `font-xs-13` 级、行 `label-tertiary`(hover 转 `label-secondary`),chevron 用 `rotate(-90deg)` 展开时回正 |
| 焦点环 | 统一 `outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`;`--dsw-focus-ring-color` 在指针模态下为 `transparent`,故**不要硬画 2px 蓝色 outline**(会在指针模态也绘制) |
| Toast | 顶部居中 `top:40px;left:50%;translateX(-50%)`、`z-index:1100`、`pointer-events:none`、`max-width:min(640px,100vw - 48px)`、`padding:12px 16px`、`radius-lg`、`background:toast-bg` + `color:toast-label`(两种主题都是深色面)、`box-shadow:shadow-lv3`;入场 160ms、停留 3000ms、淡出 1000ms |

> 官方 Toast 经 `createPortal` 挂到 `document.body`;随包开发守则禁止插件写 `document.body`。折中:在组件内渲染 `position:fixed` 元素并照抄其 CSS——固定的定位语境仍是视口,视觉与官方一致,且不违反守则。Toast 也是「不用浏览器原生弹窗」规范的落地形态。

### 样式 token 事实(权威来源与已知坑)

- 权威来源是**主题包内联 CSS**(`dsh-client-ui-theme` 的 `lib/client.js`,约 601 个定义对 / 107 个 `--dsw-alias-*` 别名);官方 README 指向的 `docs/web-styling.md` 在安装包内**不存在**,属悬空引用,需要时回官方仓库取;
- 圆角刻度 `--dsw-radius-xs|sm|md|lg|xl|panel`(4/8/12/16/20/28);字号为 font 简写 token `--dsw-font-xxxs-11`/`-xxs-12`/`-xs-13`/`-s-14`/`-base-16`/`-m-18`/`-l-20`/`-xl-24`,各带 `-strong-` 变体,可直接 `font: var(--dsw-font-xxs-12)`;
- **没有间距刻度 token**(601 个 token 中检索 space/gap/padding 命中 0),间距只能照抄官方页面字面 px;圆角 token 名与 px 值不一致(如 `radius-lg` 是 16px),按名使用;
- 主题:浅色定义在 `body`,深色在 `body[data-ds-dark-theme]`;胶囊/正圆需显式 `corner-shape: round`;
- **不存在的 token 写了会整条声明失效**(静默,不报错):已实证 `--dsw-alias-border-l`(只有 `border-l1`..`border-l4`)、`--dsw-alias-label-error`、`--dsw-alias-bg-layer-4`。写 token 前必须在主题 CSS 里检索确认定义存在;
- 主按钮文字色官方配对是 `--dsw-alias-label-primary-foreground`(不是 `button-primary-dimmed`);卡片材质用 `settings-card-fill`/`settings-card-stroke`。

### 自检清单

1. CSS 内每个 `var(--dsw-*)` 都能在主题 CSS 中找到定义,无写死颜色;
2. 亮/暗两主题都有取值来源;窄窗口折行正常、无横向滚动;
3. 根元素自备内边距与内容列宽,且没有多套一层滚动容器;
4. i18n 文案只走 client 字典(`src/client/locales.ts`),不经 host 的 `src/translation/*.ini`;
5. `pnpm typecheck` 通过;client 产物格式断言(冒烟脚本)需构建产物,由用户构建后运行。

## 五、踩过的坑

1. **不需要新增 patch 行**:client 发现机制按 loader 条目(现有插件行)扫描,插件行同时是 host 插件与 client 条目;不要写成 `xxx/client` 子路径行
2. **client.js 缺失 = web profile 启动失败**:激活期扫描发现 `exports["./client"]` 指向的文件不存在会聚合抛错;必须构建产出后再启动
3. **官方仓库快照与发布包版本可能不同**:源码快照版本往往低于发布包;核对发布包类型与快照源码在所用 API 上的一致性或差异,换版本时务必以发布包类型为准(0.1.1-rc.2→0.1.5-rc.1 实测:client 上下文/`ctx.slots` 声明来源/平台模块表均有变化,见上;0.1.5-rc.1→0.1.7-rc.2 实测三者均未变,但 slot 系统新增 Factory 机制与 `conversation.view` 的 owner props 变更;0.1.7-rc.2→0.2.0-rc.2 实测三者与 slot 声明均未变,注意官方 `docs/user/develop/` 两版逐字节相同,**不可**作为升级安全依据,须对比发布包 `lib/types` 声明并跑类型检查/构建/冒烟测试)
4. **CSS Modules 需要 lightningcss**:tsdown 不内置该管线,官方用自定义插件(虚拟 id + lightningcss transform);不想要 CSS 文件时可用内联样式规避
5. **样式纪律**:使用已定义的语义 token,不写死颜色;写 `var(--dsw-*)` 前在主题 CSS 里确认该 token 存在(未定义时整条声明静默失效,实例:`--dsw-alias-border-l` 应为 `border-l1`..`border-l4`);产品文案用界面语言;**表格/select 文本居中属本仓库前端规范,与官方表格左对齐不同,两者冲突时按项目规范执行**;不用浏览器原生弹窗与原生二次确认
6. **pnpm 无 TTY 会 abort**:package.json 描述符变更后需 `CI=true pnpm install`;typecheck/build 也建议 `CI=true` 前缀
7. **子页/浮层与 ESC 收起**:外部 tab 需要可收起的子页时,在组件内渲染 `position: fixed` 浮层即可(遮罩 + 面板,不写 `document.body`、不用浏览器原生弹窗);键盘收起用 `window` **捕获阶段**监听 `keydown`,命中 ESC 时 `stopPropagation()` 以阻断宿主同时响应;打开后把焦点移入面板(如关闭按钮)、收起后还给入口按钮。宿主对标签页通常是"未选中即卸载或隐藏",固定定位浮层不会跨标签残留

## 六、参考文件索引(官方仓库)

| 文件 | 用途 |
|:---:|:---:|
| `packages/client/tsdown.client.ts` | clientBundle 预设(client 产物构建链) |
| `packages/client/web/src/platform.ts` | 平台模块表(CLIENT_EXTERNALS 来源) |
| `packages/client/modules/src/index.ts`、`client/manifest.ts` | host 扫描与 serve 机制、boot 协议 |
| `packages/client/ui-trajectory/src/client/index.ts` | 会话区域 tab 注册范例(conversation.view) |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | conversation.view 槽契约(类型家) |
| `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` | tab 栏渲染与 renderSlot 调用(owner props) |
| `packages/client/ui-settings-plugins/src/client/index.ts` | 设置页 tab/卡片注册范例(settings.plugins.tab / settings.plugin.item) |
| `packages/client/ui-settings/src/client/contract/slots.ts` | settings 域 slot 契约(类型家) |
| `packages/client/ui-slots/src/index.ts` | slots 核心类型(register/Props*/SlotMap) |
| `packages/client/AGENTS.md` | client 包纪律(导出/ctx/props 四 shares) |
| `docs/web-styling.md` | 样式 token 与组件规则(注意:安装包内**不含**该文件,需回官方仓库取) |
| `packages/client/ui-primitives/src/*.module.css`、`src/settings-form/*` | 官方控件与设置表单的标记/样式真值(复制来源;发布包内为 `lib/index.js` 与 `lib/**/*.css`) |
| `packages/client/ui-theme/src/*.css` | `--dsw-alias-*` 语义 token 与圆角/字号刻度定义(发布包内为 `lib/client.js` 内联 CSS) |
| `packages/client/ui-chat/src/client/*`、`ui-trajectory/src/client/*` | 非 overlay 与 overlay 两条 tab 版式路线的官方实现 |
| `packages/host/webserver/src/index.ts` | webserver 服务(register 路由扩展点) |

> 本项目实例:dsh-wakatime-plugin 在会话区域注册 wakatime 标签页(conversation.view 槽,order 20),数据通道走 host webserver 路由(`/api/wakatime/*`),并注册 zh/en 字典跟随 dsh web 语言;版式走第四节第 1 条「随页面滚」路线的铺满变体(不设内容列最大宽度、不自建卡片,分区靠 `0.5px` 分隔线,战绩为指标/数值/说明三列表格),字设与配色取 profile 的 `--dsw-font-*`(strong 变体为 `<字号>-strong-<px>`)与 `--dsw-alias-*` 令牌,控件形态按第四节表格自行复制官方 primitives,配置表单放在标签页右上角按钮呼起的子页里(组件内固定定位遮罩浮层,ESC 或遮罩点击收起);相关项目细节见根目录 `AGENTS.md` 设计细节段。