import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdateController } from '../src/updater-online.cjs';

function fixture(options = {}) {
  const updater = new EventEmitter();
  const observed = [];
  const installs = [];
  const counters = { checks: 0, downloads: 0, confirms: 0 };
  const info = { version: '0.4.1-beta.2' };
  updater.checkForUpdates = async () => {
    counters.checks++;
    updater.emit('checking-for-update');
    updater.emit('update-available', info);
  };
  updater.downloadUpdate = async () => {
    counters.downloads++;
    updater.emit('download-progress', { percent: 47 });
    updater.emit('update-downloaded', info);
  };
  updater.quitAndInstall = (...args) => installs.push(args);
  const controller = createUpdateController({
    updater,
    currentVersion: '0.4.1-beta.1',
    notify: (value) => observed.push(value),
    canInstall: () => true,
    confirmInstall: async () => { counters.confirms++; return true; },
    ...options,
  });
  return { updater, controller, observed, installs, counters };
}

test('an update requires download and explicit restart; checks never install it', async () => {
  const { updater, controller, observed, installs, counters } = fixture();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.disableWebInstaller, true);
  await controller.install();
  await controller.check();
  assert.equal(controller.getState().phase, 'available');
  assert.equal(counters.downloads, 0);
  await controller.download();
  assert.equal(controller.getState().phase, 'downloaded');
  assert.ok(observed.some((state) => state.phase === 'downloading' && state.percent === 47));
  await controller.check();
  assert.equal(counters.checks, 1, 'a periodic check must not discard an already downloaded update');
  assert.deepEqual(installs, []);
  await controller.install();
  assert.deepEqual(installs, [[true, true]], 'replace silently, then relaunch');
});

test('room membership and a pending room request prevent installation', async () => {
  let inRoom = true;
  const { controller, installs, counters } = fixture({ canInstall: () => !inRoom });
  await controller.check();
  await controller.download();
  await controller.install();
  assert.equal(counters.confirms, 0);
  assert.deepEqual(installs, []);
  assert.equal(controller.getState().phase, 'downloaded');
  inRoom = false;
  await controller.install();
  assert.equal(installs.length, 1);
});

test('room state is checked again after confirmation', async () => {
  let ready = true;
  const { controller, installs } = fixture({
    canInstall: () => ready,
    confirmInstall: async () => { ready = false; return true; },
  });
  await controller.check();
  await controller.download();
  await controller.install();
  assert.deepEqual(installs, []);
  assert.equal(controller.getState().phase, 'downloaded');
});

test('cancelled confirmation keeps the downloaded update for later', async () => {
  const { controller, installs } = fixture({ confirmInstall: async () => false });
  await controller.check();
  await controller.download();
  await controller.install();
  assert.deepEqual(installs, []);
  assert.equal(controller.getState().phase, 'downloaded');
});

test('network/checksum failures cannot install and can be retried', async () => {
  const { updater, controller, installs } = fixture();
  await controller.check();
  const success = updater.downloadUpdate;
  updater.downloadUpdate = async () => {
    const error = new Error('sha512 checksum mismatch');
    updater.emit('error', error);
    throw error;
  };
  await controller.download();
  assert.equal(controller.getState().phase, 'error');
  await controller.install();
  assert.deepEqual(installs, []);
  updater.downloadUpdate = success;
  await controller.check();
  await controller.download();
  assert.equal(controller.getState().phase, 'downloaded');
});

test('concurrent clicks cannot start duplicate downloads or confirmations', async () => {
  const { controller, counters, installs } = fixture();
  await Promise.all([controller.check(), controller.check()]);
  assert.equal(counters.checks, 1);
  await Promise.all([controller.download(), controller.download()]);
  assert.equal(counters.downloads, 1);
  await Promise.all([controller.install(), controller.install()]);
  assert.equal(counters.confirms, 1);
  assert.equal(installs.length, 1);
});

test('stable releases do not opt into beta; unsupported targets never invoke an updater', async () => {
  assert.equal(fixture().updater.allowPrerelease, true);
  assert.equal(fixture({ currentVersion: '0.4.1' }).updater.allowPrerelease, false);
  const { controller } = fixture({ updater: null, unsupportedReason: 'platform' });
  await controller.check();
  await controller.download();
  await controller.install();
  assert.equal(controller.getState().phase, 'unsupported');
});
