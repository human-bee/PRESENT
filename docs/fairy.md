# Fairy System (Local Dev)

## Enable the Fairy system

1. Set env vars in `.env.local`:

```
NEXT_PUBLIC_FAIRY_ENABLED=true
NEXT_PUBLIC_FAIRY_DEV_PANEL=true
NEXT_PUBLIC_FAIRY_WORKER_URL=/api/fairy
FAIRY_MODEL=gpt-5.1
OPENAI_API_KEY=your_openai_api_key
```

`NEXT_PUBLIC_FAIRY_DEV_PANEL` is optional; it shows the compact Fairy Control panel in addition to the full HUD.

2. Start the stack:

```
npm run stack:start
```

3. Open `http://localhost:3000/canvas` and use the **Fairy Control** panel to summon + prompt.

## Run the Fairy Lap Playwright test

```
npx playwright test tests/fairy-lap-report.e2e.spec.ts
```

Artifacts are written to `test-results/fairy-lap-<timestamp>/` with `report.md` and screenshots.
