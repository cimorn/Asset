# 网页端

React 前端、Node.js API 和 MongoDB 账本服务。

Docker 部署、开发、更新和备份见[项目说明](../README.md)。

前端入口 `src/main.tsx`，服务入口 `server/index.mjs`，数据库逻辑 `server/mongo-ledger.mjs`，财务计算 `lib/finance.ts`。`Dockerfile` 以本目录为构建上下文。
