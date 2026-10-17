# NAS 部署与维护

2026-10-14 已按用户最终指定的结构部署：`asset` 项目运行应用 `asset` 和资产专用数据库 `mongodb-asset`。数据库名为 `asset`，数据挂载目录为 `/volume1/docker/mongodb/data/asset`。网页和桌面共用 NAS API，保存后直接写入该库。

当前项目使用自身的 `asset_default` 网络，应用镜像为 `asset:2.0.6`，端口为 `192.168.1.107:8092`。独立 Mongo 使用 NAS UID/GID `1000:10`。升级前保留完整备份，核对当前账本与历史版本；不要改写其他数据库。

## 文件位置和配置

源码保存在 `/volume1/docker/asset`，保持 `deploy/nas` 相对路径。命令行从源码根目录运行：

```sh
docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml build asset
docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml up -d asset
```

上传包根目录另提供适合 GUI 工作目录的 `compose.yaml`，build context 为 `.`，env_file 为 `deploy/nas/.env`。在 GUI 中选择上传包根目录，再导入根目录 Compose。源码内 `deploy/nas/compose.yaml` 的 context 为 `../..`，不要混用这两种工作目录。

从源码 `.env.example` 创建私密 `deploy/nas/.env`。使用 `APP_ORIGIN=https://asset.mcj.life`，保持已有 `APP_PASSWORD` 和 `SESSION_SECRET`。配置稳定的 `LEDGER_INSTANCE_ID`、`LEDGER_ID=main` 和可选 `LEGACY_ACCOUNT_ID`。账号密码和旧缓存摘要不能进入源码包、文档或 Git。

`MONGODB_URI` 格式为 `mongodb://asset_app:<URL编码后的密码>@mongodb-asset:27017/asset?authSource=asset`。服务拒绝管理员账号、其他默认库和跳过 TLS 校验的连接串。Docker 内部连接使用项目自身网络，不添加 Mongo 的公网或 LAN 端口映射。正常启动直接执行 `node server/index.mjs`，不运行临时核对或历史迁移脚本。

当前 Compose 使用项目默认网络，不依赖其他项目的网络名或数据库名称。应用端口为 `192.168.1.107:8092`，数据库不映射外部端口。博客及其他容器配置保持不变。

镜像使用 Node 22 ARM64，构建前端和财务计算后只复制运行文件。最终镜像不含飞书客户端、飞书导出工具、管理员配置、浏览器缓存或账本备份。HTTP 容器使用非 root 账号、只读根目录和临时 `/tmp`，日志最多 10 MB × 3；健康检查只读取本机 `/healthz`。

LAN `http://192.168.1.107:8092/healthz` 只用于 HTTP 进程检查。生产登录和账本 API 仍要求 canonical Host 和 HTTPS Origin；LAN IP 的账本请求会被拒绝。现有 Cloudflare Tunnel 可转发到该 LAN 地址，应用和客户端使用同一正式 HTTPS 域名，不能关闭 TLS 验证处理证书错误。

## 账号和首次迁移

正式运行仅加载 `asset_app` 的资产库连接串。已创建的账号保持 `asset` 的 `readWrite` 权限；不要把管理员配置加入运行服务。现有专用库数据直接复用，`storage-init.js` 仅在空数据目录首次启动时创建资产账号，不会改写已有数据。其他初始化脚本不是正常 Compose 服务。

在本机只读导出最终飞书账本，保存原 `finance-atlas` v1 文件及摘要，核对未完成旧保存并导出浏览器旧草稿。服务启动不自动导入。

首次迁移通过正在运行的唯一服务完成。登录同一 HTTPS 来源后，向 `POST /api/ledger/import` 提交 `{backup:原始完整 finance-atlas v1 对象}`。不要手工调整金额或重新构造金融数据。默认只预检查，返回 `applied:false`、输入摘要和数量，数据库零写入。核对摘要后，再提交同一 `backup` 并明确加入 `apply:true`。已有正式账本始终返回 409，不能覆盖；写入后立即回读并核对输入摘要，只有 `verified:true`、`ready:true`、`sync.source:'nas'` 且无错误才可视为迁移读取成功。接口保留登录 cookie、同 Origin/Host 和 48 MiB JSON 限制。

核对资产和流水 ID、分类、余额、收益、历史 FX 和曲线。写入及多端交互测试使用本机临时数据库，不用生产账本测试。完成正式登录和回读后再切换正式域名；网页保存／确认更新内部调用两阶段 API，成功回读后显示已保存。

## 全量备份与恢复

登录后的 `GET /api/ledger/backup` 下载完整 `asset-mongo-backup`，包含正式指针、全部不可变版本、回执和结构版本。整个文件和各版本带摘要，至少在 NAS 之外保留一份私密副本。设置中的可见账本下载继续提供原 `finance-atlas` 备份。

恢复全量历史使用本机维护脚本，默认预检查，目标必须为空。该工具可在已有 `asset` 容器内执行，不需要另建维护项目。Linux 运维终端可将私密完整备份通过标准输入传入现有容器：

```sh
docker exec -i asset node scripts/mongo-maintenance.mjs restore --input /dev/stdin < /private/asset-full.json
# 预检查通过、目标为空并明确确认后才加 --apply
```

本机 Node 环境也可使用 README 中的 `--env-file` 维护命令；运行配置始终使用资产库独立账号，工具不输出连接串或账本正文。首个正式迁移使用 `/api/ledger/import`，完整历史恢复使用维护脚本，不混用两种备份格式。已有新保存后，不能直接切回缺少这些记录的旧飞书副本。
