# Brick Atelier

A premium, browser-based brick-building studio: browse the catalogue of official sets, build in 3D with real
part geometry, follow step-by-step guides, and make Technic mechanisms that actually turn.

Built with Vite, React, TypeScript, react-three-fiber, shadcn/ui and Zustand.

## Features

- **Studio:** stud and Technic snapping with a ghost preview, real-shape collision, groups, box-select, X-ray, explode view, undo, and autosave in the browser.
- **Catalogue:** about 20,000 official sets with themes, years and inventories. You can build any set's parts freely.
- **Guided builds:** about 1,800 official models from the LDraw OMR as step-by-step guides, plus generated alternate builds and photo mosaics.
- **Mechanisms:** axles, gears, chains and tracks, motors you can play, hinges, a stability heat-map, and Rapier drop and shake tests.
- **Rendering:** PBR plastic, soft shadows, ambient occlusion, background-only depth of field, and a path tracer for Photo mode and "ray trace when still".
- **Studio extras:**
  - Measuring and editing: ruler, mirror copy and flip with left/right part swaps, merge and split.
  - Linked submodels.
  - Flexible hoses.
  - Output: a step editor, a parts list exported as a Rebrickable CSV, printable instructions, and LDraw export.

## Getting started

Requires Node 20 or newer.

```bash
npm install
npm run data   # one-off: downloads ~1.3 GB of source data and generates public/data (~460 MB). Takes a while.
npm run dev    # http://localhost:5181
```

The generated data isn't in git (see `.gitignore`). Every clone runs `npm run data` once. The tests read
`public/data/parts.json`, so build the data before running them.

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check and production build into `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run data` | The whole data pipeline (all the steps below) |
| `npm run data:fetch` | Download the LDraw parts library and the Rebrickable CSVs into `data/raw` |
| `npm run data:omr-fetch` / `data:omr` | Download and convert the LDraw official models into guided steps |
| `npm run data:parts` | Pack parts, connectors and colours (`MAX_PARTS` env var sets how many popular parts to include) |
| `npm run data:catalog` | Sets, themes, inventories and "appears in" |

### Development tips

- Open `/?sandbox#/studio` to test without touching the build saved in your browser. Sandbox mode turns off autosave and restore.
- In dev, `window.studio` is the Zustand store, for driving the studio from the console.

## Data and credits

- **LDraw parts library and Official Model Repository**, © LDraw.org contributors, licensed CC BY 2.0: <https://library.ldraw.org>
- **Rebrickable catalogue data** (sets, themes, inventories, colours): <https://rebrickable.com/downloads/>

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this project.
Brick Atelier is an independent fan project and is compatible with LEGO® bricks.
