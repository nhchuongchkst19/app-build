# App Build Workflow

This repository hosts manually dispatched builders for EAS apps, Tauri apps,
and Electron desktop apps:

- `.github/workflows/build.yml`: Android and iOS EAS local builds.
- `.github/workflows/tauri.yml`: Windows, macOS, and Linux Tauri builds.
- `.github/workflows/electron.yml`: Windows, macOS, and Linux Electron builds,
  including MSIX packages on Windows.

## Build isolation

The workflow checks this repository out to `builder/` and the selected private
app repository to `app/`. Build commands run only from `app/`, so the target
app keeps its own Git metadata and cannot overwrite the workflow helpers.

The required `key` input is compared with the repository `KEY` secret before
the workflow checks out code or accesses any other build secret. The value is
never written to a workflow output or printed in logs. GitHub repository
permissions remain the primary access control; this shared key is an additional
guard for existing build clients.

## Artifact modes

- `none`: build without publishing the binary.
- `upload`: upload a GitHub Actions artifact for seven days.
- `loadlyio`: upload to Loadly and notify Telegram.
- `submit`: submit with EAS and notify Telegram after success.

The Tauri workflow supports `none` and `upload`. Upload mode publishes every
bundle produced by Tauri as a GitHub Actions artifact, including NSIS, MSI,
DMG, AppImage, DEB, and RPM bundles when enabled by the selected project.
The Electron workflow also supports `none` and `upload`; it uploads the
project's Electron Forge `out/make` output, or the unpacked `out` directory for
the `package` task.

## Electron builds

The Electron workflow supports `make`, `package`, and `msix` tasks. Target
projects must declare Electron, commit exactly one supported JavaScript
lockfile, and provide the corresponding `make`, `package`, or `make:msix`
package script. MSIX builds are restricted to `windows-latest`.

Use `project_path` for Electron applications inside monorepos. The workflow
supports pnpm, Yarn, npm, and Bun, Node.js 22 or 24, and native, x64, ARM64, or
IA32 packaging. If the project has a `validate` script, it runs before the
package build.

Project-specific variables can be stored in the optional
`ELECTRON_BUILD_ENV` secret with one `NAME=value` entry per line. Optional
Windows signing uses `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD`; the decoded certificate path is exposed to the
project as `WINDOWS_CERTIFICATE_FILE`.

## Tauri builds

The Tauri workflow is project-independent. Select the runner OS, optionally
provide a Rust target triple, and use `bundles: project` to honor the target
repository's `tauri.conf` bundle settings. `project_path` supports Tauri apps
at the repository root and inside monorepos.

It detects pnpm, Yarn, npm, Bun, and Cargo-only projects from committed
lockfiles. Linux builds support Tauri v1 (WebKitGTK 4.0) and Tauri v2
(WebKitGTK 4.1); automatic detection uses `Cargo.lock`, and the dispatch input
can override it when a lockfile is unavailable.

Project-specific build variables can be stored in the optional
`TAURI_BUILD_ENV` secret, with one `NAME=value` entry per line. Updater signing
uses the standard `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets. Code-signing configuration for
Windows or macOS remains owned by each target project.

## Cache security

Package-manager caches are intentionally not persisted because the workflow
can build private repositories. Gradle and CocoaPods caches are enabled only
when this builder repository is private. This prevents a public pull request
from restoring cache entries that may contain private dependencies or compiled
app code.

For the best build performance, make this repository private. Existing caches
created while it was public should be deleted separately after confirming they
are no longer needed.

## App versions

The local helper updates only the platform being built. On GitHub it derives a
monotonically increasing value from `GITHUB_RUN_NUMBER` and
`GITHUB_RUN_ATTEMPT`, while ensuring it never lowers an existing numeric build
version. It skips projects that use `cli.appVersionSource: "remote"`, which is
the recommended configuration for production auto-incrementing in EAS.
