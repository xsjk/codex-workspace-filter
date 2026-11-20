# Codex Workspace Filter

Patches the OpenAI Codex VS Code extension so `thread/list` requests are filtered by the current VS Code workspace folders.

## Requirements

- VS Code: `^1.96.2`.
- OpenAI Codex extension (`openai.chatgpt`): `>=26.51117.31558`.

## Behavior

- Workspace open: Recent Tasks and native session picker surfaces show sessions for the current workspace folder or folders.
- No workspace open: Codex keeps showing the normal global `~/.codex` history.
- Existing sessions stay in the shared Codex home.
- `codex` CLI usage is unchanged.

## How It Works

Codex already records `cwd` for sessions, and `thread/list` already accepts a `cwd` filter as a string or an array of strings.

The workspace filter applies in three places.

1. App Server Manager's Recent Tasks query.
2. Recent Tasks visibility check for cached sessions.
3. Native VS Code ChatSession picker query.

The injected filter uses the Codex extension's existing workspace-root helper, so it follows the same path normalization behavior as Codex itself.

On patch, this extension writes an exact backup next to the Codex extension entrypoint:

```text
out/extension.js.bak
```

If this extension is disabled or uninstalled, the injected bootstrap restores that backup and restarts the extension host.

## Scope

Important: use only global Enable/Disable for this extension. Do not use workspace-specific Enable/Disable. The extension must run in the workspace/remote extension host, but the patch itself affects the installed OpenAI Codex extension in that extension host.

The patch is reapplied after Codex extension updates overwrite `out/extension.js`. When this extension updates, it rebuilds its patch from the original backup.
