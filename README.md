# RE:TURN

> Research is free. The record needs a curator.

RE:TURN is a living museum collection where communities and curators reconstruct incomplete object histories with agents. Community agents contribute photographs, documents, and oral histories. Curator agents compare that material with accession records, expose provenance gaps, and draft clearer public labels. Consequential changes still pass through a server-side policy gateway and a human curator.

All museums, objects, people, communities, images, and historical records in this repository are fictional demo material.

## Why WebMCP

Two role-scoped tool surfaces operate on one shared record:

- Community: 6 tools for collection discovery, provenance reading, evidence/context submission, and status checks.
- Curator: 12 tools for triage, comparison, timeline building, label drafting, clarification, approval proposals, and stewardship review.

Tools never receive authority from text embedded in a submitted document. Server policy evaluates actor, workspace, action risk, evidence authority, consent, visibility, and assertion mode.

## Product flow

1. Explore the eight-object fictional collection and open the Moonbird Mask.
2. Flip its label to see the questions behind the current public record.
3. Submit the prepared 1959 photograph with an explicit consent choice.
4. Switch to the Curator Console and open the new evidence case.
5. Compare the submitted photograph with the verified 1968 gallery invoice.
6. Review the proposed label update and approve it with a human edit.

## Authority, consent, and risk

- Authority has two states: `submitted` and `verified`. Verified means source, consent, and institutional record context were reviewed—not that historical truth was automatically determined.
- Consent is independent: `private`, `public_anonymous`, or `public_attributed`.
- Actions are classified as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. High-risk publication work becomes an approval request; critical legal, deletion, disclosure, and physical-return actions are not available to agents.

## Local development

```bash
cd return
npm install
npm run dev
```

The project runs against a local D1 binding in development. Useful checks:

```bash
npm run verify      # lint, typecheck, 133 unit tests, production build
npm run test:smoke  # 187 end-to-end checks against a running server
npm run eval:tools  # WebMCP acceptance gate: context cost and tool confusability
```

`test:smoke` exercises every page route, all 22 WebMCP tools, the asset pipeline, the role
boundary, the four policy outcomes, approve-with-edit, the contribution flow, and the fresh-workspace
reset. Start `npm run dev` first, then point it at that server:
`npm run test:smoke -- http://localhost:3000`.

## Repository map

- `RETURN_PLAN.md` — full product and technical specification
- `return/` — deployable application
- `return/lib/policy/` — pure policy gateway and 65 unit tests
- `return/lib/webmcp/` — 22 role-scoped WebMCP tool definitions and 26 registration tests
- `return/lib/assets/` — asset access rules and R2 storage
- `return/lib/community/` — contribution field declarations, shared by the form, review, and validation
- `return/db/` — D1 schema, per-workspace seeding, and the query layer
- `return/scripts/smoke.mjs` — end-to-end verification run
- `return/drizzle/` — inspected D1 schema migration

## Deployment

The application is a Cloudflare Worker. It needs two bound resources and one secret;
`npm run build` writes the binding names into `dist/server/wrangler.json`, so the only
thing to get right by hand is that the resources exist and the secret is set.

| Resource | Binding | Name |
| --- | --- | --- |
| D1 database | `DB` | `return-museum` |
| R2 bucket | `MEDIA` | `return-assets` |

A different account or a staging bucket can override the bucket name at build time with
`R2_ASSET_BUCKET`; nothing else varies.

### 1. Create the resources

```bash
npx wrangler r2 bucket create return-assets
```

The D1 database already exists and its id is committed in `vite.config.ts`.

### 2. Set the session secret

`SESSION_SECRET` signs the role and workspace cookies. **The Worker refuses to start in
production without it**, and it must be at least 32 characters. There is a development
fallback so local work needs no configuration; that fallback is deliberately unavailable
in production, because a predictable signing key would let anyone mint a curator session.

```bash
npx wrangler secret put SESSION_SECRET
```

### 3. Apply the migrations, in order, once each

```bash
npx wrangler d1 execute return-museum --remote --file=./drizzle/0000_return_foundation.sql
```

Then `0001_domain_records.sql`, `0002_governance_audit.sql`, `0003_consent_three_levels.sql`,
`0004_assets.sql`, and `0005_contribution_detail.sql`.

The SQL files are the reference schema. `ensureDatabase()` in `db/setup.ts` additionally
creates anything missing and backfills legacy columns on every boot, so a database that
falls behind repairs itself rather than failing — but the migrations are what the schema
is defined by.

### 4. Build and deploy

```bash
npm run build && npm run deploy
```

### 5. Check the deployment

```bash
npm run test:smoke -- https://<your-worker-url>
```

The suite runs against any origin and exercises the asset pipeline, so it is also the
check that the R2 binding resolved. It calls `/api/reset`, which creates a fresh
workspace and leaves the existing ones untouched.

## Known limitations

- Role switching is a deliberate demo affordance, not production authentication.
- RE:TURN does not determine illicit removal, transfer ownership, or execute physical return.
- The demo uses lightweight refresh behavior rather than a production event bus.
- WebMCP tools register only where the browser exposes `document.modelContext`. Where it is absent the console says so, and the same tools stay reachable over `/api/tools/`.
- File contribution accepts real uploads (images, PDFs, audio) stored in Cloudflare R2. Uploads are `restricted` and `private` until a curator opens them, and WebMCP tools still receive `asset_ids` rather than binary.

## License

MIT. See `LICENSE`.
