# 版本号索引

项目当前版本号: `v0.5.2`

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
AGENTS.md:439  # 版本号索引段的当前版本
AGENTS.md:445  # 0.4.0 已定版条目
AGENTS.md:446  # 0.4.1 已定版条目
AGENTS.md:447  # 0.5.0 已定版条目
AGENTS.md:448  # 0.5.1 已定版条目
AGENTS.md:449  # 0.5.2 已定版条目
AGENTS.md:476  # 项目启动段的当前版本
AGENTS.md:370  # 目录结构段 src/migrate/ 的迁移标注
AGENTS.md:412  # 设计细节段凭证与配置存放的版本语境
AGENTS.md:424  # 设计细节段多进程数据一致性的配置/数据结构版本语境
README.md:65-67  # 升级说明段的 0.3.0 / 0.4.x -> 当前双槽 迁移与混跑警告(历史语境, 不随版本号迭代)
README_en-US.md:65-67  # 升级说明段的 0.3.0 / 0.4.x -> 当前双槽 迁移与混跑警告(历史语境, 不随版本号迭代)
docs/repo-spec/tag-release-spec.md:15,23  # Tag&Release 规范里的版本号示例(随定版更新)
# 版本文档(v*-*.md)按版本新建,旧版本文档不重命名,故不在同步清单内

---

> 推进 dsh 兼容区间时,下列位置需要成对同步(当前区间 `>=0.2.1-rc.1 <=0.2.2-rc.3`)

package.json:44          # engines.dsh(启动器侧判定, 走 includePrerelease 语义)
package.json:74-80       # 七个宿主包的 peer 范围(安装侧判定, 走默认严格语义, 两处必须一致)
README.md:60,62,63       # 兼容性段: 支持区间 / 安装校验 / 上界之后的版本被拒绝
README_en-US.md:60,62,63 # 同上(英文版)
AGENTS.md:294,296,297    # 技术栈表的三行区间
AGENTS.md:429            # 设计细节「dsh 版本兼容声明」(区间策略与两处判定的语义差)
AGENTS.md:431            # 设计细节「dsh 0.2.2-rc.3 追加支持的依据」
AGENTS.md:449            # 版本号索引段当前版本条目里的区间
AGENTS.md:492-493        # 开发经验「版本对齐」与 rc.3 版本对齐结论里的上界口径
docs/repo-spec/tag-release-spec.md:15,19,23  # Release 名里的 dsh 上界与区间示例
docs/tech-spec/dsh-web-tab-experience.md:5   # 已核对过的发布包清单

<!-- 允许Agent继续新增需要被同步更新版本号的地方(只登记被git追踪的文件) -->
