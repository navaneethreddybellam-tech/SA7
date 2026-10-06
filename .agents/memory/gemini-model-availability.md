---
name: Gemini model availability
description: Direct Google Gemini Developer API model IDs can return 404 even while documentation still lists them.
---

For this project, `gemini-2.5-flash` returned HTTP 404 on 2026-10-06 even though Google's docs still listed it with an announced shutdown date of 2026-10-16. The stable `gemini-3.5-flash` model succeeded through the direct Developer API.

**Why:** Current provider availability can diverge from a static supported-model list or an announced retirement date.

**How to apply:** Before wiring or changing a Gemini model, check Google's current Developer API docs and make one minimal live request using the configured server-side key. Do not expose the key or log the provider error body.
