# 桌面端

Windows 桌面程序，通过 HTTPS 连接网页服务，与网页共用账本。

开发、打包、更新和数据备份见[项目说明](../README.md)。

前端入口 `desktop/web.tsx`，Electron 入口 `desktop/main.cjs`，本地 API `desktop/server.mjs`，服务端连接 `desktop/nas-service.mjs`。财务计算位于 `lib/finance.ts`。
