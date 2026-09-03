const fs = require("fs");

const LOCK_STALE_MS = 120_000;

function replaceFile(filePath, content) {
  const temporaryPath = `${filePath}.cwf-new`;
  const displacedPath = `${filePath}.cwf-old`;
  fs.rmSync(temporaryPath, { force: true });
  fs.rmSync(displacedPath, { force: true });

  let handle;
  try {
    handle = fs.openSync(temporaryPath, "wx");
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;

    if (fs.existsSync(filePath)) fs.renameSync(filePath, displacedPath);
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (!fs.existsSync(filePath) && fs.existsSync(displacedPath)) fs.renameSync(displacedPath, filePath);
      throw error;
    }
    fs.rmSync(displacedPath, { force: true });
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function recoverInterruptedReplace(filePath) {
  const temporaryPath = `${filePath}.cwf-new`;
  const displacedPath = `${filePath}.cwf-old`;
  if (!fs.existsSync(filePath) && fs.existsSync(displacedPath)) fs.renameSync(displacedPath, filePath);
  else if (fs.existsSync(filePath) && fs.existsSync(displacedPath)) fs.rmSync(displacedPath, { force: true });
  fs.rmSync(temporaryPath, { force: true });
}

function acquireLock(lockPath) {
  try {
    const handle = fs.openSync(lockPath, "wx");
    fs.writeFileSync(handle, `${process.pid}\n`, "utf8");
    return () => {
      fs.closeSync(handle);
      fs.rmSync(lockPath, { force: true });
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age <= LOCK_STALE_MS) throw new Error("another VS Code window is updating Codex; try again shortly");
    fs.rmSync(lockPath, { force: true });
    return acquireLock(lockPath);
  }
}

module.exports = { acquireLock, recoverInterruptedReplace, replaceFile };
