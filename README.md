# 资产罗盘 · 网页版

此目录可独立上传 GitHub，部署为 Render 免费 Node Web Service。沿用桌面版界面和财务计算，连接同一个飞书「财务管理」多维表格。

## 数据如何保存

- 飞书是正式账本，流水是资产、账户和收益的计算依据。网站登录后读取飞书，打开期间约每 30 秒检查一次更新。
- 更新资产、流水或汇率时，先写入当前浏览器的 IndexedDB 缓存。点击“上传”后才写入飞书。汇率输入框中尚未点击保存的完整输入，也会在上传时一并保存。
- 关闭网页、Render 休眠或重启后，同一浏览器的草稿仍可恢复。换电脑、换浏览器或无痕窗口只能读取已上传的飞书数据。清除本站浏览器数据会删除未上传草稿；需要保留时先上传，或在设置中下载完整备份。
- 上传中断后保留浏览器恢复记录，再点击“上传”可继续。上传尚未完成时先续传，再编辑新内容。不要随意重置 `SESSION_SECRET`，否则已有恢复记录不能通过验证。
- 用户名和密码保护账本页面与数据接口。飞书 App Secret 只在服务端使用，浏览器不接收它，也不需要选择 `.env`。

## 上传 GitHub

推荐将 **website 文件夹里面的内容** 放在一个独立仓库根目录，其中包含 `package.json`、`package-lock.json`、`render.yaml`、`server`、`src`、`components`、`lib`、`shared`、`hooks`、`app`（这里只含样式）和 `public`。

`.gitignore` 已排除 `.env`、`node_modules`、`dist`、`server/runtime` 和 `.data`。不要上传桌面版 `../app`，不要把个人 `.env` 或账本数据放进仓库。`.env.example` 是空白配置模板，可以上传。

## Render 免费部署

1. 将上述代码上传到私有仓库 [AssetManager](https://github.com/cimorn/AssetManager)，让 `render.yaml` 位于仓库根目录。
2. 在 Render 新建 **Blueprint** 并选择仓库；配置文件路径为 `render.yaml`。它声明一个免费 Web Service，没有付费磁盘。
3. 填写提示的飞书环境变量并部署。`APP_PASSWORD` 和 `SESSION_SECRET` 由 Render 自动生成；以后同步配置会保留已有值。部署后在服务的 Environment 页面查看 `APP_PASSWORD`，用它登录网页。
4. 飞书配置从桌面版 `../app/.env` 中对应项复制到 Render 的 Environment 页面：

   | 变量 | 填写内容 |
   | --- | --- |
   | `FEISHU_APP_ID` | 原有资产罗盘飞书应用 ID |
   | `FEISHU_APP_SECRET` | 原应用密钥，仅填在 Render 环境变量中 |
   | `FEISHU_WIKI_ROOT_TOKEN` | 原知识库根节点 |
   | `FEISHU_DRIVE_ROOT_TOKEN` | 原云空间根目录 |
   | `FEISHU_WEB_BASE_URL` | 原飞书租户网址 |
   | `FEISHU_TABLE_URL` | 现有「财务管理」多维表格的知识库链接 |

5. 部署完成后访问 Render 给出的 HTTPS 地址，使用 `APP_USERNAME`（默认 `admin`）和 `APP_PASSWORD` 登录。首次读取可能需要等待飞书响应。

也可以新建普通 **Web Service**：Runtime 选 Node，Instance Type 选 Free，Build Command 填 `npm ci --include=dev && npm run typecheck && npm run build`，Start Command 填 `npm start`，Health Check Path 填 `/healthz`。手动部署时额外设置 `NODE_ENV=production`、`NODE_VERSION=22.22.0`、`APP_USERNAME=admin`、至少 12 位的 `APP_PASSWORD` 和至少 32 位随机 `SESSION_SECRET`。只有通过 Blueprint 创建时，YAML 中的自动生成设置才会生效。

如果上传的是同时包含桌面版 `app` 和 `website` 的整个项目，普通 Web Service 的 Root Directory 填 `website`；使用 Blueprint 时配置路径改为 `website/render.yaml`，并在该服务声明中加入 `rootDir: website`。

Render 自动提供 `RENDER_EXTERNAL_URL` 和 `PORT`。使用自定义域名时，将 `APP_ORIGIN` 设置为实际访问的 HTTPS 根地址，不带路径，例如 `https://assets.example.com`。服务只接受该域名的页面请求。

免费服务会休眠，休眠后首次打开可能较慢。服务端临时文件不作为正式账本或草稿存储。配置完成前，健康检查正常并不表示已成功连接飞书；以登录后页面的读取结果为准。

参考：[Render Web Services](https://render.com/docs/web-services)、[免费服务](https://render.com/docs/free)、[Blueprint 配置](https://render.com/docs/blueprint-spec)。

## 本地开发和验证

使用 Node 22.22.0 或更新兼容版本。在本目录执行：

```powershell
npm ci --include=dev
Copy-Item .env.example .env
# 在本机编辑 .env，填入登录配置和原飞书配置
npm run typecheck
npm run build
npm start
```

浏览器访问 `http://localhost:3000`。本地保持 `NODE_ENV` 未设置，不需要 `APP_ORIGIN`。修改代码后重新构建，再重启服务。应用不创建第二套示例账本。

源代码职责：`src/cache.ts` 管理浏览器草稿，`server/server.mjs` 提供登录及飞书接口，`server/feishu*.mjs` 对接原有飞书账本，`lib` 保留原有流水、分类、剩余和历史汇率计算。
