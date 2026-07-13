# Local vocabulary API

Node 24 only. The API reads `data/generated/vocabulary.sqlite3` in SQLite
read-only mode and writes study state to `data/runtime/progress.sqlite3`.

## Run

```powershell
node .\server\app.mjs
```

The default URL is `http://127.0.0.1:4173`. Optional environment variables:

- `PORT`, `HOST`
- `VOCAB_DB_PATH`
- `PROGRESS_DB_PATH`
- `DIST_DIR`
- `HERMES_COMMAND` (optional trusted path/name for the local Hermes executable)

When `dist/` exists, the same server also serves the built web app with an
`index.html` fallback.

## Endpoints

- `GET /api/health`
- `GET /api/ranges`
- `POST /api/session` (`/api/sessions` is an alias)
- `GET /api/session/:sessionId`
- `GET /api/lexemes/:lexemeId`
- `POST /api/reviews` (`/api/review-events` is an alias)
- `GET /api/summary` (`/api/reviews/summary` is an alias)
- `POST /api/articles`
- `GET /api/articles`
- `GET /api/articles/:articleId`
- `DELETE /api/articles/:articleId`

Create a union session:

```json
{
  "rangeIds": ["range:yingdan1:prefix:u01", "range:yingdan1:prefix:u02"],
  "limit": 40,
  "order": "shuffle"
}
```

`mode` defaults to `manual`, preserving the original range/limit behavior. A
session response always includes `mode` and the number of returned cards in
each planned bucket:

```json
{
  "sessionId": "session:...",
  "total": 574,
  "cards": [],
  "mode": "today",
  "plan": { "due": 4, "new": 16, "problems": 0 }
}
```

- `today`: returns all due cards first, followed by up to `newLimit` unseen
  cards. `newLimit` defaults to 20 and accepts integers from 0 through 80.
  Future cards are excluded. `limit` is applied after the due/new plan.
- `problems`: returns lexemes with at least one `again`, using the same ranking
  as `GET /api/summary`; `limit` is applied after ranking.
- `order: "shuffle"` shuffles within the daily due/new buckets, retaining due
  priority. Problem sessions shuffle their ranked candidate set before limit.

`total` remains the number of unique lexemes in the selected range, so existing
clients can continue to use it as the scope count. `plan` counts only cards
actually returned by that session; manual sessions report zeroes because they
do not classify cards into scheduling buckets.

Record a review:

```json
{
  "lexemeId": "lexeme:d490151378f5fc99",
  "entryId": "yingdan1:p001:e01",
  "sessionId": "session:...",
  "rangeIds": ["range:yingdan1:prefix:u01"],
  "rating": "good",
  "responseMs": 2300,
  "flippedBeforeAnswer": true
}
```

Generate a reading article with a local Ollama or OpenAI-compatible server:

```json
{
  "baseUrl": "http://127.0.0.1:11434",
  "model": "qwen3:8b",
  "provider": "auto",
  "lexemeIds": ["lexeme:...", "lexeme:...", "lexeme:..."],
  "level": "intermediate",
  "length": "medium",
  "includeTranslation": true
}
```

`lexemeIds` and `words` may be combined, but must resolve to 3-12 unique catalog
items. `provider` is `auto`, `ollama`, `openai`, or `hermes`. The response contract is:

```json
{
  "article": {
    "title": "...",
    "body": "...",
    "translationZh": "...",
    "usedWords": ["..."],
    "questions": [{ "question": "...", "answer": "..." }]
  },
  "meta": {
    "provider": "ollama",
    "model": "qwen3:8b",
    "generatedAt": "2026-07-13T00:00:00.000Z"
  }
}
```

For SSRF protection, AI URLs are restricted to `localhost`, `127.0.0.1`, or
`[::1]`; URL credentials and redirects are rejected. The default complete
request timeout is 60 seconds. API keys are neither accepted nor stored.

Hermes Agent requires no `baseUrl` or `model` fields:

```json
{
  "provider": "hermes",
  "lexemeIds": ["lexeme:...", "lexeme:...", "lexeme:..."],
  "level": "intermediate",
  "length": "medium",
  "includeTranslation": true
}
```

The server starts the trusted local `hermes` executable (or `HERMES_COMMAND`) in
one-shot mode with `--ignore-rules` and the empty `context_engine` toolset. This
keeps Hermes skills, terminal, file, browser, and other action tools out of the
article request. The prompt is limited to the selected catalog vocabulary and a
fixed JSON article contract. Hermes has a separate 120-second timeout; no key is
accepted, saved, or sent by this API.

Scheduling uses `ts-fsrs 5.4.1` with FSRS-6, 90% requested retention, the
standard `1m`/`10m` learning steps, and a `10m` relearning step. `again` maps
to FSRS grade 1 and `good` maps to grade 3. The complete FSRS Card and review
log are stored with the event in the same SQLite transaction; `due`,
`stability`, `difficulty`, `retrievability`, `lapses`, and state are also
materialized for efficient app queries.

## Test

```powershell
npm run test:server
```
