# Stable Version Suspension

## Current Status: Suspended

Stable suspension was published at 2026-11-01 10:25:55 JST. Verified action:
https://github.com/okunukino1/claude01/actions/runs/41261008808

The source candidate is `1954da9c2f869e119b703c43c777a030e944131d`.
Only root HTML and worker were published. The test version remains test.128;
its HTML SHA-256 is `b042c0322675844b56435984e9ba3de8700f6f14cc87002c81157c922d53e7f5`.
Its worker SHA-256 is `96a80d280370e0dded59a516ce28775f9a70ab11e961fb955b350a3f61afd13a`.
Both stayed unchanged. Shared APIs and user data were not changed.

Actual original FTP bytes, candidate/staged/final byte checks, original
authorization, rollback files and cleanup results are retained in the task
workspace at `qa/stable-suspension-publication-20261101-102454/` and the private
Actions artifacts (30-day retention). UI/cache/data-retention fixtures are in
`qa/stable-suspension-20261101/`. Physical handset behavior is unverified.

The user explicitly requested that test remain usable and only stable be
temporarily suspended. This is not test-to-stable promotion.

## Scope

- Publish only root `index.html` and `service-worker.js`.
- Keep `test/`, shared APIs, data, photos, database, other apps, APKs and device
  settings unchanged. Do not load map or OCR libraries in the suspension page.
- The updated stable worker navigates only stable windows into the notice and
  never serves old cached stable HTML. It does not claim test/other scopes or
  delete caches, localStorage, IndexedDB or subscriptions.
- An already-open old screen on a device that stays offline or has not received
  the worker update cannot be remotely forced to change.

## Recovery

The previous active source is commit
`0a730ee5d8f6b93f3facdb64ec8c475d7ac86b60`, files
`delivery_map_mapbox/index.html` and `delivery_map_mapbox/service-worker.js`.
Retain both actual FTP files in private publication evidence, never as public
backup URLs. Recovery requires a user request and scoped verification. Never
re-enable stable as part of a test release.

## Publication

Use a candidate-pinned manual two-file FTPS publisher, not whole-directory
deployment. Save commits with `[skip ci]`; verify test HTML/worker hashes before
and after, retain rollback evidence, and hold the shared publication lock.

Apply the full approval-original section in
`C:\Users\okunuki.WIN-GPOOKKLFI3J\Desktop\Codex\homeapplication\app-updater\docs\SOURCE-OWNED-RELEASES.md`.
The explicit stable-only answer supersedes the earlier ambiguous request and
does not authorize disabling test.
