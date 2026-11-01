# Stable Version Suspension

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
