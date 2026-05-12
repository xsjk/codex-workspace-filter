const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const PATCH_OWNER = "xsjk.codex-workspace-filter";
const TARGET = "openai.chatgpt";
const MARK = "/* codex-workspace-filter:begin */";
const BACKUP_SUFFIX = ".codex-workspace-filter.bak";

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

const PATCHES = [
    {
        name: "mcp-request thread/list bridge",
        from: 'case"mcp-request":{let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(k0,String(n),o,i);break}',
        to: 'case"mcp-request":{let{id:n,method:o,params:i}=r.request;if(o==="thread/list"&&i&&i.cwd==null){let s=M0();s.length>0&&(i={...i,cwd:s})}this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(k0,String(n),o,i);break}',
    },
    {
        name: "native ChatSession provider thread/list",
        from: 'return this.codexAppServer.sendRequest(J7,r,"thread/list",{limit:50,cursor:null,sortKey:"created_at",modelProviders:e?[nb]:null,archived:!1,sourceKinds:im}),n',
        to: 'let s=M0(),a={limit:50,cursor:null,sortKey:"created_at",modelProviders:e?[nb]:null,archived:!1,sourceKinds:im};return s.length>0&&(a={...a,cwd:s}),this.codexAppServer.sendRequest(J7,r,"thread/list",a),n',
    },
    {
        name: "ConversationPreviewLoader thread/list",
        from: 'o={limit:e,cursor:null,sortKey:"created_at",modelProviders:[],archived:!1,sourceKinds:im};return this.codexMcpConnection.sendRequest(uee,r,"thread/list",o),n',
        to: 'o={limit:e,cursor:null,sortKey:"created_at",modelProviders:[],archived:!1,sourceKinds:im};let a=M0();return a.length>0&&(o={...o,cwd:a}),this.codexMcpConnection.sendRequest(uee,r,"thread/list",o),n',
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

    let patched = source;
    const missing = [];
    for (const patch of PATCHES) {
        if (!patched.includes(patch.from)) {
            missing.push(patch.name);
            continue;
        }
        patched = patched.replace(patch.from, patch.to);
    }

    if (missing.length > 0) {
        vscode.window.showWarningMessage(`Codex Workspace Filter did not patch Codex because expected patterns were missing: ${missing.join(", ")}`);
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
