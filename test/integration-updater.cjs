'use strict';

// Exercise the real updater and its SHA-512 validation without ever starting an installer.
const assert = require('node:assert/strict');
const { createReadStream, mkdtempSync, readFileSync, statSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, session } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const yaml = require('js-yaml');
const { createUpdateController } = require('../src/updater-online.cjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'namu-race-updater-test-'));
app.setPath('userData', scratch);
const releaseDir = path.resolve(__dirname, '../release');
const metadata = yaml.load(readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8'));
const installedVersion = '0.4.1-beta.0';
let httpServer;
const deadline = setTimeout(() => {
  console.error('Updater integration test exceeded 90 seconds');
  app.exit(1);
}, 90_000);

function makeUpdater(name, feed) {
  const updater = new NsisUpdater(null, {
    version: installedVersion,
    name: 'namu-race-update-test',
    isPackaged: true,
    appUpdateConfigPath: path.join(releaseDir, 'win-unpacked/resources/app-update.yml'),
    userDataPath: path.join(scratch, name, 'data'),
    baseCachePath: path.join(scratch, name, 'cache'),
    whenReady: () => app.whenReady(),
    quit: () => assert.fail('This test must never quit for installation'),
    relaunch: () => assert.fail('This test must never relaunch'),
    onQuit: () => assert.fail('Automatic install on quit must be disabled'),
  });
  updater.httpExecutor = new ElectronHttpExecutor(() => {});
  updater.setFeedURL(feed);
  updater.disableDifferentialDownload = true;
  updater.logger = null;
  updater.quitAndInstall = () => assert.fail('This test must never launch an installer');
  const controller = createUpdateController({
    updater,
    currentVersion: installedVersion,
    notify: () => {},
    canInstall: () => false,
    confirmInstall: () => assert.fail('Installation is not permitted in this test'),
  });
  return { updater, controller };
}

async function run() {
  await app.whenReady();
  const useGitHub = process.argv.includes('--github');
  let feed = { provider: 'github', owner: 'YJH0501', repo: 'namu-race-online' };
  let corrupt = false;
  if (!useGitHub) {
    httpServer = createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.endsWith('.yml')) {
        const info = structuredClone(metadata);
        if (corrupt) {
          info.sha512 = createHash('sha512').update('invalid installer').digest('base64');
          info.files[0].sha512 = info.sha512;
        }
        response.end(yaml.dump(info));
      } else if (pathname === `/${metadata.files[0].url}`) {
        response.setHeader('content-length', metadata.files[0].size);
        createReadStream(path.join(releaseDir, metadata.files[0].url)).pipe(response);
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    feed = { provider: 'generic', url: `http://127.0.0.1:${httpServer.address().port}` };
  }

  const { updater, controller } = makeUpdater('valid', feed);
  let discoveredInfo;
  updater.on('update-available', (info) => { discoveredInfo = info; });
  await controller.check();
  assert.equal(controller.getState().phase, 'available', 'new version must be discovered');
  assert.equal(controller.getState().version, metadata.version);
  await controller.download();
  assert.equal(controller.getState().phase, 'downloaded', 'real installer must pass library checksum validation');
  assert.equal(statSync(updater.installerPath).size, discoveredInfo.files[0].size);
  await controller.install();
  assert.equal(controller.getState().phase, 'downloaded', 'an active room blocks installation');

  if (!useGitHub) {
    corrupt = true;
    const invalid = makeUpdater('invalid', feed);
    let checksumError = '';
    invalid.updater.on('error', (error) => { checksumError = error.message; });
    await invalid.controller.check();
    await invalid.controller.download();
    assert.equal(invalid.controller.getState().phase, 'error');
    assert.match(checksumError, /checksum mismatch/i);
    await invalid.controller.install();
    assert.equal(invalid.controller.getState().phase, 'error');
  }
  console.log(JSON.stringify({ ok: true, source: useGitHub ? 'public GitHub release' : 'local installer', version: metadata.version, checksumVerified: true, invalidChecksumRejected: !useGitHub, installerExecuted: false }));
}

async function finish(exitCode) {
  await session.defaultSession.closeAllConnections();
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  }
  clearTimeout(deadline);
  // Chromium can still hold profile files during process exit on Windows.
  // Leave this dedicated OS temp profile for normal temp/runner cleanup.
  app.exit(exitCode);
}

run().then(() => finish(0), (error) => {
  console.error(error);
  return finish(1);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
