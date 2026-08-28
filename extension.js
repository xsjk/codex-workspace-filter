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

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const WORKSPACE_ROOT_HELPER_PATTERN = new RegExp(`function (${IDENTIFIER})\\(\\)\\{let t=${IDENTIFIER}\\.workspace\\.workspaceFolders\\?\\.filter\\([^;]+\\)\\.map\\(\\(\\{uri:r\\}\\)=>r\\.fsPath\\)\\?\\?\\[\\];return ${IDENTIFIER}\\(\\)\\?t\\.map\\(${IDENTIFIER}\\):t\\}`);

const PATCHES = [
    {
        name: "mcp-request thread/list bridge",
        pattern: new RegExp(`case"mcp-request":\\{let\\{id:n,method:o,params:i\\}=r\\.request;this\\.pendingMcpRequests\\.set\\(String\\(n\\),e\\),this\\.codexMcpConnection\\.sendRequest\\((${IDENTIFIER}),String\\(n\\),o,i,r\\.retainResponse\\);break\\}`),
        replace: (helperName, _match, transport) => `case"mcp-request":{let{id:n,method:o,params:i}=r.request;if(o==="thread/list"&&i&&i.cwd==null){let s=${helperName}();s.length>0&&(i={...i,cwd:s})}this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(${transport},String(n),o,i,r.retainResponse);break}`,
    },
    {
        name: "native ChatSession provider thread/list",
        pattern: new RegExp(`return this\\.codexAppServer\\.sendRequest\\((${IDENTIFIER}),r,"thread/list",\\{limit:50,cursor:null,sortKey:"created_at",modelProviders:e\\?\\[(${IDENTIFIER})\\]:null,archived:!1,sourceKinds:(${IDENTIFIER}),useStateDbOnly:!0\\}\\),n`),
        replace: (helperName, _match, transport, provider, sourceKinds) => `let s=${helperName}(),a={limit:50,cursor:null,sortKey:"created_at",modelProviders:e?[${provider}]:null,archived:!1,sourceKinds:${sourceKinds},useStateDbOnly:!0};return s.length>0&&(a={...a,cwd:s}),this.codexAppServer.sendRequest(${transport},r,"thread/list",a),n`,
    },
    {
        name: "ConversationPreviewLoader thread/list",
        pattern: new RegExp(`o=\\{limit:e,cursor:null,sortKey:"created_at",modelProviders:\\[\\],archived:!1,sourceKinds:(${IDENTIFIER}),useStateDbOnly:!0\\};return this\\.codexMcpConnection\\.sendRequest\\((${IDENTIFIER}),r,"thread/list",o\\),n`),
        replace: (helperName, _match, sourceKinds, transport) => `o={limit:e,cursor:null,sortKey:"created_at",modelProviders:[],archived:!1,sourceKinds:${sourceKinds},useStateDbOnly:!0};let a=${helperName}();return a.length>0&&(o={...o,cwd:a}),this.codexMcpConnection.sendRequest(${transport},r,"thread/list",o),n`,
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
