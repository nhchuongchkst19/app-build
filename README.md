# App Build Workflow

This repository hosts the manually dispatched EAS local-build workflow in
`.github/workflows/build.yml`.

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
