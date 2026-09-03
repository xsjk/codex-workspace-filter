const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");
const { isPatched, patchSource, sha256 } = require("./patcher");
const { acquireLock, recoverInterruptedReplace, replaceFile } = require("./file-operations");

const PATCH_OWNER = `${packageJson.publisher}.${packageJson.name}`;
const REPORT_ISSUE_URL = `${packageJson.repository.url.replace(/\.git$/, "")}/issues/new`;
const TARGET = "openai.chatgpt";
const BACKUP_SUFFIX = ".codex-workspace-filter.bak";
const LEGACY_BACKUP_SUFFIX = ".bak";

function targetPaths() {
    const targetExtension = vscode.extensions.getExtension(TARGET);
    if (!targetExtension) {
        throw new Error("OpenAI Codex extension was not found in this extension host.");
    }
    const mainPath = path.join(targetExtension.extensionPath, "out", "extension.js");
    return {
        mainPath,
        backupPath: `${mainPath}${BACKUP_SUFFIX}`,
        legacyBackupPath: `${mainPath}${LEGACY_BACKUP_SUFFIX}`,
        lockPath: `${mainPath}.codex-workspace-filter.lock`,
    };
}

async function applyPatch(notify = true) {
    const paths = targetPaths();
    const release = acquireLock(paths.lockPath);
    try {
        recoverInterruptedReplace(paths.mainPath);
        recoverInterruptedReplace(paths.backupPath);
        const source = fs.readFileSync(paths.mainPath, "utf8");
        const result = patchSource(source, PATCH_OWNER);
        if (result.status === "already-patched") return false;
        if (result.status === "incompatible") {
            vscode.window.showWarningMessage(`Codex Workspace Filter is not compatible with this Codex build. Missing: ${result.missing.join(", ")}`, "Report Issue").then((selection) => {
                if (selection === "Report Issue") vscode.env.openExternal(vscode.Uri.parse(REPORT_ISSUE_URL));
            });
            return false;
        }

        replaceFile(paths.backupPath, source);
        if (sha256(fs.readFileSync(paths.backupPath)) !== result.originalHash) throw new Error("backup verification failed");
        try {
            replaceFile(paths.mainPath, result.source);
            if (sha256(fs.readFileSync(paths.mainPath)) !== result.patchedHash) throw new Error("patched file verification failed");
        } catch (error) {
            replaceFile(paths.mainPath, source);
            throw error;
        }
    } finally {
        release();
    }
    if (notify) vscode.window.showInformationMessage("Codex chat history is now scoped to this workspace.");
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
    return true;
}

async function restorePatch() {
    const paths = targetPaths();
    const release = acquireLock(paths.lockPath);
    let backup;
    let selectedBackupPath;
    try {
        recoverInterruptedReplace(paths.mainPath);
        const current = fs.readFileSync(paths.mainPath, "utf8");
        if (!isPatched(current)) {
            vscode.window.showWarningMessage("Codex was not restored because its entrypoint is no longer our patched file (it may have updated).");
            return false;
        }
        selectedBackupPath = [paths.backupPath, paths.legacyBackupPath].find((candidate) => fs.existsSync(candidate));
        if (!selectedBackupPath) {
            vscode.window.showWarningMessage("Codex is patched, but no recovery backup exists. Reinstall Codex to restore it safely.");
            return false;
        }
        recoverInterruptedReplace(selectedBackupPath);
        backup = fs.readFileSync(selectedBackupPath, "utf8");
        if (isPatched(backup) || !backup.includes('"use strict";')) {
            vscode.window.showWarningMessage("The recovery backup is invalid. Reinstall Codex to restore it safely.");
            return false;
        }
        replaceFile(paths.mainPath, backup);
        if (sha256(fs.readFileSync(paths.mainPath)) !== sha256(backup)) throw new Error("restore verification failed");
        fs.rmSync(paths.backupPath, { force: true });
        fs.rmSync(paths.legacyBackupPath, { force: true });
    } finally {
        release();
    }
    vscode.window.showInformationMessage(`Restored the original Codex extension (${sha256(backup).slice(0, 8)}).`);
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
    return true;
}

async function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("codexWorkspaceFilter.apply", () => applyPatch()),
        vscode.commands.registerCommand("codexWorkspaceFilter.restore", () => restorePatch()),
        vscode.commands.registerCommand("codexWorkspaceFilter.status", () => {
            const paths = targetPaths();
            recoverInterruptedReplace(paths.mainPath);
            const patched = isPatched(fs.readFileSync(paths.mainPath, "utf8"));
            const backedUp = fs.existsSync(paths.backupPath) || fs.existsSync(paths.legacyBackupPath);
            vscode.window.showInformationMessage(`Codex Workspace Filter: ${patched ? "active" : "inactive"}; recovery backup: ${backedUp ? "ready" : "none"}.`);
        }),
    );
    try {
        await applyPatch(false);
    } catch (error) {
        vscode.window.showWarningMessage(`Codex Workspace Filter could not start: ${error.message}`);
    }
}

module.exports = { activate, applyPatch, restorePatch };
