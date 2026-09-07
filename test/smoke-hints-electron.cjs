// Exercise the desktop network stack without opening a browser window or installer.
const { app, net } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const tempRoot = path.resolve(tmpdir());
const scratch = mkdtempSync(path.join(tempRoot, 'namu-hint-smoke-'));
app.setPath('userData', scratch);
app.whenReady().then(async () => {
  globalThis.fetch = (...args) => net.fetch(...args);
  let code=0;
  try { await import('./smoke-hints-online.mjs'); }
  catch (error) { console.error(error); code=1; }
  finally {
    // Remove only this test's exact, freshly created temporary profile.
    if (path.dirname(scratch)===tempRoot && path.basename(scratch).startsWith('namu-hint-smoke-')) {
      try { rmSync(scratch,{recursive:true,force:true}); } catch { /* Windows may briefly retain the network cache handle. */ }
    }
    app.exit(code);
  }
});
