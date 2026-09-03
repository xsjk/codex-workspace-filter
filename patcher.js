const crypto = require("crypto");

const MARK_START = "/* codex-workspace-filter:begin */";
const MARK_END = "/* codex-workspace-filter:end */";

const WORKSPACE_ROOT_HELPER_PATTERN = /function ([A-Za-z_$][\w$]*)\(\)\{let t=[A-Za-z_$][\w$]*\.workspace\.workspaceFolders\?\.filter\([^;]+\)\.map\(\(\{uri:r\}\)=>r\.fsPath\)\?\?\[\];return [A-Za-z_$][\w$]*\(\)\?t\.map\([A-Za-z_$][\w$]*\):t\}/;

const PATCHES = [
  {
    name: "Recent Tasks bridge",
    pattern: /case"mcp-request":\{let\{id:n,method:o,params:i\}=r\.request;this\.pendingMcpRequests\.set\(String\(n\),e\),this\.codexMcpConnection\.sendRequest\(([A-Za-z_$][\w$]*),String\(n\),o,i,r\.retainResponse\);break\}/,
    replace: (helper, _match, transport) => `case"mcp-request":{let{id:n,method:o,params:i}=r.request;if(o==="thread/list"&&i&&i.cwd==null){let s=${helper}();s.length>0&&(i={...i,cwd:s})}this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(${transport},String(n),o,i,r.retainResponse);break}`,
  },
  {
    name: "native session picker",
    pattern: /return this\.codexAppServer\.sendRequest\(([A-Za-z_$][\w$]*),r,"thread\/list",\{limit:50,cursor:null,sortKey:"created_at",modelProviders:e\?\[([A-Za-z_$][\w$]*)\]:null,archived:!1,sourceKinds:([A-Za-z_$][\w$]*),useStateDbOnly:!0\}\),n/,
    replace: (helper, _match, transport, provider, sourceKinds) => `let s=${helper}(),a={limit:50,cursor:null,sortKey:"created_at",modelProviders:e?[${provider}]:null,archived:!1,sourceKinds:${sourceKinds},useStateDbOnly:!0};return s.length>0&&(a={...a,cwd:s}),this.codexAppServer.sendRequest(${transport},r,"thread/list",a),n`,
  },
  {
    name: "conversation previews",
    pattern: /o=\{limit:e,cursor:null,sortKey:"created_at",modelProviders:\[\],archived:!1,sourceKinds:([A-Za-z_$][\w$]*),useStateDbOnly:!0\};return this\.codexMcpConnection\.sendRequest\(([A-Za-z_$][\w$]*),r,"thread\/list",o\),n/,
    replace: (helper, _match, sourceKinds, transport) => `o={limit:e,cursor:null,sortKey:"created_at",modelProviders:[],archived:!1,sourceKinds:${sourceKinds},useStateDbOnly:!0};let a=${helper}();return a.length>0&&(o={...o,cwd:a}),this.codexMcpConnection.sendRequest(${transport},r,"thread/list",o),n`,
  },
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function patchSource(source, owner) {
  if (source.includes(MARK_START)) return { status: "already-patched", source };

  const helperMatch = source.match(WORKSPACE_ROOT_HELPER_PATTERN);
  const missing = helperMatch ? [] : ["workspace root helper"];
  let output = source;

  if (helperMatch) {
    for (const patch of PATCHES) {
      if (!patch.pattern.test(output)) missing.push(patch.name);
      else output = output.replace(patch.pattern, (...args) => patch.replace(helperMatch[1], ...args));
    }
  }

  if (missing.length) return { status: "incompatible", missing };
  if (!output.includes('"use strict";')) return { status: "incompatible", missing: ['"use strict" header'] };

  const bootstrap = `${MARK_START}\n(() => {\n  const fs = require("fs"), vscode = require("vscode");\n  if (vscode.extensions.getExtension(${JSON.stringify(owner)})) return;\n  const backup = __filename + ".codex-workspace-filter.bak";\n  if (!fs.existsSync(backup)) return;\n  fs.copyFileSync(backup, __filename);\n  vscode.commands.executeCommand("workbench.action.restartExtensionHost");\n})();\n${MARK_END}`;
  output = output.replace('"use strict";', `"use strict";\n${bootstrap}`);
  return { status: "patched", source: output, originalHash: sha256(source), patchedHash: sha256(output) };
}

function isPatched(source) {
  return source.includes(MARK_START) && source.includes(MARK_END);
}

module.exports = { MARK_START, MARK_END, PATCHES, isPatched, patchSource, sha256 };
