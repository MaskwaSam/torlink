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
