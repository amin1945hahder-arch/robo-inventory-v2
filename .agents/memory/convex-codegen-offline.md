---
name: Offline Convex code generation
description: Generate local Convex API types in an imported workspace without deployment credentials.
---

For an imported workspace with no Convex CLI login, normal `convex codegen` may try to fetch deployment metadata and fail with 401. The CLI's `--system-udfs` mode generated the normal local API, server, and data-model files without pushing functions or needing deployment access; disable its optional typecheck when the generated types do not exist yet.

**Why:** The source can build and tests can run from local Convex definitions, but deployment metadata access is a separate authentication requirement and should not block local verification or trigger a remote push.

**How to apply:** Use this only for local code generation when deployment authentication is unavailable. Confirm the expected generated files exist, then run the project typecheck, tests, and build. Do not substitute `convex dev` when the intent is to avoid changing a deployment.
