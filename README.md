# Workbench · 工作台

A desktop-first personal workbench for choosing the next useful task and continuing it in an existing ChatGPT or Codex conversation. It combines coursework, research, applications, and collaboration without requiring a second progress journal.

This repository is a **sanitized source archive**. It contains the application and regression tests, not the owner's task database, documents, messages, account sessions, credentials, or private conversation history. Examples and identifiers are synthetic. It is separate from the running private installation.

## What is included

- Task categories, deadline-aware suggestions, compact completion receipts, and resume links.
- Versioned source imports and evidence-based checkpoints, with conflict detection and idempotent writes.
- A finite MCP interface for listing work, reading context, binding conversations, and recording actual progress.
- Optional film discoveries and milestone cards, kept separate from task completion.
- A web app manifest and application icons.
- In-memory database tests for source updates, execution, permissions, and synchronization.

The application does not run model inference, send email, submit coursework, or read private messaging accounts. External source collection and scheduled mail live outside this source archive. Connecting an account for sign-in does not provide a model API or access to existing conversations.

## Development

Use Node.js 24 or later and npm. Node.js 24+ is needed for the SQLite-backed test harness.

```sh
npm ci
npm run dev
```

The local development preview uses the supplied Sites/Vinext tooling. See [development notes](docs/development.md) for the starter's runtime, authentication, storage, and build details.

```sh
node --test tests/*.test.mjs
./node_modules/.bin/tsc --noEmit --incremental false
npm run build
```

Tests use an in-memory SQLite database and synthetic fixtures. They do not connect to the production database, send messages, or access account credentials. Do not set `STUDIO_SEED_PATH` to private data when producing public artifacts or logs.

## Configuration before personal use

The checked-in configuration is deliberately disconnected from any real installation:

- `.openai/hosting.json` declares storage and MCP capabilities without a Site project ID. Register your own private Site before deployment; do not reuse someone else's identity or access configuration.
- `lib/work-launch.ts` contains a small allowlist of illustrative `/workspace/...` directories. Replace it with directories you have verified locally; keep the allowlist rather than accepting arbitrary paths from a URL.
- `lib/admissions-tasks.ts` contains an example Feishu base/table and synthetic source associations. Configure your own source explicitly.
- `lib/lms-tasks.ts` uses an example school domain. A real importer must authenticate separately and validate its source identity.
- `lib/studio-store.ts` validates owner mail provenance against `owner@example.com`. Replace it with your own verified address if enabling that integration; this source does not send mail.
- Task contents, source excerpts, original conversation bindings, and progress belong in private runtime storage, never in source or migrations.

Hosted requests rely on the Sites platform's identity and private-service boundary. A self-hosted deployment must provide an equivalent trusted authentication boundary; do not trust identity headers supplied directly by arbitrary clients. This is a single-owner application, not a ready-made multi-tenant service.

## Structure

```text
app/           Pages and finite API/MCP routes
components/    Task, continuation, completion, and film UI
lib/           Task/source validation, progress, storage, and launch rules
db/            Database bindings and schema
drizzle/       Schema migrations only
public/        Icons, manifest, and visual assets
scripts/       Development/build helpers
build/         Included Sites/Vinext integration
tests/         Synthetic, in-memory regression tests
docs/          Development and archive notes
```

## Privacy and third-party material

See [SECURITY.md](SECURITY.md). Private Git history was not imported into this repository. Personal email addresses, home-directory paths, private source identifiers, project names, and the original hosting identity were replaced or omitted. Generated state, local sessions, source documents, logs, and database contents are excluded.

Film articles and images retain links to their original publishers; those materials remain subject to their owners' terms. Third-party code and styles retain their bundled license notices, including `build/sites-vite-plugin.LICENSE` and `vendor/shadcn-tailwind-4.13.0.LICENSE.md`. Making this repository public does not relicense third-party material.
