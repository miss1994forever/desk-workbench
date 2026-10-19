# Backend regression checks

From the Site checkout, using Node.js 24 or later (verified with 26.7.0):

```sh
node --test tests/studio-store.test.mjs tests/studio-http.test.mjs tests/course-materials.test.mjs tests/next-action.test.mjs tests/academic-context.test.mjs
./node_modules/.bin/tsc --noEmit --incremental false
```

To also verify a private real seed without copying it into the source or writing
to the real database, set `STUDIO_SEED_PATH` to its absolute path when running
the same test command. That optional check imports only into in-memory SQLite.
The roundtrip checks compile the actual page's pure snapshot validator and copy
formatter, so a backend fixture cannot hide a frontend shape mismatch.

These tests remain in source. They use in-memory SQLite and stubbed platform
identity, not the hosted D1 database. They do not send mail, read credentials,
initialize the real workspace, or publish the Site.

Coverage includes same-origin browser writes, private-service request shapes,
body limits, one-time import, CAS races, retained conflicts, idempotency,
explicit confirmation and pause, mail provenance, pending review, immutable
material history, and event pagination. Hosted owner-private access must still
be verified separately at the Sites dispatch boundary.

Guided-work checks cover preserved step answers, stale-device raw text,
idempotent registration, self-reported session finishes, reopening with finish
history, immutable package content, suggested plan validation, named-source
freshness and failed-read preservation. They also exercise the workplan route's
service boundary. Guided work never confirms academic mastery or parent tasks.

Cinema collection checks cover ordinary saves, fact confirmations, session
summaries and task completion earning nothing. Only an explicitly selected
catalog milestone with owner-reported evidence can earn a persisted card.
Checks cover retries and repeat milestones, shared snapshots, Beijing-date selection, checked-in and
validated owner-curated card eligibility, and bounded collection exhaustion.
An exhausted static pool can receive verified intake additions; malformed URLs
remain ineligible, and browser actions cannot select a card. Cards are separate
from mastery, task completion, points, streaks, and notification permission.

The schema-only migration lives in `drizzle/`. Do not put seed material or user
replies in migrations or test fixtures.

Academic work is a desktop reference card with sourced deliverables, deadlines,
original course files and workspace locations. It has no parallel progress form,
required clipboard handoff, or text-pack download. New source mappings preserve
old goal history without inheriting completion from status checks. Source updates
cannot write owner progress, completion or movie awards. Local file changes must
not be interpreted as assignment submission. The legacy material export endpoint
remains available for old clients, without an entry in the normal work flow.
