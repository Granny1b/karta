# Karta — project spec

A visual project management system for a solo-plus-a-few game project. Infinite canvas with
cards, images, arrows and nested boards, plus a kanban view over the same cards. Runs on Azure
for roughly the price of nothing.

*Working name: **Karta** (Swedish for map). Rename freely — it appears only in the resource
names and the page title.*

- **Status:** draft v1, ready to build
- **Owner:** Sam
- **First consumer:** the MMORPG project (Unity + MMORPG KIT)
- **Repo:** `karta` — must not live inside a OneDrive-synced folder

---

## 1. Why this exists

Trello, Jira and Milanote each get part of this right and then charge for the rest or bury it.
The parts actually needed:

| Wanted | From |
|---|---|
| Infinite freeform canvas, drop screenshots anywhere | Milanote |
| Arrows between things, nested boards | Milanote |
| Checklists on cards, status columns | Trello |
| One place that is not €25/month | — |

The whole thing is a canvas of cards plus a projection of those same cards into columns. One
data model, two views. Everything else is scope creep and lives in section 12.

### Goals

1. Open a board, see the shape of the project in one screen, zoom into detail.
2. Paste a screenshot from Unity and have it land on the canvas in under a second.
3. Draw an arrow from "Spell system" to "Cooldown UI" and have it mean something.
4. Switch to columns when the question is "what am I doing this week" rather than "how does
   this fit together".
5. Total Azure spend that never needs to be thought about again.

### Non-goals

- Not a Jira replacement. No sprints, no burndown, no time tracking, no workflow engine.
- No mobile app. Responsive enough to read on a phone; editing is desktop.
- No real-time cursors in v1. Multi-user means "does not silently lose work", not "Figma".
- No comments/mentions/notifications in v1.
- No import from anything.

---

## 2. Cost model

The rule from the Postgres incident: nothing in this architecture may bill per hour of
existence. Every resource is either free-tier or metered purely on stored bytes.

### Resources and what they cost

| Resource | SKU | Billing basis | Expected |
|---|---|---|---|
| Static Web App | **Free** | nothing | €0.00 |
| Managed Functions (inside SWA) | included | 1M executions free | €0.00 |
| Storage account | StorageV2, Standard_LRS, Hot | GB stored + transactions | €0.02–0.15 |
| Outbound data transfer | — | first 100 GB/month free | €0.00 |
| Log Analytics | *not deployed* | — | €0.00 |
| **Total** | | | **well under €0.25/month** |

Blob Hot LRS runs about $0.018–0.021 per GB-month. Screenshots downscaled and re-encoded to
WebP (section 7) average ~200 KB, so 2 GB of stored media is around 2,000 screenshots and about
€0.04/month. Transactions are billed per 10,000 operations and will not be a measurable line
item at one user hitting save every few seconds.

### Free tier limits that shape the design

| Limit | Value | Consequence |
|---|---|---|
| SWA bandwidth | 100 GB/month | irrelevant at this scale |
| SWA app size | 250 MB | build output only; media is in blob |
| SWA request size | 30 MB | **images never pass through the API** — direct-to-blob SAS upload |
| Custom roles by invitation | 25 users | the access model for "a couple of collaborators" |
| Managed Functions triggers | HTTP only | no cron, no Durable — no background jobs in the design |
| Free tier SLA | none | it is a personal board; accept it |

### Two cost traps to avoid

1. **Do not put board JSON on the Cool tier.** From 1 July 2026, new storage accounts bill a
   minimum 128 KiB per object on Cool/Cold/Archive. A 20 KB board document would be billed as
   128 KB. Everything stays on Hot. There is no lifecycle policy in this design.
2. **Do not add Log Analytics or Application Insights "just to see what's happening".** That is
   the resource most likely to quietly become the largest line on the bill. Use the SWA's
   built-in function logs and browser console. If real telemetry is ever needed, add App
   Insights with a hard daily cap of 0.1 GB and revisit.

---

## 3. Architecture

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

Three moving parts. No database server, no compute that idles, no VNet, no Key Vault.

**Why blob JSON and not Cosmos serverless:** a board is a single coherent document that is
always loaded whole and saved whole. That is exactly a blob. Cosmos serverless would cost a few
cents in RUs and add a partitioning decision that buys nothing at this size. The seam in
section 6.5 makes the swap a one-file change if a board ever outgrows the document model.

---

## 4. Azure resources

Region: **Sweden Central** (`swedencentral`). Everything in one resource group,
`rg-karta-prod`, so a single budget and a single delete cover it.

### 4.1 Storage account

- Name: `stkarta<suffix>` (globally unique, lowercase, no dashes)
- Kind `StorageV2`, `Standard_LRS`, access tier `Hot`
- `allowBlobPublicAccess: false` — every read goes through a SAS
- `minimumTlsVersion: TLS1_2`, `supportsHttpsTrafficOnly: true`
- Soft delete for blobs: **enabled, 14 days** (this is the undo of last resort; costs
  fractions of a cent at this volume)
- Versioning: off (snapshots container handles history explicitly, more predictably)

Containers, all private:

| Container | Contents | Naming |
|---|---|---|
| `boards` | one JSON document per board, plus `_index.json` | `{boardId}.json` |
| `media` | uploaded images and their thumbnails | `{boardId}/{mediaId}.webp`, `{boardId}/{mediaId}.thumb.webp` |
| `snapshots` | periodic full-board copies | `{boardId}/{iso8601}.json` |

### 4.2 CORS

Required, because the browser talks to blob storage directly for media.

- Allowed origins: the SWA production hostname and `http://localhost:5173`
- Allowed methods: `GET, PUT, HEAD, OPTIONS`
- Allowed headers: `x-ms-blob-type, x-ms-blob-content-type, content-type, cache-control`
- Exposed headers: `etag`
- Max age: 3600

### 4.3 Bicep skeleton

```bicep
param location string = 'swedencentral'
param appName string = 'karta'
param repositoryUrl string
param branch string = 'main'

var storageName = toLower('st${appName}${uniqueString(resourceGroup().id)}')

resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: sa
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    cors: {
      corsRules: [
        {
          allowedOrigins: [ 'https://${swa.properties.defaultHostname}', 'http://localhost:5173' ]
          allowedMethods: [ 'GET', 'PUT', 'HEAD', 'OPTIONS' ]
          allowedHeaders: [ 'x-ms-blob-type', 'x-ms-blob-content-type', 'content-type', 'cache-control' ]
          exposedHeaders: [ 'etag' ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [
  for name in [ 'boards', 'media', 'snapshots' ]: {
    parent: blobSvc
    name: name
    properties: { publicAccess: 'None' }
  }
]

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-${appName}'
  location: location
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    repositoryUrl: repositoryUrl
    branch: branch
    buildProperties: {
      appLocation: '/'
      apiLocation: 'api'
      outputLocation: 'dist'
    }
  }
}

resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${sa.name};AccountKey=${sa.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
    STORAGE_ACCOUNT_NAME: sa.name
    BOARDS_CONTAINER: 'boards'
    MEDIA_CONTAINER: 'media'
  }
}
```

The storage key sits in a SWA app setting rather than Key Vault. SWA managed functions cannot
use managed identity for anything except pulling secrets from Key Vault, and Key Vault adds a
resource, a reference syntax and a failure mode for a single-tenant hobby board. Rotate the key
manually if it ever leaks.

### 4.4 Budget

A resource-group-scoped budget of **100 SEK/month** with alerts at 50%, 80% and 100%. This sits
inside the existing 1000 SEK subscription budget and exists purely as a tripwire: if this
resource group ever bills more than a few kronor, something is wrong by definition.

---

## 5. Data model

One board is one JSON document. Nested boards are separate documents linked by id, so opening a
board never drags its children's contents into memory.

### 5.1 Board document

```ts
type Id = string;          // ULID — sortable, 26 chars
type Iso = string;         // ISO 8601 UTC

interface BoardDoc {
  schemaVersion: 1;
  id: Id;
  parentBoardId: Id | null;
  title: string;
  icon: string | null;             // single emoji or lucide icon name
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;           // soft delete
  acl: Acl;
  viewport: Viewport;              // last saved camera, per board
  statuses: StatusDef[];           // the kanban columns for this board
  labels: LabelDef[];
  nodes: BoardNode[];
  edges: Edge[];
}

interface Viewport { x: number; y: number; zoom: number }

interface Acl {
  ownerId: string;                 // SWA userId claim
  editorIds: string[];
  viewerIds: string[];
}

interface StatusDef {
  id: Id;
  name: string;                    // "Idé", "Bygger", "Testar", "Klar"
  color: ColorToken;
  order: number;
  isDone: boolean;                 // drives the progress rollup
}

interface LabelDef { id: Id; name: string; color: ColorToken }
```

### 5.2 Nodes

A discriminated union on `kind`. Every node carries the geometry and audit fields; the rest is
per-kind.

```ts
interface NodeBase {
  id: Id;
  kind: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  z: number;                       // paint order within the board
  color: ColorToken | HexColor | null;
  createdAt: Iso;
  updatedAt: Iso;                  // per-node, for merge — see 6.4
  updatedBy: string;
  locked: boolean;
}

type BoardNode = CardNode | ImageNode | NoteNode | BoardLinkNode | GroupNode;
```

**`CardNode`** — the workhorse. Appears on the canvas and in the kanban view.

```ts
interface CardNode extends NodeBase {
  kind: 'card';
  title: string;
  body: string;                    // markdown
  checklist: ChecklistItem[];
  statusId: Id | null;             // null = "No status" column
  rank: string;                    // fractional index, ordering within its column
  labelIds: Id[];
  coverMediaId: Id | null;
  dueDate: Iso | null;             // display only; no notifications
  collapsed: boolean;              // title-only rendering
}

interface ChecklistItem { id: Id; text: string; done: boolean; rank: string }
```

**`ImageNode`** — a screenshot on the canvas.

```ts
interface ImageNode extends NodeBase {
  kind: 'image';
  mediaId: Id;
  naturalSize: { w: number; h: number };
  caption: string | null;
  fit: 'contain' | 'cover';
}
```

**`NoteNode`** — a sticky. Text and a colour, nothing else.

```ts
interface NoteNode extends NodeBase { kind: 'note'; text: string }
```

**`BoardLinkNode`** — the doorway to a nested board. Renders a live rollup of the child's card
counts, so a parent board reads as a dashboard without loading the children.

```ts
interface BoardLinkNode extends NodeBase {
  kind: 'boardLink';
  targetBoardId: Id;
  cachedTitle: string;
  cachedCounts: { total: number; done: number } | null;   // refreshed from _index.json
}
```

**`GroupNode`** — a labelled frame. Nodes whose centre is inside a group move with it.

```ts
interface GroupNode extends NodeBase { kind: 'group'; title: string; padding: number }
```

### 5.3 Edges

Arrows carry meaning, not decoration. The semantic type picks the default colour and dash
pattern, so a board reads correctly at a glance without anyone styling anything.

```ts
interface Edge {
  id: Id;
  source: Id; sourceHandle: Handle;
  target: Id; targetHandle: Handle;
  semantic: 'relates' | 'depends' | 'blocks' | 'derives';
  label: string | null;
  routing: 'bezier' | 'smoothstep' | 'straight';
  color: ColorToken | HexColor | null;   // overrides the semantic default
  updatedAt: Iso;
}

type Handle = 'top' | 'right' | 'bottom' | 'left';
```

| Semantic | Default look | Reads as |
|---|---|---|
| `relates` | thin grey, no arrowhead | these belong together |
| `depends` | solid, arrowhead at target | target needs source first |
| `blocks` | dashed red, arrowhead | source is stopping target |
| `derives` | solid blue, open arrowhead | target came out of source |

### 5.4 Board index

`boards/_index.json` is a single small document maintained by the API on every board write. It
exists so the sidebar tree and the `boardLink` rollups cost one blob read instead of N.

```ts
interface BoardIndex {
  schemaVersion: 1;
  updatedAt: Iso;
  boards: BoardSummary[];
}

interface BoardSummary {
  id: Id; parentBoardId: Id | null; title: string; icon: string | null;
  updatedAt: Iso; deletedAt: Iso | null;
  counts: { cards: number; done: number; children: number };
  ownerId: string;
}
```

### 5.5 Media

Media metadata lives in the board doc that references it. No separate media table.

```ts
interface MediaRef {
  id: Id;
  blobPath: string;                // media/{boardId}/{mediaId}.webp
  thumbPath: string;
  contentType: 'image/webp' | 'image/png' | 'image/jpeg';
  bytes: number;
  width: number; height: number;
  uploadedAt: Iso;
  uploadedBy: string;
}
```

`BoardDoc` gains a `media: MediaRef[]` array. Deleting an image node marks the ref orphaned;
the orphan is deleted from blob storage on the next board save (client sends the orphan list,
API deletes those blobs after the doc write succeeds).

### 5.6 Size budget

A board document is expected to be 10–80 KB. Hard guidance:

- **Warn at 300 nodes or 400 KB.** Suggest splitting into a nested board.
- **Hard-stop at 1 MB.** Refuse the write with a message that says exactly what to do.

If boards routinely hit that ceiling, the model is wrong for the use case and section 6.5 is
the exit.

---

## 6. API

Managed Functions, Node 20, TypeScript, HTTP triggers only. All routes behind the `member` role.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/boards` | the index document |
| `POST` | `/api/boards` | create; body `{ title, parentBoardId? }` |
| `GET` | `/api/boards/{id}` | full document; returns `ETag` |
| `PUT` | `/api/boards/{id}` | full replace; requires `If-Match` |
| `DELETE` | `/api/boards/{id}` | soft delete (sets `deletedAt`) |
| `POST` | `/api/boards/{id}/snapshot` | copy current doc into `snapshots/` |
| `GET` | `/api/boards/{id}/snapshots` | list restore points |
| `POST` | `/api/boards/{id}/restore` | body `{ snapshotName }` |
| `POST` | `/api/media/upload-url` | mint a write SAS |
| `POST` | `/api/media/commit` | confirm upload, return the `MediaRef` |
| `GET` | `/api/media/read-token` | mint a container-scoped read SAS |
| `GET` | `/api/me` | identity + role, from `x-ms-client-principal` |

### 6.1 Save protocol

1. Client mutates local state; the change is written to IndexedDB immediately.
2. Autosave fires on 1.5 s idle, or 10 s since the last successful save, whichever comes first.
3. `PUT /api/boards/{id}` with `If-Match: <etag held since load>`.
4. `200` → store the new ETag, clear the dirty flag, drop the IndexedDB write-ahead entry.
5. `412 Precondition Failed` → conflict path, section 6.4.

A save is never triggered by camera movement alone. Viewport is persisted on a 5 s debounce and
is exempt from conflict handling — last one wins, nobody cares.

### 6.2 Media upload

```
POST /api/media/upload-url
  { boardId, contentType, bytes }
  → validates: contentType in [image/webp, image/png, image/jpeg], bytes <= 10_485_760
  → { mediaId, blobPath, thumbPath, uploadUrl, thumbUploadUrl }   // SAS, 'cw', 5 min TTL

PUT <uploadUrl>          (browser → blob, direct)
  x-ms-blob-type: BlockBlob
  x-ms-blob-content-type: image/webp
  cache-control: public, max-age=31536000, immutable

POST /api/media/commit
  { boardId, mediaId, width, height, bytes }
  → HEADs the blob to confirm it exists and matches the declared size
  → { mediaRef }
```

Uploading straight to blob is what keeps this inside the free tier: the 30 MB SWA request limit
never applies, the Function does no I/O of the payload, and there is no server-side image
library to maintain.

### 6.3 Media read

`GET /api/media/read-token` returns a container-scoped read SAS with a 60-minute TTL, cached in
memory by the client and refreshed at the 50-minute mark. Image `src` becomes
`{blobUrl}{sasQuery}`. Because blob names are content-addressed and immutable, the browser
caches them for a year and repeat views cost nothing.

### 6.4 Concurrency

**Phase 1–3 (single writer in practice):** ETag guard only. A `412` shows a blocking dialog —
"This board changed somewhere else" — with *Reload* and *Save a copy*. Crude, correct, zero
work.

**Phase 5 (collaborators):** three-way merge at node granularity, using the per-node
`updatedAt`.

On `412`:
1. `GET` the current server document.
2. Diff it against the base snapshot held from load.
3. Merge into the local document:
   - node present only locally → keep (add)
   - node present only on server → take (add)
   - node in both → take whichever has the later `updatedAt`, whole node
   - node deleted on one side, edited on the other → keep the edit, surface a toast
   - edges → same rule; drop any edge whose endpoints no longer exist
   - `statuses` and `labels` → union by id, later `updatedAt` wins on conflict
4. `PUT` with the fresh ETag. Retry at most 3 times, then fall back to the dialog.

Whole-node last-writer-wins is deliberately coarse. Two people editing the same card's text
within the same second is a scenario worth losing to keep the merge readable.

**Polling:** while a board is open, `GET` its index entry every 20 s. If `updatedAt` moved and
the local doc is clean, reload silently. If dirty, show a passive "newer version available"
chip. No websockets. If live presence ever matters, Azure SignalR has a free tier of 20
concurrent connections and 20k messages/day, which is more than enough — but it is a fourth
resource and a whole reconnection story, so it stays out until it is genuinely wanted.

### 6.5 The migration seam

Same pattern as `ITaskRepository` in TaskHub: the Functions depend on interfaces, not blobs.

```ts
export interface BoardStore {
  getIndex(): Promise<BoardIndex>;
  get(id: Id): Promise<{ doc: BoardDoc; etag: string } | null>;
  put(id: Id, doc: BoardDoc, ifMatch: string | null): Promise<{ etag: string }>;
  delete(id: Id): Promise<void>;
  snapshot(id: Id): Promise<string>;
  listSnapshots(id: Id): Promise<SnapshotRef[]>;
}

export interface MediaStore {
  mintUploadSas(boardId: Id, mediaId: Id, contentType: string): Promise<UploadTarget>;
  mintReadSas(): Promise<string>;
  head(path: string): Promise<{ bytes: number } | null>;
  delete(paths: string[]): Promise<void>;
}
```

`BlobBoardStore` ships. `CosmosBoardStore` is written only if the size budget in 5.6 is
breached in practice. Nothing in the frontend or the HTTP contract changes when it is.

### 6.6 Auth

SWA built-in authentication. No auth code is written.

- Providers: Microsoft Entra ID and GitHub. All others blocked in config.
- The preconfigured Entra provider lets **any** Microsoft account sign in, so `authenticated`
  is not a gate. The gate is a custom role.
- Every route requires the custom role `member`, assigned by portal invitation. 25 invited
  users is the free-tier cap and the project needs three.
- The API reads `x-ms-client-principal` (base64 JSON) for `userId` and `userRoles`. Board-level
  `acl` is enforced in the API on top of the role: `member` gets in the door, the ACL decides
  which boards.

```json
{
  "routes": [
    { "route": "/api/*", "allowedRoles": ["member"] },
    { "route": "/login", "rewrite": "/.auth/login/aad", "allowedRoles": ["anonymous"] },
    { "route": "/logout", "redirect": "/.auth/logout" },
    { "route": "/*", "allowedRoles": ["member"] }
  ],
  "responseOverrides": {
    "401": { "statusCode": 302, "redirect": "/login" },
    "403": { "rewrite": "/no-access.html" }
  },
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": { "registration": { "openIdIssuer": "https://login.microsoftonline.com/common/v2.0" } }
    }
  },
  "navigationFallback": { "rewrite": "/index.html", "exclude": ["/assets/*"] }
}
```

---

## 7. Frontend

### 7.1 Stack

| Concern | Choice | Note |
|---|---|---|
| Build | Vite + React 18 + TypeScript | |
| Canvas | `@xyflow/react` v12 (React Flow) | MIT core; pan, zoom, nodes, typed edges, handles |
| State | Zustand + Immer | sliced stores, no context tree |
| Undo | command stack over the board doc | ~200 entries, in memory only |
| Styling | Tailwind + CSS variables for tokens | tokens in `:root`, section 8 |
| Markdown | `react-markdown` + `remark-gfm` | render only; edit is a plain textarea |
| Icons | `lucide-react` | |
| Ordering | `fractional-indexing` | same approach as Atlas/Klart |
| Ids | `ulid` | |
| Local cache | `idb-keyval` | write-ahead log, section 7.5 |

Everything above is MIT or Apache-2. **tldraw is deliberately not used** — its licence puts a
watermark on free use and its model is a drawing surface, not a graph of typed nodes.

### 7.2 Repo layout

```
karta/
├─ api/                          # SWA managed functions
│  ├─ src/
│  │  ├─ functions/              # one file per HTTP route
│  │  ├─ stores/                 # BlobBoardStore, BlobMediaStore
│  │  ├─ domain/                 # BoardDoc types, validation, index maintenance
│  │  └─ auth/                   # principal parsing, ACL checks
│  └─ package.json
├─ src/
│  ├─ canvas/                    # React Flow wiring, node components, edge components
│  ├─ kanban/                    # column view over the same store
│  ├─ board/                     # board shell, breadcrumb, sidebar tree
│  ├─ card/                      # card editor panel, checklist, markdown
│  ├─ media/                     # paste handling, downscale, upload
│  ├─ state/                     # zustand slices
│  ├─ lib/                       # api client, ulid, ranks, colors
│  └─ styles/tokens.css
├─ infra/main.bicep
├─ staticwebapp.config.json
└─ .github/workflows/azure-static-web-apps.yml
```

`src/domain/board.ts` types are shared with the API via a path alias rather than a package. One
source of truth for `BoardDoc`.

### 7.3 Canvas

React Flow does the heavy lifting. What is configured:

- `minZoom: 0.1`, `maxZoom: 2.5`, `zoomOnScroll` with ctrl/cmd, trackpad pinch, `Space` + drag
  to pan, `onlyRenderVisibleElements: true`.
- Background: dot grid, 24 px, that fades out below zoom 0.4.
- Snapping: 8 px grid, held off while `Alt` is down.
- Selection: click, shift-click to add, drag-marquee on empty canvas, `Ctrl+A`.
- Multi-select drag moves everything selected; arrow keys nudge 8 px, `Shift` + arrows 1 px.

**Levels of detail** — this is what keeps a 300-node board smooth:

| Zoom | Card renders as |
|---|---|
| ≥ 0.8 | full: title, body preview, checklist progress, labels, cover image |
| 0.4–0.8 | title, progress ring, colour bar; images swap to thumbnails |
| 0.25–0.4 | title only, single line, truncated |
| < 0.25 | filled rounded rectangle in the card colour, no text |

**Drawing arrows:** each card exposes four handles that appear on hover. Drag from a handle to
any other node to create an edge. Drop on empty canvas to get a small menu — *New card here*,
*New note here*, *Cancel* — so the arrow gesture is also the fastest way to create the next
card. Default semantic is `relates`; changing it is a click on the edge.

**Nested boards:** double-clicking a `boardLink` node navigates into that board. The header
carries a breadcrumb built from `parentBoardId` in the index. Any selection of nodes can be
turned into a child board with *Extract to board* — the nodes move out, a `boardLink` takes
their place at the centroid of the old bounding box, and edges that crossed the boundary
reattach to the link node.

**Images:** paste (`Ctrl+V`) anywhere on the canvas, or drag files in from Explorer. Both land
at the cursor. Before upload the client:

1. draws to a canvas, downscales so the long edge is ≤ 2560 px,
2. re-encodes to WebP at quality 0.82,
3. produces a 480 px thumbnail the same way,
4. uploads both with the SAS flow in 6.2.

A 2 MB Unity screenshot typically lands under 250 KB. No server-side processing exists.

### 7.4 Kanban view

The same board, projected. `Tab` toggles canvas ↔ columns; the toggle is per-board and
remembered locally.

- Columns come from `statuses`, in `order`, plus a leading "No status" column.
- Only `card` nodes appear. Notes, images, groups and board links are canvas-only.
- Optional toggle: *Include nested boards*, which walks children one level deep and prefixes
  each card with its board name.
- Dragging between columns sets `statusId`; dragging within a column sets `rank`. Canvas
  positions are never touched by the kanban view, and vice versa.
- Filter bar: text, label, status, has-due-date, has-unfinished-checklist. The same filter
  applies on the canvas as a dimming overlay rather than by hiding nodes, so the layout never
  jumps.

Default statuses on a new board: **Idé → Planerad → Bygger → Testar → Klar**, with `Klar`
flagged `isDone`. Editable per board.

### 7.5 Never lose work

1. Every mutation writes the whole board doc to IndexedDB under `wal:{boardId}` before the
   network is touched.
2. On load, if a WAL entry exists whose `updatedAt` is newer than the server's, the app offers
   *Restore unsaved changes* before rendering.
3. The WAL entry is cleared only after a `200` from `PUT`.
4. `POST /api/boards/{id}/snapshot` runs client-side once per day per board on first open, and
   before any *Extract to board* or *Restore*. Snapshots are plain blobs; keeping 60 of them
   costs nothing.
5. Blob soft-delete (14 days) is the floor beneath all of that.

---

## 8. Visual design

The canvas is the product. Everything else gets out of its way.

### 8.1 Palette

Card colours are the tempering colours of heated steel — the shades that appear on tool steel as
it passes through 200–330 °C. They are a real, ordered sequence, they are distinguishable at
10% zoom, and they belong to the world the person using this actually works in.

```css
:root {
  /* surfaces — light */
  --surface-canvas:  #EDF0F3;   /* cool paper, the infinite field */
  --surface-raised:  #FFFFFF;   /* cards, panels */
  --surface-sunken:  #E2E6EB;   /* wells, column backgrounds */
  --line:            #CBD2DA;   /* hairlines, 1px */
  --line-strong:     #9AA5B1;
  --ink:             #17202A;
  --ink-muted:       #5B6874;

  /* card colours — steel temper series */
  --temper-straw:    #E0A82E;
  --temper-bronze:   #C2703C;
  --temper-copper:   #A94E3B;
  --temper-purple:   #6E4B7E;
  --temper-blue:     #2F5C8C;
  --temper-teal:     #2A7E76;
  --temper-slate:    #64748B;   /* the default, uncoloured card */

  /* semantics */
  --edge-relates:    #9AA5B1;
  --edge-depends:    #2F5C8C;
  --edge-blocks:     #A94E3B;
  --edge-derives:    #6E4B7E;
  --focus:           #2F5C8C;
}

[data-theme='dark'] {
  --surface-canvas:  #14181D;
  --surface-raised:  #1D232A;
  --surface-sunken:  #0F1317;
  --line:            #2C343D;
  --line-strong:     #4A5561;
  --ink:             #E6EAEE;
  --ink-muted:       #98A3AE;
}
```

Card colour is expressed as a **4 px bar down the left edge**, not a tinted card background. A
board with forty cards stays readable, and the colour still reads at 25% zoom when the card has
collapsed to a rectangle — at which point the rectangle *is* the colour. Custom colours are a
hex picker that writes `#RRGGBB` into the same field; the preset swatches are the seven above.

### 8.2 Type

Two families, clearly distinct in width rather than in style:

- **IBM Plex Sans** — all body text, editors, panels. 15 px base, 1.5 line height, measure
  capped at 68 characters in the card editor.
- **IBM Plex Sans Condensed**, 600 — card and board titles only. Condensed buys roughly four
  more characters per line inside a 240 px card, which is the difference between reading a
  title and reading half of one.
- **IBM Plex Mono** — restricted to board ids, ETags and the debug panel. It never appears as a
  label style.

Sentence case everywhere. No tracked-out capitals, no eyebrow labels above headings.

### 8.3 Chrome

- The canvas fills the window. One top bar (48 px): breadcrumb on the left, view toggle and
  filter in the centre, save state and avatar on the right.
- The left sidebar (board tree) is collapsed by default and opens over the canvas, not beside
  it — the canvas never resizes when navigating.
- The card editor is a right-hand panel, 380 px, that slides in. Double-click a card to open.
- Cards have no shadow at rest — a 1 px `--line` border only. A shadow appears **while
  dragging**, and disappears on drop. Motion answers the action and nothing else: no entrance
  animations, no hover lifts.
- Save state is a single word in the top bar: *Saved*, *Saving…*, *Offline*. Never a spinner
  over the canvas.

### 8.4 Empty states

- Empty board: a single line at the canvas centre — "Double-click anywhere to add a card" — in
  `--ink-muted`, which fades once the first node exists.
- Empty kanban column: a dashed 1 px well with the column name and nothing else.
- No results after filtering: "Nothing matches. Clear the filter."

---

## 9. Keyboard

| Key | Action |
|---|---|
| Double-click canvas | new card at cursor |
| Right-click canvas | pick what to add, at cursor |
| `N` | new card at viewport centre |
| `Shift+N` | new note |
| `T` | new text |
| `S` | pick a shape |
| `Ctrl+V` | paste image or card |
| `Enter` (node selected) | open editor panel |
| `Esc` | close panel / cancel edge draw / clear selection |
| `Tab` | toggle canvas ↔ kanban |
| `Space` + drag | pan |
| `Ctrl` + scroll | zoom at cursor |
| `Ctrl+0` / `Ctrl+1` | zoom to fit / zoom to 100% |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+D` | duplicate selection |
| `Delete` | delete selection |
| `Ctrl+G` | group selection into a frame |
| `Ctrl+Shift+B` | extract selection to a nested board |
| `Ctrl+K` | search across all boards |
| `1`–`7` | apply temper colour to selection |

---

## 10. Build phases

Each phase ends with something usable. Nothing is scaffolded ahead of the phase that needs it.

**Phase 0 — Skeleton (½ day)**
Vite + React + TS + Tailwind. Tokens file. Bicep deploys the RG, storage, containers, CORS, SWA.
GitHub Actions builds and deploys. `staticwebapp.config.json` with the `member` role gate. One
invitation issued to the owner account.
*Done when:* the deployed URL asks for login, lets exactly one account in, and shows "Karta".

**Phase 1 — Canvas and cards (2 days)**
React Flow mounted. `card` and `note` nodes with drag, resize, select, delete. Zustand board
store. `BoardDoc` types shared with the API. Blob load/save with ETag. Autosave and save state.
*Done when:* cards can be created, moved and edited, and survive a browser reload.

**Phase 2 — Card depth (1–2 days)**
Editor panel: markdown body, checklist with fractional ranks and progress ring, labels, temper
colours plus custom hex, due date. LOD rendering. Undo/redo stack.
*Done when:* a card holds real content and the board is readable at every zoom level.

**Phase 3 — Arrows and nesting (2 days)**
Handles, edge drawing, the four semantics, edge labels, routing modes. Drop-on-empty menu.
`boardLink` nodes, `_index.json` maintenance in the API, breadcrumb, sidebar tree, *Extract to
board*.
*Done when:* the MMORPG project's real structure can be laid out across three levels of boards.

**Phase 4 — Images (1 day)**
Paste and drag-drop. Client downscale and WebP encode. SAS upload, commit, read-token caching.
`image` nodes, cover images on cards, orphan cleanup.
*Done when:* a Unity screenshot goes from `Ctrl+V` to on-canvas in under a second, and the
stored blob is under 300 KB.

**Phase 5 — Kanban (1 day)**
Status definitions per board, column view, drag between columns, rank within column, filter bar
shared with the canvas dimming overlay.
*Done when:* `Tab` switches views and dragging a card to *Klar* is reflected on the canvas.

**Phase 6 — Durability and collaborators (1–2 days)**
IndexedDB WAL and restore prompt. Snapshots and restore UI. Node-level three-way merge and
retry. 20 s index polling. Board ACLs enforced in the API. Second user invited and tested.
*Done when:* two browsers editing different cards on one board both keep their work.

**Phase 7 — Polish (open-ended)**
Global search (`Ctrl+K`) over the index plus loaded boards. Dark mode toggle. Group frames.
Board templates. Export a board to JSON and to a printable PDF.

Roughly 8–11 focused days to Phase 6.

---

## 11. Operational rules

- The GitHub Actions workflow is the only deployment path. No portal edits to the SWA.
- `infra/main.bicep` is the only definition of the resources. If it is not in the file, it does
  not exist.
- Storage soft delete is 14 days and stays on.
- Before any schema change: bump `schemaVersion`, write a forward migration in
  `api/src/domain/migrate.ts`, and run it lazily on read. Never migrate in bulk.
- Check the resource group's cost once a month. It should read as a rounding error. If it does
  not, something was added that bills per hour.

---

## 12. Deliberately deferred

Written down so they stop being tempting.

| Idea | Revisit when |
|---|---|
| Live cursors / presence | more than two people use it weekly (SignalR free tier) |
| Comments and @mentions | someone other than the owner asks a question on a card |
| Search across board *bodies* | the index-only search stops finding things |
| Cosmos DB | a board doc passes 500 KB in practice |
| Calendar / timeline view | due dates are actually being filled in |
| Unity integration (link cards to assets or scenes) | after Phase 6, as a separate spike |
| Mobile editing | never |

---

## Appendix A — Starter template for the MMORPG project

A new board can be created from a template. The one that ships:

**Root board: "MMORPG"** — five `boardLink` nodes in a row, one `note` at the top with the
one-line pitch.

| Child board | First cards |
|---|---|
| Systems | Character controller, Networking (MMORPG KIT), Persistence, Instancing, Inventory |
| Classes & spells | One card per class; checklist of 7–12 spells inside each |
| World | Zone blockouts, Navmesh, Spawns, Points of interest |
| Content pipeline | Asset sources, Import settings, Naming conventions |
| Bugs & friction | *empty, filled as encountered* |

Suggested edge use: `depends` from **Networking** to everything that cannot be built before it,
`derives` from a system card to the class cards that came out of it. That single convention
turns the root board into a build order at a glance.

---

## Appendix B — Open questions

1. **Board title language.** UI in English, or Swedish like TaskHub? English is assumed above
   (default statuses excepted). Trivial to switch, but it decides whether react-i18next goes in
   at Phase 0 or never.
2. **Board-level ACL vs one shared space.** The spec carries `acl` from the start but only
   enforces it in Phase 6. If collaborators will see everything anyway, that field can be
   deleted and roughly a day of Phase 6 with it.
3. **Snapshot cadence.** Once per day per board on first open is proposed. Cheaper alternative:
   only before destructive operations.
4. **Does `group` earn its place?** It is the one node type with no clear job that a nested
   board does not already do better. Currently scheduled for Phase 7, and a fair candidate for
   deletion.
