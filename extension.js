const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

const PATCH_OWNER = `${packageJson.publisher}.${packageJson.name}`;
const REPORT_ISSUE_URL = `${packageJson.repository.url.replace(/\.git$/, "")}/issues/new`;
const TARGET = "openai.chatgpt";
const MARK = "/* codex-workspace-filter:begin */";
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
        name: "mcp-request thread/list bridge",
        pattern: /(let\{id:n,method:o,params:i\}=r\.request;)(this\.pendingMcpRequests\.set\(String\(n\),[A-Za-z_$][\w$]*\),this\.codexMcpConnection\.sendRequest\([A-Za-z_$][\w$]*,String\(n\),o,i,r\.retainResponse\);break\})/,
        replace: (helperName, _match, declaration, dispatch) => `${declaration}if(o==="thread/list"&&i&&i.cwd==null){const workspaceRoots=${helperName}();if(workspaceRoots.length>0)i={...i,cwd:workspaceRoots}}${dispatch}`,
    },
    {
        name: "native ChatSession provider thread/list",
        pattern: /(async loadConversationItems\(([A-Za-z_$][\w$]*)\)\{)(let [A-Za-z_$][\w$]*=await this\.codexAppServer\.request\("thread\/list",\{limit:50,cursor:null,sortKey:"created_at",modelProviders:\2\?\[[A-Za-z_$][\w$]*\]:null,archived:!1,sourceKinds:[A-Za-z_$][\w$]*,useStateDbOnly:!0)\}\)/,
        replace: (helperName, _match, method, _parameter, request) => `${method}const workspaceRoots=${helperName}();${request},...(workspaceRoots.length>0?{cwd:workspaceRoots}:{})})`,
    },
    {
        name: "ConversationPreviewLoader thread/list",
        pattern: /(async fetchConversationPreviews\(\)\{)(let ([A-Za-z_$][\w$]*)=\{limit:50,cursor:null,sortKey:"created_at",modelProviders:\[\],archived:!1,sourceKinds:[A-Za-z_$][\w$]*,useStateDbOnly:!0)(\},[A-Za-z_$][\w$]*=await this\.codexMcpConnection\.request\("thread\/list",\3\))/,
        replace: (helperName, _match, method, params, _paramsName, request) => `${method}const workspaceRoots=${helperName}();${params},...(workspaceRoots.length>0?{cwd:workspaceRoots}:{})${request}`,
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
    const source = fs.readFileSync(mainPath, "utf8");
    if (source.includes(MARK)) return;

    const helperMatch = source.match(WORKSPACE_ROOT_HELPER_PATTERN);
    const helperName = helperMatch ? helperMatch[1] : null;
    let patched = source;
    const missing = helperName ? [] : ["workspace root helper"];
    if (helperName) {
        for (const patch of PATCHES) {
            if (!patch.pattern.test(patched)) {
                missing.push(patch.name);
                continue;
            }
            patched = patched.replace(patch.pattern, (...args) => patch.replace(helperName, ...args));
        }
    }

    if (missing.length > 0) {
        vscode.window.showWarningMessage(`Codex Workspace Filter did not patch Codex because expected patterns were missing: ${missing.join(", ")}`, "Report Issue").then((selection) => {
            if (selection === "Report Issue") vscode.env.openExternal(vscode.Uri.parse(REPORT_ISSUE_URL));
        });
        return;
    }

    if (!patched.includes('"use strict";')) {
        vscode.window.showWarningMessage('Codex Workspace Filter did not patch Codex because `"use strict";` was not found.');
        return;
    }

    patched = patched.replace('"use strict";', `"use strict";\n\n${BOOTSTRAP}\n`);

    fs.writeFileSync(backupPath, source, "utf8");
    fs.writeFileSync(mainPath, patched, "utf8");
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
}

module.exports = { activate };
