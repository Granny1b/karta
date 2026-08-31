# Karta

A visual project management system for a solo-plus-a-few game project. An infinite canvas with
cards, images, arrows and nested boards, plus a kanban view over the same cards. It runs on
Azure for roughly the price of nothing.

Trello, Jira and Milanote each get part of this right and then charge for the rest or bury it.
The parts actually needed are a freeform canvas you can drop screenshots onto, arrows that mean
something, nested boards, checklists and status columns — and one place that is not €25 a
month. The whole thing is a canvas of cards plus a projection of those same cards into columns:
one data model, two views. Everything else is scope creep.

[`KARTA_SPEC.md`](KARTA_SPEC.md) is the source of truth. Where this README and the spec
disagree, the spec wins.

## Architecture

```
                        ┌───────────────────────────────────┐
   browser              │  Azure Static Web Apps (Free)     │
 ┌──────────┐           │                                   │
 │  React   │──── / ───▶│  static assets (Vite build)       │
 │  SPA     │           │                                   │
 │          │── /api ──▶│  managed Functions (Node 20)      │
 │          │           │   ├── boards CRUD (ETag guarded)  │
 │          │           │   ├── media SAS minting           │
 │          │           │   └── /.auth passthrough          │
 └────┬─────┘           └───────────────┬───────────────────┘
      │                                 │
      │  direct PUT/GET with            │  connection string
      │  short-lived SAS                │  (SWA app setting)
      │                                 ▼
      │                 ┌───────────────────────────────────┐
      └────────────────▶│  Storage account (Hot, LRS)       │
                        │   ├── boards/     board JSON      │
                        │   ├── media/      images + thumbs │
                        │   └── snapshots/  version history │
                        └───────────────────────────────────┘
```

Three moving parts. No database server, no compute that idles, no VNet, no Key Vault. A board
is one JSON blob that is always loaded whole and saved whole, guarded by an ETag; nested boards
are separate documents linked by id. Images never pass through the API — the browser uploads
them straight to blob storage with a short-lived SAS, which is what keeps everything inside the
free tier.

Repo layout:

| Path | Contents |
|---|---|
| `src/` | React SPA — `canvas/`, `kanban/`, `board/`, `card/`, `media/`, `state/`, `lib/` |
| `src/domain/board.ts` | the shared `BoardDoc` contract, imported by both halves |
| `api/` | SWA managed Functions — `functions/`, `stores/`, `domain/`, `auth/` |
| `infra/main.bicep` | every Azure resource that exists |
| `staticwebapp.config.json` | routing, the `member` role gate, auth providers |
| `.github/workflows/` | the only deployment path |

## Local development

```bash
npm install                 # frontend
npm run dev                 # http://localhost:5173

npm install --prefix api    # api
```

The API needs a storage connection string. Copy the example settings and fill them in:

```bash
cp api/local.settings.json.example api/local.settings.json
```

The defaults point at [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
(`UseDevelopmentStorage=true`), which is the easiest option — run `npx azurite --silent` and
create the `boards`, `media` and `snapshots` containers once. To develop against real storage
instead, paste that account's connection string and name into
`STORAGE_CONNECTION_STRING` / `STORAGE_ACCOUNT_NAME`. `api/local.settings.json` is not
committed.

Run the two halves together with the Static Web Apps CLI so `/api` and `/.auth` behave the way
they do in production:

```bash
npm run start --prefix api  # func start, port 7071
npx swa start http://localhost:5173 --api-location api
```

Useful checks before pushing:

```bash
npx tsc -p tsconfig.app.json --noEmit   # app typecheck
npm run typecheck --prefix api          # api typecheck
npm test                                # vitest
```

## Import and export

A board can be exported to a JSON file and imported back. The exported file is a `BoardDoc`
(the shape in `src/domain/board.ts`), so it round-trips through the same validation the API
applies to every save. Import also accepts a document authored elsewhere, which is the
supported way to have an AI draft a whole board and drop it in. The document shape, the
constraints it must satisfy and a prompt that produces a valid one are in
[`docs/AI_IMPORT.md`](docs/AI_IMPORT.md).

## Deploying

GitHub Actions is the only deployment path. `.github/workflows/azure-static-web-apps.yml`
installs both halves, typechecks both, builds the SPA and uploads it with
`Azure/static-web-apps-deploy@v1`; pull requests get a preview environment that is torn down
when the PR closes. The single secret it needs is `AZURE_STATIC_WEB_APPS_API_TOKEN`.

Infrastructure is `infra/main.bicep`, deployed by hand into `rg-karta-prod`
(Sweden Central). First-time setup — resource group, deployment, deployment token, the `member`
role invitation — is in [`docs/DEPLOY.md`](docs/DEPLOY.md).

Access is SWA built-in authentication. Signing in with any Microsoft account is not enough; the
gate is the custom role `member`, handed out by invitation in the portal (25 of them on the
free tier). Anyone signed in without it lands on `no-access.html`.

## Cost model

Nothing in this architecture bills per hour of existence. Every resource is either free-tier or
metered purely on stored bytes.

| Resource | SKU | Billing basis | Expected |
|---|---|---|---|
| Static Web App | **Free** | nothing | €0.00 |
| Managed Functions (inside SWA) | included | 1M executions free | €0.00 |
| Storage account | StorageV2, Standard_LRS, Hot | GB stored + transactions | €0.02–0.15 |
| Outbound data transfer | — | first 100 GB/month free | €0.00 |
| Log Analytics | *not deployed* | — | €0.00 |
| **Total** | | | **well under €0.25/month** |

Two traps the design avoids on purpose:

1. **Board JSON never goes on Cool/Cold/Archive.** From 1 July 2026 those tiers bill a minimum
   128 KiB per object on new storage accounts, so a 20 KB board would be billed as 128 KB.
   Everything stays Hot and there is no lifecycle policy.
2. **No Log Analytics or Application Insights.** It is the resource most likely to quietly
   become the largest line on the bill. Use the SWA function logs and the browser console. If
   real telemetry is ever needed, add App Insights with a hard 0.1 GB daily cap and revisit.

A resource-group budget of 100 SEK/month with alerts at 50/80/100 percent exists as a tripwire:
if this resource group ever bills more than a few kronor, something is wrong by definition.

## Operational rules

- The GitHub Actions workflow is the only deployment path. No portal edits to the SWA.
- `infra/main.bicep` is the only definition of the resources. If it is not in the file, it does
  not exist.
- Storage soft delete is 14 days and stays on.
- Before any schema change: bump `schemaVersion`, write a forward migration in
  `api/src/domain/migrate.ts`, and run it lazily on read. Never migrate in bulk.
- Check the resource group's cost once a month. It should read as a rounding error. If it does
  not, something was added that bills per hour.
- The repo must not live inside a OneDrive-synced folder.
