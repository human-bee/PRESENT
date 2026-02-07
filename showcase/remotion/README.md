# Present Showcase Video (Remotion)

This folder contains a small, isolated Remotion project used to render a product showcase video from Playwright screenshot artifacts.

## Inputs

The Remotion composition expects screenshots in:

- `showcase/remotion/public/showcase/<runId>/`

The Playwright showcase test writes screenshots to:

- `docs/scrapbooks/assets/showcase/<runId>/`

## Quick Render (Example)

1. Generate a new screenshot run (production base URL):

```bash
# from repo root
set -a
source /Users/bsteinher/PRESENT/.env.local
set +a

PLAYWRIGHT_BASE_URL=https://present.best npx playwright test tests/showcase-ui.e2e.spec.ts
```

2. Copy the screenshots into Remotion’s `public/` folder:

```bash
# from repo root (replace <runId>)
mkdir -p showcase/remotion/public/showcase/<runId>
cp -R docs/scrapbooks/assets/showcase/<runId>/* showcase/remotion/public/showcase/<runId>/
```

3. Create a props file:

```bash
cp showcase/remotion/showcase.props.example.json showcase/remotion/showcase.props.json
# edit runId inside showcase/remotion/showcase.props.json
```

4. Install + render:

```bash
cd showcase/remotion
npm install
npm run render
```

Output:

- `docs/scrapbooks/assets/showcase/render.mp4`

