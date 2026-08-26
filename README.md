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
- Consent is independent: `private`, `research_only`, `public_anonymous`, or `public_attributed`.
- Actions are classified as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. High-risk publication work becomes an approval request; critical legal, deletion, disclosure, and physical-return actions are not available to agents.

## Local development

```bash
cd return
npm install
npm run dev
```

The generated Sites project uses a local D1 database binding. Useful checks:

```bash
npm test
npm run lint
npm run build
```

## Repository map

- `RETURN_PLAN.md` — full product and technical specification
- `return/` — deployable application
- `return/lib/policy/` — pure policy gateway and 35 unit tests
- `return/lib/webmcp/` — 18 role-scoped WebMCP registrations
- `return/drizzle/` — inspected D1 schema migration

## Known limitations

- Role switching is a deliberate demo affordance, not production authentication.
- RE:TURN does not determine illicit removal, transfer ownership, or execute physical return.
- The demo uses lightweight refresh behavior rather than a production event bus.
- File contribution is represented with a prepared fictional asset and metadata; arbitrary binary upload is outside this MVP.

## License

MIT. See `LICENSE`.
