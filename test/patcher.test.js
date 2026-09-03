const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { isPatched, patchSource } = require("../patcher");

const installedBundle = process.env.CODEX_EXTENSION_BUNDLE;

const representativeBundle = '"use strict";'
  + 'function roots(){let t=vscode.workspace.workspaceFolders?.filter(x=>x).map(({uri:r})=>r.fsPath)??[];return remote()?t.map(normalize):t}'
  + 'case"mcp-request":{let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(channel,String(n),o,i,r.retainResponse);break}'
  + 'return this.codexAppServer.sendRequest(channel,r,"thread/list",{limit:50,cursor:null,sortKey:"created_at",modelProviders:e?[provider]:null,archived:!1,sourceKinds:kinds,useStateDbOnly:!0}),n'
  + 'o={limit:e,cursor:null,sortKey:"created_at",modelProviders:[],archived:!1,sourceKinds:kinds,useStateDbOnly:!0};return this.codexMcpConnection.sendRequest(channel,r,"thread/list",o),n';

test("patches every supported call site in a representative bundle", () => {
  const result = patchSource(representativeBundle, "xsjk.codex-workspace-filter");
  assert.equal(result.status, "patched");
  assert.equal(isPatched(result.source), true);
  assert.equal(result.source.includes('if(o==="thread/list"&&i&&i.cwd==null)'), true);
  assert.equal((result.source.match(/cwd:/g) || []).length, 3);
});

test("patches the installed Codex bundle when supplied", { skip: !installedBundle }, () => {
  let original = fs.readFileSync(installedBundle, "utf8");
  if (isPatched(original)) original = fs.readFileSync(`${installedBundle}.codex-workspace-filter.bak`, "utf8");
  const result = patchSource(original, "xsjk.codex-workspace-filter");
  assert.equal(result.status, "patched");
  assert.equal(isPatched(result.source), true);
  assert.equal(patchSource(result.source, "xsjk.codex-workspace-filter").status, "already-patched");
  assert.equal((result.source.match(/cwd:s/g) || []).length >= 2, true);
  assert.notEqual(result.originalHash, result.patchedHash);
});

test("refuses unknown bundles without changing them", () => {
  const original = '"use strict"; console.log("hello");';
  const result = patchSource(original, "xsjk.codex-workspace-filter");
  assert.equal(result.status, "incompatible");
  assert.equal(result.source, undefined);
  assert.ok(result.missing.length > 0);
});
