# 版本号索引

项目当前版本号: `v0.5.1`

> 读取到本文件时,请先查看Git历史,配置文件,关键文档,然后再向用户汇报确认项目当前的真正版本号并更新(如果需要)

---

> 当项目版本号迭代更新时,下列记录的文件需要被同步更新版本号

version.index.md:3
package.json:3
src/translation/zh-CN.ini:2
src/translation/en-US.ini:2
src/translation/.example_zh-CN.ini:2
README.md:5
README_en-US.md:5
# README.md:45 与 README_en-US.md:45 的安装示例改用各自语言的版本占位符(<版本> / <version>), 不再含具体版本号, 故不在同步清单内
AGENTS.md:436  # 版本号索引段的当前版本
AGENTS.md:442  # 0.4.0 已定版条目
AGENTS.md:443  # 0.4.1 已定版条目
AGENTS.md:444  # 0.5.0 已定版条目
AGENTS.md:445  # 0.5.1 已定版条目
AGENTS.md:472  # 项目启动段的当前版本
AGENTS.md:369  # 目录结构段 src/migrate/ 的迁移标注
AGENTS.md:411  # 设计细节段凭证与配置存放的版本语境
AGENTS.md:423  # 设计细节段多进程数据一致性的配置/数据结构版本语境
README.md:64-66  # 升级说明段的 0.3.0 / 0.4.x -> 当前双槽 迁移与混跑警告(历史语境, 不随版本号迭代)
README_en-US.md:64-66  # 升级说明段的 0.3.0 / 0.4.x -> 当前双槽 迁移与混跑警告(历史语境, 不随版本号迭代)
docs/repo-spec/tag-release-spec.md:15,23  # Tag&Release 规范里的版本号示例(随定版更新)
# 版本文档(v*-*.md)按版本新建,旧版本文档不重命名,故不在同步清单内

<!-- 允许Agent继续新增需要被同步更新版本号的地方(只登记被git追踪的文件) -->
