# Fork notes

This public branch is derived from
[`baairon/torlink`](https://github.com/baairon/torlink) at commit
`b8f8872b4e0a56d91326f4751955fce2eb12d78c`. The upstream project is
Copyright 2026 bairon.dev and is licensed under the MIT License.

## Material changes

- Hardened input, source selection, persistence, deletion, and VPN-gating
  behavior.
- Replaced the in-process WebTorrent engine with a TorLink-owned,
  localhost-only Transmission daemon and typed RPC client.
- Added pause, resume, verify, reconciliation, peer-count, and music-source
  behavior for the Transmission backend.
- Added generic macOS launch helpers and application-icon assets.
- Expanded automated coverage and added a real local Transmission smoke check.
- Updated dependency and repository metadata for the public fork.

The original upstream history and `LICENSE` are preserved. New fork commits
use the GitHub no-reply identity.
