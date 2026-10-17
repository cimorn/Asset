# 资产罗盘：部署、更新和备份

网页与桌面共用 NAS 的 MongoDB `asset` 账本，保存／确认更新后直接写入 NAS。

## 发布程序

更新 NAS 上的程序源码 ---> 保留 `deploy/nas/.env` 和 MongoDB 数据目录 ---> 重新构建、部署 `asset` 应用 ---> 登录核对。

Docker 项目为 `asset`，包含应用容器 `asset` 和数据库容器 `mongodb-asset`。数据库名为 `asset`，挂载目录为 `/volume1/docker/mongodb/data/asset`。正常更新只更换应用程序，不重新导入账本，不清空数据库。

源码部署使用 `deploy/nas/compose.yaml`；GUI 使用与其工作目录匹配的 Compose。构建方法及参数见 [NAS 部署与维护](../deploy/nas/README.md)。

桌面：生成新版 `app/dist/资产罗盘.exe` ---> 替换旧程序 ---> 打开并读取 NAS。个人配置仍使用 `%APPDATA%/FinanceAtlas/nas.env`。

## 修改内容

打开软件或网页登录 ---> 读取 NAS ---> 修改资产、分类、流水或汇率 ---> 保存／确认更新。

换设备：当前设备确认保存成功 ---> 新设备打开并读取最新账本。

保存失败：保留输入 ---> 恢复网络 ---> 继续上次保存。发生冲突时先核对正式账本。

## 备份

- 当前账本：设置与汇率 ---> 下载备份 ---> 私下保存 JSON。
- 完整历史：网页登录 ---> 访问同域名 `/api/ledger/backup` ---> 保存 JSON。
- 桌面配置：私下备份 `%APPDATA%/FinanceAtlas/nas.env`。
- NAS 配置：私下备份 `deploy/nas/.env` 和正式 Compose。

本地原始备份与运行核对记录仅保存在私人目录，不发布到 GitHub。完整备份至少在 NAS 之外另存一份。

## 恢复

恢复配置 ---> 创建空账本目标 ---> 使用完整 JSON 备份预检查 ---> 核对通过后显式应用 ---> 读取验证。

完整恢复使用 `scripts/mongo-maintenance.mjs`，具体命令见 [维护说明](../deploy/nas/README.md#全量备份与恢复)。工具拒绝覆盖已有正式账本；不要把当前可见账本 JSON 与完整历史备份混用。
