const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { isPatched, sha256 } = require("../patcher");

const installedBundle = process.env.CODEX_EXTENSION_BUNDLE;

test("actual extension apply and restore round-trip", { skip: !installedBundle }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cwf-extension-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputDirectory = path.join(directory, "out");
  fs.mkdirSync(outputDirectory);
  const target = path.join(outputDirectory, "extension.js");
  let original = fs.readFileSync(installedBundle);
  if (isPatched(original.toString("utf8"))) {
    original = fs.readFileSync(`${installedBundle}.codex-workspace-filter.bak`);
  }
  fs.writeFileSync(target, original);

  const commands = [];
  const messages = [];
  const vscodeMock = {
    extensions: { getExtension: (id) => id === "openai.chatgpt" ? { extensionPath: directory } : undefined },
    commands: {
      executeCommand: async (command) => commands.push(command),
      registerCommand: () => ({ dispose() {} }),
    },
    window: {
      showInformationMessage: (message) => messages.push(message),
      showWarningMessage: (message) => messages.push(message),
    },
    env: { openExternal() {} },
    Uri: { parse: (value) => value },
  };

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => { Module._load = originalLoad; });

  const extensionPath = require.resolve("../extension");
  delete require.cache[extensionPath];
  const extension = require("../extension");

  assert.equal(await extension.applyPatch(), true);
  assert.equal(isPatched(fs.readFileSync(target, "utf8")), true);
  assert.equal(fs.existsSync(`${target}.codex-workspace-filter.bak`), true);

  assert.equal(await extension.restorePatch(), true);
  assert.equal(sha256(fs.readFileSync(target)), sha256(original));
  assert.equal(fs.existsSync(`${target}.codex-workspace-filter.bak`), false);
  assert.deepEqual(commands, ["workbench.action.restartExtensionHost", "workbench.action.restartExtensionHost"]);
  assert.equal(messages.length, 2);
});
