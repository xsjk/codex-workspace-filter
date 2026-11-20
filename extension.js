const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

const PATCH_OWNER = `${packageJson.publisher}.${packageJson.name}`;
const REPORT_ISSUE_URL = `${packageJson.repository.url.replace(/\.git$/, "")}/issues/new`;
const TARGET = "openai.chatgpt";
const MARK_PREFIX = "/* codex-workspace-filter:begin ";
const MARK = `${MARK_PREFIX}v${packageJson.version} */`;
const BACKUP_SUFFIX = ".bak";

const BOOTSTRAP = `${MARK}
(() => {
    const fs = require("fs"), vscode = require("vscode");
    if (vscode.extensions.getExtension("${PATCH_OWNER}")) return;
    const backup = __filename + "${BACKUP_SUFFIX}";
    if (!fs.existsSync(backup)) return;
    fs.copyFileSync(backup, __filename);
    vscode.commands.executeCommand("workbench.action.restartExtensionHost");
})();
/* codex-workspace-filter:end */`;

const WORKSPACE_ROOT_HELPER_PATTERN = /function ([A-Za-z_$][\w$]*)\(\)\{return [A-Za-z_$][\w$]*\.workspace\.workspaceFolders\?\.filter\([^;]+\)\.map\(\(\{uri:([A-Za-z_$][\w$]*)\}\)=>\2\.fsPath\)\?\?\[\]\}/;

const PATCHES = [
    {
        name: "App Server Manager recent threads",
        pattern: /(async function [A-Za-z_$][\w$]*\([^{}]+\{originators:[^{}]+\}\)\{)(let [A-Za-z_$][\w$]*=await [A-Za-z_$][\w$]*\(\{[^{}]+useStateDbOnly:!0)(?=\},[A-Za-z_$][\w$]*\?\{priority:"background",source:"recent_threads"\}:\{source:"recent_threads"\}\))/,
        replace: (helperName, _match, method, request) => `${method}const workspaceRoots=${helperName}();${request},...(workspaceRoots.length>0?{cwd:workspaceRoots}:{})`,
    },
    {
        name: "App Server Manager recent thread visibility",
        pattern: /(shouldSurfaceRecentConversation\(([A-Za-z_$][\w$]*)\)\{)return(?=!this\.isConversationSuppressed\(\2\.id\)&&\2\.ephemeral!==!0)/,
        replace: (helperName, _match, method, conversation) => `${method}const workspaceRoots=${helperName}();return (workspaceRoots.length===0||workspaceRoots.includes(${conversation}.cwd))&&`,
    },
    {
        name: "native ChatSession provider thread/list",
        pattern: /(async loadConversationItems\(([A-Za-z_$][\w$]*)\)\{)(let [A-Za-z_$][\w$]*=await this\.codexAppServer\.request\("thread\/list",\{limit:50,cursor:null,sortKey:"created_at",modelProviders:\2\?\[[A-Za-z_$][\w$]*\]:null,archived:!1,sourceKinds:[A-Za-z_$][\w$]*,useStateDbOnly:!0)\}\)/,
        replace: (helperName, _match, method, _parameter, request) => `${method}const workspaceRoots=${helperName}();${request},...(workspaceRoots.length>0?{cwd:workspaceRoots}:{})})`,
    },
];

async function activate() {
    const targetExtension = vscode.extensions.getExtension(TARGET);
    if (!targetExtension) {
        vscode.window.showWarningMessage("Codex Workspace Filter could not find the OpenAI Codex extension.");
        return;
    }

    const mainPath = path.join(targetExtension.extensionPath, "out", "extension.js");
    const backupPath = `${mainPath}${BACKUP_SUFFIX}`;
    const installed = fs.readFileSync(mainPath, "utf8");
    if (installed.includes(MARK)) return;
    const alreadyPatched = installed.includes(MARK_PREFIX);

    let source = installed;
    if (alreadyPatched) {
        if (!fs.existsSync(backupPath)) {
            vscode.window.showWarningMessage("Codex Workspace Filter could not update the patch because the original Codex backup is missing. Reinstall the Codex extension to restore it.");
            return;
        }
        source = fs.readFileSync(backupPath, "utf8");
    }

    let patched = source.replace(/^"use strict";/, (directive) => `${directive}\n\n${BOOTSTRAP}\n`);
    const missing = patched === source ? ['"use strict";'] : [];
    const helperName = source.match(WORKSPACE_ROOT_HELPER_PATTERN)?.[1];
    if (helperName) {
        for (const { name, pattern, replace } of PATCHES) {
            const next = patched.replace(pattern, (...args) => replace(helperName, ...args));
            if (next === patched) missing.push(name);
            patched = next;
        }
    } else {
        missing.push("workspace root helper");
    }

    if (missing.length > 0) {
        vscode.window.showWarningMessage(`Codex Workspace Filter did not patch Codex because expected patterns were missing: ${missing.join(", ")}`, "Report Issue").then((selection) => {
            if (selection === "Report Issue") vscode.env.openExternal(vscode.Uri.parse(REPORT_ISSUE_URL));
        });
        return;
    }

    if (!alreadyPatched) fs.writeFileSync(backupPath, source, "utf8");
    fs.writeFileSync(mainPath, patched, "utf8");
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
}

module.exports = { activate };
