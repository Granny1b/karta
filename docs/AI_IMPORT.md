# Importing JSON into Karta

Karta reads a small, deliberately boring JSON format. It exists for one workflow:

> Describe the work to an AI, get JSON back, paste it into Karta, and have a board.

The same format comes back out of **Export → Portable**, so a board can be handed to an AI to
extend and pasted back in.

---

## The three-step version

1. **Export → AI prompt → Copy.** Paste it into whatever assistant you use, and finish the last
   line with what you want on the board.
2. Copy the JSON it answers with.
3. **Import**, paste, check the preview line at the bottom of the dialog, press **Import**.

Nothing is written to the server until the normal autosave runs, and every import is one undo
step (`Ctrl+Z`).

---

## The prompt

This is the text behind **Export → AI prompt**. It is reproduced here so it can be copied from a
terminal or a README instead.

```
You are helping me plan work on a visual board called Karta.

Reply with a single JSON object in the format below — no explanation, no markdown fence, JSON only.

Format:
{
  "kartaVersion": 1,
  "board":    { "title": "optional board title" },
  "statuses": [ { "name": "Bygger", "color": "bronze", "isDone": false } ],
  "labels":   [ { "name": "bug", "color": "copper" } ],
  "cards": [
    {
      "key": "a",                       // optional handle used by "edges" below
      "title": "Short imperative title",
      "body": "Markdown. Why this exists, what done looks like.",
      "status": "Bygger",               // a status NAME, matched case-insensitively
      "labels": ["bug"],                // label NAMES, created if new
      "checklist": ["First step", { "text": "Done already", "done": true }],
      "color": "blue",                  // straw bronze copper purple blue teal slate, #RRGGBB or #RGB
      "due": "2026-04-30",              // ISO date or YYYY-MM-DD
      "collapsed": false
    }
  ],
  "notes":  [ { "key": "n1", "text": "A sticky note on the canvas", "color": "straw" } ],
  "texts":  [ { "text": "Section heading", "fontSize": 32, "weight": "bold" } ],
  "shapes": [ { "key": "s1", "shape": "diamond", "label": "Ready?", "fill": "blue" } ],
  "edges": [
    { "from": "a", "to": "Other card title", "semantic": "depends", "label": "needs" }
  ]
}

Rules:
- Only "title" is required on a card. Everything else is optional.
- "from" and "to" are card keys, or exact card titles.
- A "key" must be unique across cards, notes, texts and shapes.
- "semantic" is one of: relates, depends, blocks, derives. Default is relates.
- "shape" is one of: rectangle, roundedRect, ellipse, diamond, triangle, hexagon,
  cylinder, parallelogram, cloud, document, process, callout.
- "texts" are headings laid on the canvas and "shapes" are flowchart boxes;
  leave both out unless I ask for a diagram.
- Leave positions out; Karta lays the cards out in a grid.
- Use 5 to 15 cards unless I ask for more. Titles under 60 characters.

Example answer: … (see src/io/exporter.ts)

Here is what I want on the board:
```

---

## Schema

### Root

| Field | Type | Notes |
|---|---|---|
| `kartaVersion` | `1` | Optional. Anything other than `1` is refused. |
| `board` | object | Optional. `{ "title": "…", "icon": "…" }` — renames the board being imported into. |
| `statuses` | array | Optional. Columns, in order. Missing ones are appended. |
| `labels` | array | Optional. Labels are also created on demand from card `labels`. |
| `cards` | array | The cards. |
| `notes` | array | Optional. Sticky notes; canvas only, they never appear in the kanban view. |
| `texts` | array | Optional. Free text laid on the canvas. Canvas only. |
| `shapes` | array | Optional. Flowchart shapes. Canvas only. |
| `edges` | array | Optional. Arrows between anything with a `key`. |

A **bare array** is accepted as `cards`, so `[{ "title": "One" }, { "title": "Two" }]` is a valid
import. A **full board export** (the *Full* tab) is accepted too, and is converted automatically.

Mixed-up input is read as whichever shape actually carries the content: an object with both `nodes`
and `cards` is read as a board export only when its `nodes` hold the content and its `cards` do not.
So a *Full* export handed to an AI that answered by appending to `cards` still imports those cards —
and the array that was not used is reported as an ignored field rather than dropped in silence.

### `statuses[]` and `labels[]`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required. Matched case-insensitively against existing columns and labels. |
| `color` | colour token | Optional. One of the seven names below; defaults to `slate`. |
| `isDone` | boolean | Statuses only. Marks the column that counts as finished. |

### `cards[]`

| Field | Type | Notes |
|---|---|---|
| `title` | string | **Required**, but may be `""` — a card whose title was cleared is still a card. |
| `key` | string | A local handle for `edges` to point at. Never stored. Unique across cards, notes, texts *and* shapes. |
| `body` | string | Markdown. Whitespace is preserved. |
| `status` | string | A status *name*. Unknown names create a new column at the end. |
| `labels` | string[] | Label *names*. Unknown names create a label with the default colour. Repeats of the same name, in any case, are dropped. |
| `checklist` | array | `"text"`, or `{ "text": "…", "done": true }`. |
| `color` | string | A colour token, or hex — see **Colours**. |
| `due` | string | `YYYY-MM-DD` or a full ISO timestamp. |
| `position` | `{x, y}` | Optional. Omit it and the card is laid out for you. |
| `collapsed` | boolean | Whether the card renders collapsed on the canvas. |

### `notes[]`

| Field | Type | Notes |
|---|---|---|
| `text` | string | **Required**, but may be `""` — an untouched sticky note has no text. |
| `key`, `color`, `position` | | As for cards. Every node list shares one key namespace: if the same key appears twice, the first to claim it keeps it, and the second is warned about. |

### `texts[]`

A heading or an aside written straight onto the board — no frame, no fill.

| Field | Type | Notes |
|---|---|---|
| `text` | string | **Required**, but may be `""` — a text box created and not yet typed into is still one. |
| `fontSize` | number | Canvas pixels, 8–200. Default 20. Out of range warns and uses the default. |
| `align` | string | `left` (default), `center`, `right`. |
| `weight` | string | `regular` (default) or `bold`. |
| `color` | string | The **ink**, not a background — token or hex, see **Colours**. |
| `key`, `position` | | As for cards. |

A bare string in `texts` is the text: `"texts": ["Phase one", "Phase two"]`.

### `shapes[]`

The draw.io vocabulary, for a flowchart drawn beside the cards.

| Field | Type | Notes |
|---|---|---|
| `shape` | string | **Required.** One of `rectangle`, `roundedRect`, `ellipse`, `diamond`, `triangle`, `hexagon`, `cylinder`, `parallelogram`, `cloud`, `document`, `process`, `callout`. An unknown name warns and draws a rectangle. |
| `label` | string | Text centred inside the shape. |
| `fill` | string | Token or hex. Omit for an outline-only shape. |
| `stroke` | string | Token or hex. Omit for the default line colour. |
| `key`, `position` | | As for cards. |

A bare string in `shapes` is the shape name: `"shapes": ["diamond", "cloud"]`.

### `edges[]`

| Field | Type | Notes |
|---|---|---|
| `from`, `to` | string | **Required.** A `key` — of a card, note, text or shape — or a card title. |
| `semantic` | string | `relates` (default), `depends`, `blocks`, `derives`. |
| `label` | string | Optional text drawn on the arrow. |

`from`/`to` are resolved in this order: the `key` of a card in this import → the id of a node
already on the board → an exact title → a case-insensitive title. The first match wins, and an
ambiguous title raises a warning rather than an error.

### Colours

`straw`, `bronze`, `copper`, `purple`, `blue`, `teal`, `slate` — the tempering colours of heated
steel, matched whatever the case (`Blue` is `blue`). Statuses and labels take a token and nothing
else; a hex value there is ignored with a warning.

Cards, notes, texts and shape `fill`/`stroke` also take a **custom hex colour**, written any of
these ways:

| Written | Stored |
|---|---|
| `#AB12CD`, `#ab12cd` | `#ab12cd` |
| `AB12CD` (no hash) | `#ab12cd` |
| `#f00`, `F00` (shorthand) | `#ff0000` |

Everything is folded into the one form the board stores, `#rrggbb`, because that is the only form
the server accepts — a colour kept as written would produce a board that could never be saved again.
Anything else (`rgb(255,0,0)`, `red`, `#ff00`) is dropped with a warning; it never fails the import.

### Length limits

The board is stored as one document, and the server measures every string in it (spec 5.6). The
importer applies the same limits, so nothing can be imported that could not then be saved. Anything
longer is **cut to the limit and reported as a warning** — the import still goes through.

| Field | Limit |
|---|---|
| Card title, board title, `edges[].from`/`to`/`label` | 300 |
| Status name, label name | 120 |
| Board `icon` | 64 |
| Shape label | 300 |
| Checklist item text | 2 000 |
| Note text, text-node text | 20 000 |
| Card body | 200 000 |

`from`/`to` are cut at the same 300 characters as a title, so an arrow that names a shortened title
still finds its card.

---

## Worked example 1 — a feature breakdown

```json
{
  "kartaVersion": 1,
  "board": { "title": "Inventory rewrite" },
  "labels": [{ "name": "spike", "color": "purple" }],
  "cards": [
    {
      "key": "model",
      "title": "Item model and stacking rules",
      "body": "Stack size per item type, plus the rules for partial stacks on pickup.",
      "status": "Planerad",
      "checklist": ["Decide stack sizes", "Write the merge rule", "Unit tests"]
    },
    {
      "key": "ui",
      "title": "Grid UI with drag and drop",
      "status": "Idé",
      "labels": ["spike"],
      "color": "blue"
    },
    {
      "key": "save",
      "title": "Persist inventory to the save file",
      "status": "Idé",
      "due": "2026-05-15"
    }
  ],
  "notes": [{ "text": "Keep the old save format readable for one release." }],
  "edges": [
    { "from": "ui", "to": "model", "semantic": "depends" },
    { "from": "save", "to": "model", "semantic": "depends" }
  ]
}
```

Result: three cards in two columns, one label created, one note, two dependency arrows.

## Worked example 2 — a bug list

The shortest thing that works. A bare array, no keys, no positions:

```json
[
  { "title": "Loot window closes on ESC while typing", "labels": ["bug"], "status": "Bygger" },
  { "title": "NPC pathing stalls on the bridge", "labels": ["bug"], "color": "copper" },
  { "title": "Audio ducking never restores", "labels": ["bug"], "checklist": ["Repro", "Fix", "Verify"] }
]
```

The `bug` label is created once and shared by all three.

---

## Merge or replace

| | **Add to this board** (merge) | **Replace everything on this board** |
|---|---|---|
| Existing cards | Kept, untouched | Removed |
| Existing arrows | Kept | Removed |
| Statuses and labels | Kept; missing ones added | Kept |
| Board title | Changed only if `board.title` is given | Same |
| Images and access list | Kept | Kept |
| Layout | New cards go in a grid *below* everything already there | New cards start at the top-left |
| Before it runs | — | A snapshot is taken, so the board can be restored |

Both are a single undo step. Merge is never destructive: it adds, and only adds.

---

## Guarantees

- **Unknown fields are ignored**, with a note under the box. An AI that invents `"priority"` or
  `"assignee"` still produces a usable import.
- **Unresolved arrows are warnings.** If `to` names a card that does not exist, that one arrow is
  skipped and the rest of the import goes through.
- **Value problems degrade, structure problems fail.** An unparseable date, an unknown colour or a
  string past its limit is dropped, shortened or normalised with a warning; a card with no `title`
  key at all, or a `labels` field that is not a list, is an error naming the exact JSON path —
  `cards[3].title is required.`
- **Empty is a value, not an error.** An empty title, note or checklist item is kept as it is, so a
  board that holds one survives its own export and import.
- **The preview is the truth.** The line at the bottom of the import dialog is produced by running
  the real import against the real board and throwing the result away, so it cannot disagree with
  what the button does.
- **Nothing is uploaded on paste.** The import is a local edit; it reaches the server through the
  normal autosave, guarded by the same ETag as every other change.

## What the portable format cannot carry

Images, groups and board links live only in the full board document. A *Portable* export skips
them (and says so), and an arrow with one end on a skipped node is skipped with it. Use
**Export → Full** for a true backup: everything a *Portable* export carries — statuses, labels,
colours, checklists, due dates, collapsed cards, notes, texts, shapes, arrows and their semantics —
comes back exactly as it went out, and the round trip is covered by a test in
`src/io/importer.test.ts`.
