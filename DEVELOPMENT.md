# Asset 网页开发说明

## 目录

```text
Asset/
├─ website/
│  ├─ src/             浏览器入口、登录和本地缓存
│  ├─ components/      业务页面和 UI 组件
│  ├─ app/             网页样式
│  ├─ hooks/           React hooks
│  ├─ lib/             资产、成本、汇率和收益计算
│  ├─ shared/          前后端共享逻辑
│  ├─ server/          Node.js API 和 MongoDB 账本
│  ├─ scripts/         账本初始化、备份恢复
│  ├─ tests/           回归测试
│  ├─ public/          静态资源
│  ├─ .env.example     本地开发配置模板
│  └─ Dockerfile       网页镜像构建
├─ deploy/docker/      MongoDB 账号初始化
├─ .github/workflows/  GitHub 检查和镜像发布
├─ .env.example        Docker 部署配置模板
└─ docker-compose.yaml
```

界面入口在 `website/src/main.tsx`，服务入口在 `website/server/index.mjs`，数据库读写在 `website/server/mongo-ledger.mjs`，财务操作入口在 `website/lib/finance.ts`。

## 本地运行

准备 Node.js 22.13+、npm，以及一套独立的开发 MongoDB 7。数据库名为 `asset`，连接账号为仅拥有该库读写权限的 `asset_app`。

在仓库根目录运行以下命令。Windows PowerShell 用 `Copy-Item .env.example .env` 复制配置。

```sh
cd website
npm ci
cp .env.example .env
```

编辑 `website/.env`，填写开发环境配置。

| 配置项 | 填写方式 |
| --- | --- |
| `APP_PASSWORD` | 本地网页的登录密码 |
| `SESSION_SECRET` | 至少 32 位的随机字符串 |
| `APP_ORIGIN` | `http://localhost:3000` |
| `PORT` | `3000` |
| `LEDGER_INSTANCE_ID` | 开发环境独立标识，例如 `asset-dev` |
| `LEDGER_ID` | `main` |
| `MONGODB_DATABASE` | `asset` |
| `MONGODB_URI` | 开发 MongoDB 的 `asset_app` 连接串，使用 `/asset?authSource=asset` |

本地 Node 服务直接连接 `MONGODB_URI`。根目录 Compose 的 MongoDB 通过 Docker 内部网络提供服务，宿主机开发时需使用自己可访问的开发数据库地址。

```sh
npm run build
# 仅在首次创建空开发账本时执行
node --env-file=.env scripts/init-ledger.mjs --apply
npm run dev
```

打开 `http://localhost:3000`，输入 `APP_PASSWORD`。在“设置与汇率”保存汇率，再添加开发用资产。

## 修改与验证

修改前端 → `npm run build` → 刷新浏览器。修改服务端或 `.env` → 停止服务 → `npm run dev`。

修改 `lib/` 或 `shared/` 的财务计算 → `npm run build` → 重启 `npm run dev` → 刷新浏览器。

`npm run dev` 启动提供构建页面的 Node 服务。前端代码需要重新构建后生效。

在 `website/` 完成发布前检查。

```sh
npm run typecheck
npm run build
npm test
```

测试使用独立临时数据库。首次运行数据库测试时可能需要下载 MongoDB 测试程序。

## 提交与发布

在仓库根目录新建分支并提交修改。

```sh
git switch main
git pull --ff-only
git switch -c feature/your-change
git add website DEVELOPMENT.md
git commit -m "Describe the change"
git push -u origin feature/your-change
```

GitHub 创建 PR → 检查通过 → 合并 `main` → 等待 Actions 发布镜像。

PR 检查网页类型、构建和测试。合并后发布 `ghcr.io/cimorn/asset:latest` 和 `sha-完整提交号`，支持 amd64、arm64。

在部署主机的实际 Compose 目录更新应用。

```sh
docker compose pull asset
docker compose up -d --no-deps asset
```

更新后打开网页，核对账本可读取、页面正常。回退时把应用镜像改为已发布的 SHA 标签，再更新应用容器。

## 数据与备份

修改账本 → 保存／确认更新 → 服务端写入 MongoDB → 其他浏览器读取最新账本。未确认输入保存在当前浏览器。

- 当前账本在网页“设置与汇率”下载 JSON。
- 完整账本与历史在登录后访问同域名 `/api/ledger/backup` 下载。
- 部署配置备份实际使用的 `.env`、Compose 文件和数据库挂载路径。

恢复到独立的空账本目标时，在 `website/.env` 填好目标连接配置，安装依赖并构建，然后先检查再恢复。

```sh
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json --apply
```

## 保持目录干净

Git 保存源码、测试、依赖锁文件、说明文档、配置模板和部署文件。实际密码、数据库文件和备份存放在私人部署目录。

`website/node_modules/`、`website/dist/`、`website/server/runtime/` 为本地生成目录，清理后可通过 `npm ci`、`npm run build` 重建。

发布流程见仓库的 Actions 页面。日常使用、部署和备份入口见 [README](README.md)。
