const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, session, nativeTheme } = require('electron');
const path = require('path');

// Disable default application menu globally so Windows never renders an in-window title/menu strip
Menu.setApplicationMenu(null);

// Force dark mode so Windows Acrylic applies dark glass instead of light milky wash
nativeTheme.themeSource = 'dark';

// Suppress non-critical WebRTC desktop capturer logs
app.commandLine.appendSwitch('log-level', '3');

let mainWindow = null;
let isAlwaysOnTop = false;

function createWindow() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(err => {
      console.error('DisplayMediaRequestHandler error:', err);
      callback({ error: err.message });
    });
  });

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 250,
    minWidth: 460,
    minHeight: 160,
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // Ensure no window menu bar or fallback title bar is attached
  mainWindow.setMenu(null);
  mainWindow.removeMenu();

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id
    }));
  } catch (error) {
    console.error('Error fetching desktop sources:', error);
    return [];
  }
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return false;
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
  return isAlwaysOnTop;
});

ipcMain.handle('get-always-on-top', () => {
  return isAlwaysOnTop;
});

ipcMain.handle('set-opacity', (event, opacity) => {
  if (mainWindow) {
    mainWindow.setOpacity(Math.max(0.15, Math.min(1.0, opacity)));
  }
});

ipcMain.handle('set-layout-mode', () => {
  // Mini Dock is the exclusive layout
  return 'dock';
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
