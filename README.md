# 资产罗盘 · NAS 网页版

网页和桌面版通过同一个 HTTPS API 读取 NAS 的 MongoDB 正式账本，数据库名称固定为 `asset`。沿用原有页面、分类、流水计算、余额更新和各日期汇率。点击“保存／确认更新”后直接保存到 NAS，无需另点上传。

## 分类与总览（2.0.8）

分类选项固定为股市、黄金、虚拟币、现金，现金也可包含保留买入成本和收益的持仓。调整分类不产生转账，不重置成本；“剩余”资产仍按余额流水计算。总资产包含全部分类，总投资不含现金；四类占比均按总资产计算，现金显示在最右侧。

转账账户按分类分组。总览曲线为“投资资金”和“收益率”，后者按不含现金的投资收益除以历史净投入计算；下方显示股市、黄金和虚拟币收益率。人民币、港币、美元、USDT、现金的资产代码分别为 RMB、HKD、USD、USDT、cash，记账币种及历史汇率保持不变。

尚未确认的汇率输入及失败保存的确认动作、原始基线和 journal 保存在本机。初次读取失败不会显示空账本为读取成功；已读取过的浏览器可显示缓存并保留输入。确认动作内部先准备、再提交，成功回读后才显示已保存。不同设备的独立输入按稳定 ID 合并，同字段冲突返回 409 并保留输入；中断后明确续传同一请求，不重复生成流水。旧草稿保留备份，需要核对重填，不能自动混入新的保存。

正式账本使用不可变 `ledger_versions` 和单文档 `ledgers` 指针。发布指针、版本号和上传回执一起以条件更新写入，适用于现有 MongoDB 7.0 standalone，不需要跨集合事务。资产汇总、成本、收益和曲线仍由现有 `ledgerInputs` / `projectLedger` 计算。

## 分类与资金调整（2.0.5）

全部资产的分类标签可直接点击，选择已保存汇率的日期后调整。分类改变作为中性流水，保留之前的归属、市值和买入成本；同一资产同一天再次调整只修正当日分类记录。

卖出、全部卖出和买入进入同一个资金转移表单，直接选已有来源或目标。支持跨平台、分类及币种，填写来源到账金额、卖出后剩余市值、实际转入金额和转入后市值，一次确认产生相互关联的两条流水并一起保存。余额资产仍记“剩余 · 转出／转入”；投资资产记卖出或买入，不新建中间现金账户。

目标人民币投入依据来源金额及操作日期汇率计算，实际到账与默认换算的差额反映在收益中。来源历史买入成本保留，转移不重复计作外部本金。所有业务日期仅可选已保存汇率日期，只有汇率设置允许新增日期。补录会回放后续流水，余额不足或并发超卖返回 409，保留输入。

先更新 NAS 服务，再使用 2.0.5 桌面 EXE。服务状态返回 `assetAdjustments: 1`；旧服务下，桌面保留新的分类或转移输入，并拒绝准备或提交该新格式。

## 运行配置

从 `.env.example` 创建私密 `.env`。NAS 使用独立账号 `asset_app`，仅授予 `asset` 的 `readWrite`。连接串只保存在服务端；数据库不开放公网端口，也不交给桌面或浏览器。

| 配置 | 含义 |
| --- | --- |
| `APP_PASSWORD` | 网站与桌面 API 登录密码 |
| `SESSION_SECRET` | 至少 32 位，签名会话和恢复记录；保留原值 |
| `APP_ORIGIN` | 正式 HTTPS 根地址，如 `https://asset.mcj.life` |
| `MONGODB_URI` | Docker 内部 Mongo 连接串，密码须 URL 编码，`authSource=asset` |
| `MONGODB_DATABASE` | 固定为 `asset` |
| `LEDGER_INSTANCE_ID` | 稳定的非秘密实例名称，如 `asset-nas`；重启或恢复时保持不变 |
| `LEDGER_ID` | 账本名称，默认 `main` |
| `LEGACY_ACCOUNT_ID` | 可选：迁移前登录响应的旧 `accountId` 摘要；NAS 不需要飞书密钥 |
| `PORT` | 默认 3000 |

`LEDGER_INSTANCE_ID` 与 `LEDGER_ID` 共同决定缓存命名空间。指定 `LEGACY_ACCOUNT_ID` 后，同一浏览器来源中的旧草稿及汇率输入只有成功读取 NAS 后才进入恢复流程；旧账号记录不删除。旧飞书签名 journal 不会提交到 NAS，缺少原始上下文的旧汇率表单也不自动重放。页面提供“下载旧草稿备份”和“备份并读取正式账本”，核对后重新填写。更换域名会更换浏览器存储来源，须在原域名先导出未保存输入。

## NAS 部署

已完成部署的入口、核对结果和备份位置见 [实际部署记录](docs/nas-deployment.md)。

完整步骤见 [deploy/nas/README.md](deploy/nas/README.md)。`asset` 项目运行应用容器 `asset` 和专用数据库容器 `mongodb-asset`，使用项目默认网络 `asset_default`。数据库名为 `asset`，数据目录为 `/volume1/docker/mongodb/data/asset`。应用同时提供页面和 API，通过现有 Cloudflare Tunnel 连接同一 HTTPS 域名。正常升级只更新应用，保留数据库目录和私密配置。

健康检查 `/healthz` 只证明 HTTP 进程可用。以登录后的 `/api/book?refresh=1` 返回 `ready:true`、`sync.source:'nas'` 且无 `sync.error` 为实际读取成功。

## 备份和恢复

使用 Node 22.13 或更新兼容版本，先执行 `npm ci --include=dev` 和 `npm run build`。维护命令不输出连接串、密码或账本正文。

```powershell
# 正式账本全量导出：包括不可变历史版本、发布指针、上传回执和结构版本
node --env-file=.env scripts/mongo-maintenance.mjs export --output C:/private/asset-backup.json

# 原 finance-atlas v1 本机备份迁移：默认仅预检查，目标必须是空账本
node --env-file=.env scripts/mongo-maintenance.mjs import --input C:/private/finance-source.json
node --env-file=.env scripts/mongo-maintenance.mjs import --input C:/private/finance-source.json --apply

# 全量恢复同样默认预检查，显式 --apply 才写；已有账本拒绝覆盖
node --env-file=.env scripts/mongo-maintenance.mjs restore --input C:/private/asset-backup.json
node --env-file=.env scripts/mongo-maintenance.mjs restore --input C:/private/asset-backup.json --apply
```

全量备份使用规范化 JSON 的 SHA-256 总摘要，每个版本另有输入摘要。恢复校验结构、摘要、指针、回执及输入可重算性；写入后回读再核对输入摘要。文件使用独占创建，拒绝覆盖已有备份。导入中断时未发布版本不会被读取；保留原备份，再执行恢复。私密备份目录不进入 Git，并至少在 NAS 之外留一份。

飞书的最终导出只在本机读取旧环境配置：

```powershell
node --env-file=C:/private/old-feishu.env scripts/export-feishu-readonly.mjs --local-feishu-read-only --output C:/private/finance-source.json
```

该工具只允许 GET，拒绝飞书写入；生产环境或携带 `MONGODB_URI` 的进程会拒绝运行。飞书配置、导出工具和管理员配置不进入 NAS 应用运行镜像。服务端完整备份也可通过登录后的 `GET /api/ledger/backup` 下载；设置中的现有可见账本下载继续可用。

## 共享 API 契约

生产只接受 `APP_ORIGIN` 的 Host。所有 POST 需要相同 `Origin`，JSON 内容类型；桌面请求也须带该 Origin，并在内存保存登录 cookie。生产 cookie 为 HttpOnly、SameSite=Strict、Secure，客户端不得关闭 TLS 验证。

登录限制：同一连接来源每分钟最多提交 10 次，15 分钟窗口内累计失败 6 次后须等待该窗口结束；全站每分钟最多接受 60 次登录提交，同时处理最多 4 个。限制在读取登录正文前检查，格式错误也计数；成功登录只扣回本次失败预留，不清空提交次数和之前的失败记录。429 响应提供 `Retry-After` 与中文等待提示。只使用 socket 来源，不信任客户端自填的转发 IP；同一反向代理后的访问共享来源额度。计数只存服务内存，重启服务清零，不写入账本数据库，已登录的会话不受登录限流影响。

| 接口 | 请求及响应 |
| --- | --- |
| `GET /api/session` | `{authenticated}`；登录后还返回 `accountId/cacheNamespace/instanceId/ledgerId/source` 和可选 `legacyAccountId` |
| `POST /api/login` | `{password}`；成功返回上述身份，Set-Cookie 设置会话 |
| `POST /api/logout` | `{}`，清除 cookie |
| `GET /api/book?refresh=1` | 强制读取，返回 `{book,ready,sync}`；失败保留上次完整 book，通过 `sync.error` 报错 |
| `GET /api/ledger/status` | 返回当前来源、配置、连接和上传状态 |
| `POST /api/ledger/connect` | `{}`，读取服务器绑定的账本；客户端不能切库或账本 |
| `POST /api/ledger/prepare` | `{book,baseBook}`；返回 `{journal:{payload,signature}}`，不写库 |
| `POST /api/ledger/upload` | `{journal}`；回读成功返回 `{book,ready,sync}` |
| `POST /api/ledger/import` | `{backup:finance-atlas对象,apply?:boolean}`；默认空库预检查，明确 `apply:true` 后写入并返回 `{applied,verified,hash,book,ready,sync}`；已有账本 409 |
| `GET /api/ledger/backup` | 登录后下载 `asset-mongo-backup` 全量摘要备份 |

`baseBook` 是确认动作前的基线版本。客户端在用户确认时依次调用 prepare/upload，只有 `ready:true`、`sync.source:'nas'` 且无 error/warning 才视为保存成功。journal 是签名的不透明 JSON 记录，绑定 NAS 来源及账本身份；保留原值到成功回读。恢复有效期为 7 天，指针保留最近 1024 个请求回执；准备后的账本更新次数超过该窗口时拒绝重放。旧来源和过期记录也拒绝提交。真正的冲突返回 `{error,conflicts:[字段路径]}` 与 409；401 须重新登录，输入与 journal 保留。`/api/feishu/connect|prepare|upload` 作为旧版本路由别名，仍指向 NAS。

网页确认保存由浏览器缓存 adapter 的 `/api/ledger/save {version,action}` 完成，内部调用共享两阶段 API；它不是新的服务端接口。确认动作持久化后，重复同一确认或点击“继续上次保存”续传同一 journal。新的不同动作不会覆盖未完成的确认。旧草稿或过期、冲突恢复记录可点击“备份并读取正式账本”，先下载并在 IndexedDB 另存完整记录，再核对重填；不写正式库。`/api/ledger/reprepare` 也只由缓存层处理。

资产编辑的缓存请求同时携带弹窗打开时保存的 `assetBase`。刷新和版本冲突后的重试不重置该基线：先对原资产、用户提交的资产和当前资产按字段合并，再调用原财务动作。仅改名称时，独立的远端备注和新流水保留；两边都改名称时仍返回 409。缺少原始资产上下文的更新拒绝保存，输入保留供核对重填。此字段只属于客户端 mutation provenance，共享服务端 prepare/upload 合同不变。

汇率表单的 `/api/rate-draft` 缓存写入同时携带实际渲染的 `version`，保存已验证原账本与每币种原始输入意图。刷新、重开或改变生效日期不重置已修改字段的基线。未改字段使用该日期之前最新已验证的有效汇率，未来 FX 行不泄漏回历史日期。无绑定上下文的旧表单保留供导出，确认保存返回 409，需备份后重新填写。

首次迁移可在已登录的相同 HTTPS 来源提交 `{backup:{format:'finance-atlas',version:1,exportedAt,book},apply:true}`。省略 `apply:true` 仅预检查，零写入；导入必须是空账本，回读核对 projected inputs 摘要后返回 `verified:true`。接口使用现有鉴权、Origin/Host 检查和 48 MiB JSON 上限，启动服务不自动导入。完整历史恢复仍使用维护脚本，不能用首次迁移接口覆盖现有数据。

## 本地验证

```powershell
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node build.mjs
```

Mongo 集成测试下载官方 MongoDB 7.0.35，启动本机临时 standalone 实例，并使用随机的 `asset_test_*` 等数据库。测试不读取本机 `.env`，不连接或写入 NAS 正式库。HTTP 集成测试覆盖登录、CSRF、两阶段上传、兼容路由、冲突和故障缓存；IndexedDB 测试覆盖旧草稿保留、来源迁移与离线缓存。新机器第一次测试需要下载官方 Mongo 二进制。
