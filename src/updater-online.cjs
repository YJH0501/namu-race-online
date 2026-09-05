'use strict';

// Keep update state in the main process. Only the trusted HUD may request an install.
function createUpdateController({ updater, currentVersion, unsupportedReason = '', notify, canInstall, confirmInstall }) {
  let state = {
    currentVersion,
    version: '',
    phase: unsupportedReason ? 'unsupported' : 'idle',
    reason: unsupportedReason,
    percent: 0,
    message: '',
  };
  let operation = null;
  let installing = false;
  const getState = () => ({ ...state });
  const publish = (patch) => {
    state = { ...state, ...patch };
    notify(getState());
  };
  const fail = () => publish({
    phase: 'error',
    message: '업데이트를 완료하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  });

  if (!unsupportedReason) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = currentVersion.includes('-');
    updater.disableWebInstaller = true;
    updater.on('checking-for-update', () => publish({ phase: 'checking', message: '', percent: 0 }));
    updater.on('update-available', (info) => publish({ phase: 'available', version: info.version, message: '' }));
    updater.on('update-not-available', () => publish({ phase: 'current', version: '', message: '' }));
    updater.on('download-progress', (progress) => publish({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
    }));
    updater.on('update-downloaded', (info) => publish({ phase: 'downloaded', version: info.version, percent: 100 }));
    updater.on('error', fail);
  }

  async function run(action) {
    if (unsupportedReason) return getState();
    if (operation) {
      await operation;
      return getState();
    }
    operation = Promise.resolve().then(action).catch(fail).finally(() => { operation = null; });
    await operation;
    return getState();
  }

  return {
    getState,
    async check() {
      if (installing || ['downloaded', 'installing', 'downloading'].includes(state.phase)) return getState();
      return run(() => updater.checkForUpdates());
    },
    async download() {
      if (state.phase !== 'available' || operation) return getState();
      return run(async () => {
        publish({ phase: 'downloading', percent: 0, message: '' });
        await updater.downloadUpdate();
      });
    },
    async install() {
      if (unsupportedReason || installing || state.phase !== 'downloaded') return getState();
      if (!canInstall()) {
        publish({ message: '방에서 나온 뒤 첫 화면에서 업데이트해 주세요.' });
        return getState();
      }
      installing = true;
      try {
        if (!await confirmInstall(state.version)) return getState();
        // A room request could have completed while the confirmation was open.
        if (!canInstall()) {
          publish({ message: '방에서 나온 뒤 첫 화면에서 업데이트해 주세요.' });
          return getState();
        }
        publish({ phase: 'installing', message: '' });
        updater.quitAndInstall(true, true);
      } catch {
        fail();
      } finally {
        installing = false;
      }
      return getState();
    },
  };
}

module.exports = { createUpdateController };
