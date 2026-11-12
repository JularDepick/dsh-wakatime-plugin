# 翻译文件规范(translation-ini)

## 存放位置

翻译文件存放于 `src/translation/` 目录.

## 命名规范

翻译文件命名遵循 `xx-YY.ini` 格式:

- `xx`: 语言代码,小写,遵循 ISO 639-1,如 `zh`,`en`
- `YY`: 地区代码,大写,遵循 ISO 3166-1 alpha-2,如 `CN`,`US`

示例: `zh-CN.ini`(简体中文),`en-US.ini`(美式英语).

## 文件内容

- 使用 INI 格式,UTF-8 编码.
- 翻译 ini 中不使用注释.
- 文件结构包含两个节:
  - `[meta]`: 翻译文件的元信息,包含以下键:
    - `for`: 本翻译文件对应的插件版本号
    - `lang`: 语言代码,与文件名 `xx-YY` 一致
    - `name`: 语言显示名(仅供人工识别;加载器只解析 [translation] 节, Web UI 语言名由 dsh 自带语言行提供)
    - `endtime`: 最近维护时间,遵循守则日期格式 `yyyy-MM-dd HH:mm:ss+HH:mm`
  - `[translation]`: UI 文案键值对,键名使用英文,值使用对应语言的文案.
- 新增翻译文件时,以 `src/translation/.example_zh-CN.ini` 为基准模板(简体中文版复刻),从该模板翻译更新为 `xx-YY.ini`,改写 `[meta]` 各键后翻译 `[translation]` 键值.

## 模板维护流程

- `src/translation/.example_zh-CN.ini` 是翻译文件的基准模板,内容即简体中文版,与 `zh-CN.ini` 保持一致.
- 版本迭代时直接维护该基准模板(补充,调整 `[translation]` 键值),并保持 `zh-CN.ini` 与基准模板一致.
- 模板更新后,其余语言版本(如 `en-US.ini`)从模板翻译更新,保持各语言键集一致.

## 语言切换机制

- 本套 ini 翻译服务于 host 侧工具文案,由插件配置 `locale`(zh-CN/en-US)选择,未命中回退默认语言 `zh-CN.ini`.
- Web UI(浏览器端)文案不经 ini: 由 `src/client/locales.ts` 的 zh/en 字典提供,语言跟随 dsh web UI 切换.

## 与 Web UI 字典的键名重叠

ini 与 `src/client/locales.ts` 共用同一套键名(如 `credential.errApiKeyFormat`, `credential.fromEnv`, `status.configured`), 但两处的值允许存在措辞差异, 这不是漏改:

- host 工具面(ini)取完整自明的表述, 需要带官网获取网址, 因为工具输出没有任何上下文可点.
- Web UI 面(locales)取简短表述, 网址由凭证输入框下方单独一行呈现, 不再重复进句子.
- 个别键两边的形态本就不同(如 `stats.promptEstimate` 在 ini 是指标标签, 在 locales 是数值模板 `≈ {n} tokens`), 属分工而非不一致.

维护任一侧时不必同步另一侧的字面值, 只需保持各自内部的中英一致与键集合完整.

## 不参与翻译的内容

- 工具元数据(工具名, `description` 与参数说明)面向模型而非界面, 恒为英文常量, 不进 ini 也不进 locales.
- 工具输出, Web 界面文案, 错误提示这类面向人的文本必须走翻译; 新增面向人的文案时同步补齐两侧键.
- ini 里不应保留 host 侧已无引用的键: 键被工具面弃用后随该次改动一并删除, 避免维护者误以为 host 仍需要它.
