# TorLink macOS launcher

`TorLink.app` is a generated, local-only launcher for this checkout. Build and
validate it from the repository root:

```sh
npm run build:macos-app
npm run verify:macos-app
```

The native AppleScript applet opens the tracked `Open TorLink.command` file in
Terminal. That command continues through `open-torlink.sh`, preserving TorLink's
Node and Transmission preflight checks, Surfshark gate, existing state folder,
and managed-daemon shutdown behavior.

The generated bundle is ignored by Git. It stores the absolute checkout path so
you can copy it into Applications or add it to the Dock. Rebuild the bundle if
the checkout moves. The build applies an ad-hoc local signature; it is not a
notarized artifact for distribution to other Macs.

Avoid opening more than one TorLink window at a time because TorLink's persisted
queue is designed for a single running TUI process.

## Portable transfer build

The separate portable release does not use `project-root` and does not depend on
the checkout after it is built:

```sh
npm run build:macos-portable
npm run verify:macos-portable
```

The builder downloads and checksum-verifies the pinned official Node.js archive;
set `TORLINK_NODE_ARCHIVE` to use an existing archive instead. It accepts only
the pinned Transmission 4.1.3 binary and dynamic-library checksums. TorLink and
its production packages are built in a temporary clean workspace using
`npm ci` and the tracked `package-lock.json`. It packages built TorLink code and
production packages, Node.js, `transmission-daemon`, the
daemon's non-system dynamic libraries, the app icon, and available license
texts into `release/TorLink.app`. It also creates the metadata-preserving
transfer archive `release/TorLink-macOS-Apple-Silicon.zip`. A signed release
manifest inventories and hashes the Node, Transmission, library, and JavaScript
runtime payloads.

The verifier checks the app and a newly extracted ZIP copy: bundle metadata,
icon and versions, executable version probes, pinned payload hashes, exact
relocatable Transmission load paths, deployment targets, licenses, and deep
signatures. A live Transmission RPC smoke test can also be run against the
bundled backend with:

```sh
PATH="$PWD/release/TorLink.app/Contents/Resources/bin:$PATH" npm run verify:transmission
```

The resulting artifact is Apple-silicon only. Its declared minimum macOS version
is computed from the bundled binaries; with the current Homebrew Transmission
libraries that is macOS 26.0.

State remains in the destination user's normal Library folders, and downloads
default to that user's Downloads folder. No existing settings, queue, history,
or download data are embedded. Surfshark gating remains enabled by default.
Because this local package is ad-hoc signed and not notarized, the destination
user may need to right-click the app and choose **Open** the first time.
