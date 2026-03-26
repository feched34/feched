import { app, BrowserWindow, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

const SERVER_PORT = 5000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// Kök dizin: packaged → resources/, dev → proje kökü
function getRootDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..');
}

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const rootDir = getRootDir();
    const serverScript = path.join(rootDir, 'dist', 'index.js');

    console.log('[Electron] Starting server:', serverScript);

    serverProcess = spawn(process.execPath, [serverScript], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(SERVER_PORT),
      },
      cwd: rootDir,
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Server]', msg);
      // Sunucu başladığında resolve et
      if (msg.includes('serving') || msg.includes('listening') || msg.includes(':5000')) {
        resolve();
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Server ERR]', data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('[Electron] Server process error:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log('[Electron] Server exited with code', code);
    });

    // En fazla 10sn bekle, çıkmadıysa resolve et (farklı log formatı olabilir)
    setTimeout(resolve, 10000);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Goccord',
    icon: path.join(__dirname, '..', 'client', 'public', 'logo.png'),
    backgroundColor: '#0d0f1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false, // Hazır olunca göster
    titleBarStyle: 'default',
  });

  // Hazır olduğunda göster (beyaz flash önlenir)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Dış linkleri tarayıcıda aç
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function waitForServer(retries = 30, delay = 500): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(SERVER_URL);
      if (res.status < 500) return;
    } catch {
      // henüz hazır değil
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('Server did not start in time');
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Sunucuyu durdur
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
