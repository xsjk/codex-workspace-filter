const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { acquireLock, recoverInterruptedReplace, replaceFile } = require("../file-operations");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cwf-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "extension.js");
}

test("replaceFile replaces an existing file and removes transaction files", (t) => {
  const target = fixture(t);
  fs.writeFileSync(target, "old");
  replaceFile(target, "new");
  assert.equal(fs.readFileSync(target, "utf8"), "new");
  assert.equal(fs.existsSync(`${target}.cwf-new`), false);
  assert.equal(fs.existsSync(`${target}.cwf-old`), false);
});

test("recoverInterruptedReplace restores a displaced target", (t) => {
  const target = fixture(t);
  fs.writeFileSync(`${target}.cwf-old`, "original");
  fs.writeFileSync(`${target}.cwf-new`, "partial");
  recoverInterruptedReplace(target);
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  assert.equal(fs.existsSync(`${target}.cwf-new`), false);
});

test("lock excludes concurrent writers", (t) => {
  const lock = fixture(t);
  const release = acquireLock(lock);
  assert.throws(() => acquireLock(lock), /another VS Code window/);
  release();
  const releaseAgain = acquireLock(lock);
  releaseAgain();
});
