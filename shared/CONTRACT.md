# Naqsh Studio implementation contract

Root: `/workspace/naqsh-studio`. User interface and README are Persian (RTL). This is a working first release, not a claim of production certification. Never claim raster catalog art is vector. No live-site integration or credentials are bundled.

## Ownership

- Parent: `shared/engine.js`, tests, root server/package/docs and integration.
- Web agent: `web/index.html`, `web/app.js`, `web/styles.css` only.
- Illustrator agent: `illustrator/**` only.
- Catalog agent: `tools/import_catalog.py`, `assets/**` only.

## Library: assets/library.json

```json
{
  "version": 1,
  "source": {"name":"Katalog-1000-1200.pdf", "pageCount":195},
  "motifs": [
    {
      "code":"P1775", "family":"P", "asset":"assets/motifs/P1775.png",
      "widthMm":100, "heightMm":30, "pixelWidth":1200, "pixelHeight":360,
      "sourcePages":[1], "collectionCodes":["K1000"],
      "needsCalibration":true,
      "variants":[{"asset":"assets/motifs/P1775.png","widthMm":100,"heightMm":30,"pixelWidth":1200,"pixelHeight":360}],
      "note":"Extracted image; repeat boundaries need one-time review"
    }
  ],
  "sets":[{"code":"K1000","page":1,"thumbnail":"assets/sets/K1000.jpg","motifCodes":["P1775","Z347","D1282","B737"]}]
}
```

Natural width/height are the image placement size from the PDF, NOT a verified seamless repeat. No synthetic tracing. Code matching can ignore Persian digits, whitespace, a single separator after the family, and numeric leading zeros. Missing codes must never silently substitute another motif. Sets/K codes are references, not printable motifs.

## Project (millimetres only internally)

```json
{
  "version":1,
  "name":"سفارش نمونه",
  "sheet":{"widthMm":2500,"heightMm":1500,"autoHeight":true,"gutterMm":12,"marginMm":10},
  "guides":true,
  "sections":[
    {
      "id":"s1","name":"آستین","partKind":"astin","partCode":"Astin","labelFa":"آستین",
      "widthMm":350,"heightMm":550,"quantity":1,
      "shape":"rect","topWidthMm":280,"neckWidthMm":90,"neckDepthMm":100,
      "mirror":false,"rotateOnSheet":false,
      "layers":[
        {
          "id":"l1","name":"نقش اصلی","code":"P1775","enabled":true,
          "xMm":0,"yMm":0,"widthMm":350,"heightMm":100,
          "mode":"repeatX","tileWidthMm":100,"tileHeightMm":30,"lockAspect":true,
          "gapXmm":0,"gapYmm":0,"offsetXmm":0,"offsetYmm":0,
          "rotation":0,"mirrorX":false,"mirrorY":false,
          "alternateX":false,"alternateY":false,"opacity":1
        }
      ]
    }
  ]
}
```

Standard bilingual section types are `astin` / `Astin` / `آستین`, `tak` / `tak` / `تک`, `pan` / `Pan` / `پانچک`, and `zih` / `zih` / `زیح`, represented by `partKind`, `partCode`, and `labelFa`. Custom sections use `partKind:"custom"` with a valid English identifier in `partCode` and a Persian label in `labelFa`. These labels are user-supplied garment terminology; they do not assert motif-to-piece mappings. Section shapes: `rect`, `trapezoid` (centred top width), `pentagon` (pointed top), `neck` (rectangular section with a rounded U notch in top edge), `polygon` with custom `points:[[x,y],...]` in mm. Quantity duplicates sections; mirror mirrors a whole section's artwork, not the sheet. Project sections may contain any number of named layers; each layer has its own region and clipping. Modes: `single` (centred natural/scaled motif), `contain`, `cover`, `repeatX`, `repeatY`, `grid`.

## Shared engine (UMD / ES3-compatible, no dependencies)

Global `NaqshEngine`, CommonJS export also available.

- `normalizeCode(text)` -> string
- `findMotif(library, code)` -> motif or null (canonical/leading-zero tolerant)
- `validateProject(project, library)` -> `{errors:[],warnings:[]}`
- `layout(project, library, options?)` -> manifest below; throws descriptive error on invalid/missing codes, bad sizes, sheet overflow, >10000 placements.
- `getGarmentPart(kindOrCodeOrName)` / `garmentParts()` -> the standard bilingual catalog.
- `renderSvg(manifest, assetMap?, options?)` -> SVG string; assetMap maps motif code or asset path to data URL or relative URL. Options `{guides:true,labels:true,background:'#ffffff',profile:'technical-bw-v1'}`. The technical profile stamps the SVG and declares black vector guides/labels; the PDF server must still normalize raster assets. Preview may use relative asset paths; portable export must embed every image as data URI. Labels/cut guides are a separate SVG group and must be optional.
- `makeDefaultProject(library)` -> representative editable full-garment project using only codes actually present. Preset includes paired sleeves, paired Pan panels, paired Tak panels, Zih/chest section. Every part begins with multiple named motif layers (fine field, central/longitudinal motif, edge bands and/or pendant repeats) so the sample demonstrates deliberate compositions, not one-code fills. Names are labels from user PDFs, not an assertion of tailoring terminology; sample dimensions remain hypothetical.
- `makeSection(id,name,widthMm,heightMm,code)` -> section default helper.
- `createExchange(project, library, assetMap)` -> self-contained `{format:'naqsh-project',version:2,schemaVersion:2,appVersion:'1.2.0-alpha.1',project,library:{version:1,motifs:[used...]},manifest,assets:assetMap}`.

## Manifest produced by layout

```json
{
 "version":1,"name":"سفارش نمونه",
 "sheet":{"widthMm":2500,"heightMm":1500},
  "sections":[
  {"id":"s1-1","sourceId":"s1","name":"آستین","partKind":"astin","partCode":"Astin","labelFa":"آستین","xMm":10,"yMm":10,
   "widthMm":350,"heightMm":550,"mirror":false,
   "points":[[0,0],[350,0],[350,550],[0,550]],
   "layers":[
    {"id":"l1","name":"نقش اصلی","region":{"xMm":0,"yMm":0,"widthMm":350,"heightMm":100},
     "placements":[
      {"code":"P1775","asset":"assets/motifs/P1775.png","xMm":0,"yMm":35,
       "widthMm":100,"heightMm":30,"rotation":0,"mirrorX":false,"mirrorY":false,"opacity":1}
     ]}
   ]}
 ],
 "warnings":[],"placementCount":4
}
```

Placement coordinates are local to the section, y down, in mm. Rotation is clockwise around the image centre. MirrorX/Y reflect around the image centre before rotation. Section mirror reflects its entire local artwork around its width. Regions clip artwork, and section points clip all regions. Native Illustrator uses mm*72/25.4 and inverts y. No automatic scaling to fit an undersized sheet.

## Web obligations

Clean professional responsive Persian RTL desktop workspace (warm ivory, charcoal, teal accents); real motif thumbnails from provided library, no unrelated stock imagery. Left/right panels: project/sections, live SVG canvas, property editor/library. Required working features: load library, search exact code and K sets, choose motif, add/remove/duplicate section, section dimensions/quantity/shapes, add/remove pattern layer, pattern region, repeat/fit, scale preserving aspect, rotate/mirror/alternating mirror, offsets/gaps, guides toggle, zoom/fit, undo/redo, local save/restore, export self-contained SVG, export PDF via backend, export/import exchange JSON for Illustrator. Custom image import (PNG/JPEG/SVG) should be available; sanitize SVG (no scripts/external refs) or restrict unsafe SVGs. Display missing-code/invalid-size errors, raster quality and uncalibrated library warnings. Never show fake success.

Static paths from root: `/` serves `web/index.html` inside Electron; `/web/...`, `/shared/engine.js`, `/assets/library.json`, `/assets/...`. `POST /api/export/pdf` requires JSON `{svg,filename,profile:'technical-bw-v1',expected_width_mm,expected_height_mm}` and returns application/pdf only if the SVG profile, physical page size, raster placement metadata and minimum 300 PPI pass. It thresholds raster to black/white at 128, rasterizes shaped bilingual labels at 600 PPI using the bundled licensed Vazirmatn font, preserves vector geometry, and verifies the resulting PDF's dimensions and paint values. `GET /api/health` returns the app version and supported print profile. The Windows desktop package is the only user-facing delivery; do not advertise a standalone web build.

## Illustrator obligations

Deliver a CEP panel source plus a standalone `.jsx` fallback. Both accept exchange JSON from web and create a NEW Illustrator document with physical mm scale, named section/layer groups, repeated placed/embedded images, native section and region clipping paths, rotation/mirrors. Never modify/delete existing document. Prefer actual native pathItems/placedItems over a flattened full-page screenshot. Allow direct code+dimensions operation from local library for at least one part and repeats, and selecting library root. Panel can use shared engine as copied file/package assembly; importer only needs manifest. Parse JSON safely (JSON2 polyfill, no eval of project file). Assets may be embedded data:image/png;base64/... in exchange; decode to temp files and place, keeping reliable file lifetimes or embed. Reject missing assets, excessive size/count, external URLs and malformed dimensions. Include install/uninstall instructions for Windows/Mac, a CSXS manifest and useful errors. Do not claim testing inside Illustrator (not available here). No signed ZXP claim. Installation can need unsigned-development mode; clearly disclose this.

## Catalog safety

Asset association is provisional. Preserve alpha, no vectorization, native image resolution. Record ambiguity and source pages. If an explicit code has multiple images above it, keep variants/parts; do not silently call all of them seamless. Exclude page frames, labels and unrelated thumbnail preview where possible. Deduplicate repeated codes but preserve references. Include an extraction audit JSON of warnings if useful. No user phone, auth code, session cookies or customer information in deliverables.
