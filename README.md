# Codex Workspace Filter

Patches the OpenAI Codex VS Code extension so `thread/list` requests are filtered by the current VS Code workspace folders.

This is a smaller replacement for `codex-home-autopatch`. It does **not** change `CODEX_HOME`, split storage, or require session migration.

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

If this extension is disabled or uninstalled, the injected bootstrap restores that backup and restarts the extension host.

## Scope

Important: use only global Enable/Disable for this extension. Do not use workspace-specific Enable/Disable. The extension must run in the workspace/remote extension host, but the patch itself affects the installed OpenAI Codex extension in that extension host.

The patch is reapplied after Codex extension updates overwrite `out/extension.js`.
