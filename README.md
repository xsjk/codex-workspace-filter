# Codex Workspace Filter

Patches the OpenAI Codex VS Code extension so `thread/list` requests are filtered by the current VS Code workspace folders.

## Behavior

- Workspace open: Recent Tasks and native session picker surfaces show sessions for the current workspace folder or folders.
- No workspace open: Codex keeps showing the normal global `~/.codex` history.
- Existing sessions stay in the shared Codex home.
- `codex` CLI usage is unchanged.

## How It Works

Codex already records `cwd` for sessions, and `thread/list` already accepts a `cwd` filter as a string or an array of strings.

This extension patches three `thread/list` call sites in the OpenAI Codex VS Code extension:

1. Main Codex Recent Tasks webview bridge.
2. Native VS Code ChatSession provider.
3. Conversation preview loader.

The injected filter uses the Codex extension's existing workspace-root helper, so it follows the same path normalization behavior as Codex itself.

On patch, this extension writes an exact backup next to the Codex extension entrypoint:

```text
out/extension.js.codex-workspace-filter.bak
```

If this extension is uninstalled, the injected bootstrap restores that backup and restarts the extension host. Before disabling it, run **Codex Workspace Filter: Restore Original Codex** from the Command Palette.

## Scope

Important: use only global Enable/Disable for this extension. Do not use workspace-specific Enable/Disable. The extension must run in the workspace/remote extension host, but the patch itself affects the installed OpenAI Codex extension in that extension host.

The patch is reapplied after Codex extension updates overwrite `out/extension.js`.

## Safety and recovery

The extension first verifies every expected Codex call site, then writes and
verifies an exact backup before replacing the bundle. Recoverable file
transactions protect Windows installs from interrupted writes, and a lock keeps
multiple VS Code windows from patching concurrently. If Codex changes its
internal bundle, the operation fails closed and leaves Codex untouched.

Use **Codex Workspace Filter: Apply or Repair** or **Codex Workspace Filter:
Restore Original Codex** from the Command Palette. Restore is deliberately
refused if a Codex update has already replaced the patched file.

Use **Codex Workspace Filter: Show Status** to check both the active patch and
its recovery backup.

This is an interim compatibility patch, not an official OpenAI extension API.
Codex updates can require new signatures.

## Development

Run `npm test`. The repository's Windows CI exercises the patch engine and
recoverable file operations. To additionally compatibility-test a locally installed Codex bundle, set
`CODEX_EXTENSION_BUNDLE` to its `out/extension.js` path before running the tests.
