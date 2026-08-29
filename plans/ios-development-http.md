# Feature: Allow HTTP for iOS Development Builds

## Overview

Add an idempotent build helper that enables unrestricted HTTP requests in
`app.json` only when the workflow builds iOS with the `development` profile.
If the target application does not contain `app.json`, the helper logs that it
was skipped and lets the build continue.

## Current Project Survey

- `.github/workflows/build.yml` checks out the selected application into `app/`,
  installs its dependencies, updates its native build version, and runs a local
  EAS build.
- Existing build helper scripts live in `.github/scripts/` and use dependency-free
  CommonJS Node.js.
- `.github/scripts/update-app-version.cjs` already establishes the convention of
  accepting the application directory as an argument and safely skipping when
  `app.json` is absent.
- The target application checkout is temporary, so this adjustment affects only
  the current build and is not committed back to the application repository.

## Dependencies

- No new package or system dependency.
- Use the Node.js runtime already configured by the workflow.

## Architecture

- New helper: `.github/scripts/configure-ios-development-http.cjs`.
- Workflow condition: run only when `inputs.platform == 'ios'` and
  `inputs.profile == 'development'`.
- The helper receives `app` as its project directory, reads `app/app.json`, and
  ensures the following value exists:

  ```json
  {
    "expo": {
      "ios": {
        "infoPlist": {
          "NSAppTransportSecurity": {
            "NSAllowsArbitraryLoads": true
          }
        }
      }
    }
  }
  ```

- Existing sibling keys under `expo`, `ios`, `infoPlist`, and
  `NSAppTransportSecurity` remain unchanged.
- If `NSAllowsArbitraryLoads` is already `true`, the helper performs no write.
- If `app.json` does not exist, the helper exits successfully without changing
  any other configuration source.
- `app.config.js`, `app.config.ts`, and native `Info.plist` are explicitly out of
  scope. A dynamic config may override the value written to `app.json`.

## Tasks

- [x] Add the dependency-free CommonJS helper with validation, merge behavior,
  skip logging, and idempotent output.
- [x] Add a conditional workflow step after dependency installation and before
  the EAS build preparation steps.
- [x] Document the iOS development-only behavior and the `app.json` limitation
  in `README.md`.
- [x] Validate the helper with temporary fixtures covering missing `app.json`,
  missing nested objects, preservation of existing ATS keys, already-enabled
  HTTP, and malformed JSON.
- [x] Validate the workflow YAML and review the final diff for changes outside
  the intended files.

## Validation

- iOS + `development`: the helper runs and sets
  `NSAllowsArbitraryLoads: true` when `app.json` exists.
- iOS + any other profile: the workflow skips the helper.
- Android + any profile: the workflow skips the helper.
- Missing `app.json`: print a skip message and exit with status 0.
- Existing `NSAllowsArbitraryLoads: true`: print an already-configured message,
  leave the file byte-for-byte unchanged, and exit with status 0.
- Existing ATS sibling values: preserve them while adding or correcting
  `NSAllowsArbitraryLoads`.
- Invalid `app.json`: fail with a clear error rather than silently producing an
  incorrectly configured build.

## Notes

- `NSAllowsArbitraryLoads` broadly relaxes App Transport Security, so this helper
  is intentionally restricted to the exact `development` profile.
- The change is applied only to the temporary application checkout used by the
  workflow; it does not modify the source repository.
- No attempt will be made to prove the final resolved Expo config when a dynamic
  app config is present, per the agreed simplified scope.
- Validation completed with temporary Node.js fixtures, `node --check`,
  Prettier's YAML parser, and `git diff --check`.
