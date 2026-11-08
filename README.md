# 资产罗盘（AssetManager）

**简体中文** | [English](README.en.md)

在网页上管理多币种资产、流水、汇率和收益，账本存入自己部署的 MongoDB。可部署在支持 Linux Docker 的服务器、电脑或 NAS，镜像支持 x64 和 ARM64。

## Docker 部署

```sh
git clone https://github.com/cimorn/Asset.git
cd Asset
cp .env.example .env
```

编辑 `.env`：设置登录密码 `APP_PASSWORD`、至少 32 位的随机 `SESSION_SECRET`、随机十六进制数据库密码 `MONGO_APP_PASSWORD`，将 `APP_ORIGIN` 改为自己的 HTTPS 网址。`APP_PORT` 是主机端口，`MONGODB_DATA_DIR` 是数据库保存目录。

```sh
docker compose up -d
docker compose exec asset node scripts/init-ledger.mjs --apply
```

将 HTTPS 反向代理指向主机的 `APP_PORT` 端口，保留原 Host 请求头 ---> 打开 `APP_ORIGIN` 网址 ---> 输入密码 ---> 在“设置与汇率”中设置汇率并添加资产。

初始化命令只用于首次创建空账本，已有账本会拒绝覆盖。已有部署沿用自己的数据库挂载、密码、`SESSION_SECRET`、`LEDGER_INSTANCE_ID` 和 `LEDGER_ID`，更新程序时不要用示例值覆盖。

## 开发

```text
website/             网页前端和 Node.js API
deploy/docker/       MongoDB 初始化配置
.github/workflows/   Docker 镜像自动构建
docker-compose.yaml  通用 Docker 部署
```

需要 Node.js 22.13 或更新兼容版本。

```sh
cd website
npm ci
cp .env.example .env
# 设置 MONGODB_URI、APP_PASSWORD、SESSION_SECRET、LEDGER_INSTANCE_ID。
# 本地开发将 APP_ORIGIN 设为 http://localhost:3000。
npm run build
npm run dev
```

开发环境连接 MongoDB 的 `asset` 数据库，账号为仅有该库读写权限的 `asset_app`。请使用独立开发数据库实例。

在 `website/` 运行 `npm run typecheck` 检查类型，构建后运行 `npm test`。

## 更新

程序：修改代码 ---> 提交并推送 GitHub `main` ---> 等待 Actions 成功 ---> Docker 主机拉取并更新应用。

```sh
docker compose pull asset
docker compose up -d --no-deps asset
```

账本内容：打开网页 ---> 修改资产、流水或汇率 ---> 保存／确认更新。未保存输入保留在当前浏览器，换设备前先确认保存成功。

回退程序时，将应用镜像改为 `ghcr.io/cimorn/asset:sha-完整提交号`，再更新应用容器。

## 备份与恢复

- 当前账本：设置与汇率 ---> 下载备份 ---> 保存 JSON。
- 完整账本及历史：网页登录 ---> 打开同域名 `/api/ledger/backup` ---> 保存 JSON。
- 服务配置：备份 `.env`、实际使用的 Compose 文件和数据库挂载路径。

完整恢复须使用空账本目标。在网页目录安装依赖并构建后，将恢复目标连接配置放入私密 `.env`，先检查，再恢复：

```sh
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json --apply
```

维护工具使用登录后的完整备份，拒绝覆盖已有账本。配置与备份存放在私人位置，至少在部署主机之外另存一份。更新镜像保留数据库目录，不执行 `docker compose down -v`。

源码采用 [MIT](LICENSE) 许可，第三方资源见 [NOTICE](NOTICE)。
