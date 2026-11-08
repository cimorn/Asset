# AssetManager（资产罗盘）

[简体中文](README.md) | **English**

Track assets, transactions, exchange rates, and returns across currencies in a web app backed by your own MongoDB database. Deploy on any server, computer, or NAS that supports Linux Docker containers. Images support x64 and ARM64.

## Docker deployment

```sh
git clone https://github.com/cimorn/Asset.git
cd Asset
cp .env.example .env
```

Edit `.env`: set a login password in `APP_PASSWORD`, a random `SESSION_SECRET` of at least 32 characters, and a random hexadecimal database password in `MONGO_APP_PASSWORD`. Set `APP_ORIGIN` to your HTTPS URL. `APP_PORT` is the host port; `MONGODB_DATA_DIR` is the database storage directory.

```sh
docker compose up -d
docker compose exec asset node scripts/init-ledger.mjs --apply
```

Point an HTTPS reverse proxy to the host's `APP_PORT`, preserving the original Host header ---> Open `APP_ORIGIN` ---> Enter your password ---> Set exchange rates under “设置与汇率” (Settings & exchange rates), then add assets.

Run initialization only when creating a new ledger; it refuses to overwrite an existing one. Existing deployments must keep their database mounts, passwords, `SESSION_SECRET`, `LEDGER_INSTANCE_ID`, and `LEDGER_ID` when updating.

## Development

```text
website/             Web frontend and Node.js API
deploy/docker/       MongoDB initialization
.github/workflows/   Automated Docker image builds
docker-compose.yaml  Docker deployment
```

Use Node.js 22.13 or a newer compatible version.

```sh
cd website
npm ci
cp .env.example .env
# Set MONGODB_URI, APP_PASSWORD, SESSION_SECRET, and LEDGER_INSTANCE_ID.
# For local development, set APP_ORIGIN to http://localhost:3000.
npm run build
npm run dev
```

Connect to the MongoDB `asset` database with an `asset_app` account that has read/write access to that database only. Use a separate MongoDB instance for development.

In `website/`, run `npm run typecheck` to check types and `npm test` after building.

## Updates

Application: edit code ---> Commit and push to GitHub `main` ---> Wait for Actions to succeed ---> Pull the image and update the application on your Docker host.

```sh
docker compose pull asset
docker compose up -d --no-deps asset
```

Ledger content: open the web app ---> Edit assets, transactions, or exchange rates ---> Save or confirm the update. Unsaved input stays in the current browser. Confirm a successful save before switching devices.

To roll back the application, set its image to `ghcr.io/cimorn/asset:sha-FULL_COMMIT_HASH`, then update the application container.

## Backup and restore

- Current ledger: Settings & exchange rates ---> Download backup ---> Save the JSON file.
- Full ledger and history: sign in to the web app ---> Open `/api/ledger/backup` on the same domain ---> Save the JSON file.
- Configuration: back up `.env`, the Compose file in use, and the database mount configuration.

A full restore requires an empty target ledger. Install dependencies and build in `website/`, then put the target database configuration in a private `.env`. Preview the restore before applying it:

```sh
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json --apply
```

Use the full backup downloaded after signing in. The maintenance tool refuses to overwrite an existing ledger. Store configuration and backups privately, with at least one copy outside the deployment host. Preserve the database directory when updating images; do not run `docker compose down -v`.

Source code is licensed under [MIT](LICENSE). See [NOTICE](NOTICE) for third-party resources.
