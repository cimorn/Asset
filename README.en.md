# AssetManager（资产罗盘）

[简体中文](README.md) | **English**

Track assets, transactions, exchange rates, and returns across currencies. Use the web app or Windows desktop client with your own MongoDB database. Deploy on any server, computer, or NAS that supports Linux Docker containers. Images support x64 and ARM64.

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

Point an HTTPS reverse proxy to the host's `APP_PORT`, preserving the original Host header ---> Open `APP_ORIGIN` ---> Enter your password ---> Set exchange rates under “设置与汇率” (Settings & exchange rates), then add assets. Both clients read the same ledger after you save or confirm an update.

Run initialization only when creating a new ledger; it refuses to overwrite an existing one. Existing deployments must keep their database mounts, passwords, `SESSION_SECRET`, `LEDGER_INSTANCE_ID`, and `LEDGER_ID` when updating.

## Desktop client

Build the Windows executable at `app/dist/资产罗盘.exe`. On first launch, select your personal `nas.env` file:

```dotenv
NAS_URL=https://asset.example.com
NAS_PASSWORD=your-login-password
```

`NAS_URL` is a retained configuration name. It can point to the web service on any Docker host. The client stores the imported configuration at `%APPDATA%/FinanceAtlas/nas.env`.

Open the client ---> Read the server ledger ---> Edit ---> Save or confirm the update. To switch computers, copy the EXE and your configuration file, then select that file on first launch.

## Development

```text
app/                 Windows desktop client: Electron + Vite
website/             Web frontend and Node.js API
deploy/docker/       MongoDB initialization
.github/workflows/   Automated Docker image builds
docker-compose.yaml  Docker deployment
```

Use Node.js 22.13 or a newer compatible version. Install dependencies for each client separately and edit its own directory.

Web app:

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

Desktop client:

```sh
cd app
npm ci
npm --prefix desktop ci
npm run build
npm start
npm run package
```

For development, place your personal `nas.env` in `app/`. Packaging writes to `app/dist`; configuration and ledger data are not embedded in the EXE.

Validation: run `npm run typecheck` and `npm test` in the relevant directory. Desktop regression tests require both projects' dependencies and builds.

## Updates

Application: edit code ---> Commit and push to GitHub `main` ---> Wait for Actions to succeed ---> Pull the image and update the application on your Docker host.

```sh
docker compose pull asset
docker compose up -d --no-deps asset
```

Desktop: run `npm run package` again ---> Replace the old EXE ---> Open it and read the latest ledger.

Ledger content: open either client ---> Edit assets, transactions, or exchange rates ---> Save or confirm the update. Unsaved input stays on the current device; confirm a successful save before switching devices.

To roll back the application, set its image to `ghcr.io/cimorn/assetmanager:sha-FULL_COMMIT_HASH`, then update the application container.

## Backup and restore

- Current ledger: Settings & exchange rates ---> Download backup ---> Save the JSON file.
- Full ledger and history: sign in to the web app ---> Open `/api/ledger/backup` on the same domain ---> Save the JSON file.
- Configuration: back up `.env`, the Compose file in use, and the database mount configuration. Also back up your desktop `nas.env`.

A full restore requires an empty target ledger. Install dependencies and build in `website/`, then put the target database configuration in a private `.env`. Preview the restore before applying it:

```sh
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json
node --env-file=.env scripts/mongo-maintenance.mjs restore --input /private/asset-backup.json --apply
```

Use the full backup downloaded after signing in. The maintenance tool refuses to overwrite an existing ledger. Store configuration and backups privately, with at least one copy outside the deployment host. Preserve the database directory when updating images; do not run `docker compose down -v`.

Source code is licensed under [MIT](LICENSE). See [NOTICE](NOTICE) for third-party resources.
