const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Suppress GPU and autofill errors
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');
app.commandLine.appendSwitch('disable-background-networking');

// Fix for macOS SIGTRAP issues
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('no-sandbox');
}

// Suppress console errors
process.on('uncaughtException', (error) => {
  // Only log non-GPU related errors
  if (!error.message.includes('SharedImageManager') &&
    !error.message.includes('mailbox') &&
    !error.message.includes('Autofill')) {
    console.error('Uncaught Exception:', error);
  }
});

let mainWindow;
let qemuProcesses = new Map();
let appSettings = null;
let usedVNCPorts = new Set(); // Track used VNC ports
let vmProcessInfo = new Map(); // Store VM info with processes

// Default settings
const defaultSettings = {
  qemuPath: '',
  qemuArch: 'x86_64',
  defaultMemory: 2048,
  defaultCPU: 2,
  defaultNetwork: 'user',
  defaultVNCPort: 0,
  vmDir: null, // null = use app.getPath('userData')/vms
  diskImageDir: '',
  isoDir: '',
  qemuExtraArgs: '',
  autoStartVNC: true,
  showQemuOutput: true,
  showQemuArgs: false,
  language: 'sk',
  startMinimized: false,
  minimizeToTray: false
};

// Load settings
function loadSettings() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      appSettings = { ...defaultSettings, ...JSON.parse(content) };
    } catch (error) {
      console.error('Error loading settings:', error);
      appSettings = { ...defaultSettings };
    }
  } else {
    appSettings = { ...defaultSettings };
    saveSettings();
  }
  return appSettings;
}

// Save settings
function saveSettings() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(appSettings, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { success: false, error: error.message };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Suppress console errors
      enableWebSQL: false,
      spellcheck: false
    },
    icon: (() => {
      // Use platform-specific icon
      let iconPath;
      if (process.platform === 'win32') {
        iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
      } else if (process.platform === 'darwin') {
        iconPath = path.join(__dirname, '..', 'assets', 'icon.icns');
      } else {
        iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
      }
      return fs.existsSync(iconPath) ? iconPath : undefined;
    })(),
    titleBarStyle: 'default',
    frame: true
  });

  // Log console messages from renderer (for debugging)
  mainWindow.webContents.on('console-message', (event, params) => {
    const { level, message, line, sourceId } = params;
    // Filter out GPU and autofill errors
    if (message && typeof message === 'string' && (
      message.includes('SharedImageManager') ||
      message.includes('mailbox') ||
      message.includes('Autofill') ||
      message.includes('gpu/command_buffer'))) {
      return; // Suppress these messages
    }
    // Log other messages for debugging
    if (level >= 2) { // 0=debug, 1=info, 2=warning, 3=error
      console.log(`[Renderer ${level === 2 ? 'WARN' : 'ERROR'}]`, message);
    }
  });

  // Log failed resource loads
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load resource:', validatedURL, errorDescription);
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill all QEMU processes before quitting
  qemuProcesses.forEach((process, id) => {
    try {
      process.kill();
    } catch (e) {
      console.error(`Error killing QEMU process ${id}:`, e);
    }
  });
  qemuProcesses.clear();
  usedVNCPorts.clear();
  vmProcessInfo.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for QEMU operations

// Check if QEMU is installed
ipcMain.handle('check-qemu', async () => {
  return new Promise((resolve) => {
    const arch = appSettings?.qemuArch || 'x86_64';
    const qemuPath = appSettings?.qemuPath;
    const command = qemuPath || `qemu-system-${arch}`;

    exec(`"${command}" --version`, (error, stdout, stderr) => {
      if (error) {
        resolve({ installed: false, error: error.message });
      } else {
        resolve({ installed: true, version: stdout.trim() });
      }
    });
  });
});

// Get list of VMs
ipcMain.handle('get-vms', async () => {
  const vmDir = appSettings?.vmDir || path.join(app.getPath('userData'), 'vms');
  if (!fs.existsSync(vmDir)) {
    fs.mkdirSync(vmDir, { recursive: true });
  }

  const files = fs.readdirSync(vmDir);
  const vms = files
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const content = fs.readFileSync(path.join(vmDir, file), 'utf8');
      return JSON.parse(content);
    });

  return vms;
});

// Save VM configuration
ipcMain.handle('save-vm', async (event, vmConfig) => {
  const vmDir = appSettings?.vmDir || path.join(app.getPath('userData'), 'vms');
  if (!fs.existsSync(vmDir)) {
    fs.mkdirSync(vmDir, { recursive: true });
  }

  const filename = `${vmConfig.id}.json`;
  const filepath = path.join(vmDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(vmConfig, null, 2));
  return { success: true };
});

// Delete VM
ipcMain.handle('delete-vm', async (event, vmId) => {
  const vmDir = appSettings?.vmDir || path.join(app.getPath('userData'), 'vms');
  const filepath = path.join(vmDir, `${vmId}.json`);

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return { success: true };
  }
  return { success: false, error: 'VM not found' };
});

// Start VM
ipcMain.handle('start-vm', async (event, vmConfig) => {
  return new Promise((resolve, reject) => {
    // Check if VM is already running
    if (qemuProcesses.has(vmConfig.id)) {
      reject({ success: false, error: 'VM is already running' });
      return;
    }

    // Determine display mode
    const displayMode = vmConfig.display?.mode || (appSettings?.autoStartVNC ? 'vnc' : 'none');

    // Determine VNC port only if display mode requires VNC
    let vncPort = null;
    if (displayMode === 'vnc' || displayMode === 'embedded') {
      vncPort = vmConfig.vnc?.port;
      if (!vncPort || vncPort === 0) {
        // Auto-assign port
        vncPort = findAvailableVNCPort();
      }

      // Check if port is already in use
      if (usedVNCPorts.has(vncPort)) {
        vncPort = findAvailableVNCPort(vncPort + 1);
      }
    }

    // Update VM config with assigned port and display mode
    const vmConfigWithPort = {
      ...vmConfig,
      display: {
        ...vmConfig.display,
        mode: displayMode
      },
      vnc: vncPort ? {
        ...vmConfig.vnc,
        port: vncPort
      } : vmConfig.vnc
    };

    const args = buildQemuArgs(vmConfigWithPort);
    const arch = appSettings?.qemuArch || 'x86_64';
    const qemuPath = appSettings?.qemuPath || `qemu-system-${arch}`;

    const qemuProcess = spawn(qemuPath, args, {
      stdio: appSettings?.showQemuOutput ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore']
    });

    qemuProcesses.set(vmConfig.id, qemuProcess);
    if (vncPort) {
      usedVNCPorts.add(vncPort);
    }

    // Store VM process info
    vmProcessInfo.set(vmConfig.id, {
      name: vmConfig.name,
      vncPort: vncPort,
      displayMode: displayMode,
      startTime: Date.now()
    });

    qemuProcess.on('error', (error) => {
      qemuProcesses.delete(vmConfig.id);
      if (vncPort) {
        usedVNCPorts.delete(vncPort);
      }
      vmProcessInfo.delete(vmConfig.id);
      reject({ success: false, error: error.message });
    });

    qemuProcess.on('exit', (code) => {
      qemuProcesses.delete(vmConfig.id);
      if (vncPort) {
        usedVNCPorts.delete(vncPort);
      }
      vmProcessInfo.delete(vmConfig.id);
      mainWindow.webContents.send('vm-stopped', vmConfig.id);
    });

    // Send QEMU command info if enabled
    if (appSettings?.showQemuArgs) {
      const commandInfo = `\n=== QEMU Command ===\n${qemuPath} ${args.join(' ')}\n===================\n\n`;
      mainWindow.webContents.send('vm-output', {
        id: vmConfig.id,
        output: commandInfo
      });
    }

    // Send output to renderer
    if (appSettings?.showQemuOutput) {
      qemuProcess.stdout.on('data', (data) => {
        mainWindow.webContents.send('vm-output', {
          id: vmConfig.id,
          output: data.toString()
        });
      });

      qemuProcess.stderr.on('data', (data) => {
        mainWindow.webContents.send('vm-output', {
          id: vmConfig.id,
          output: data.toString()
        });
      });
    }

    // Build full command for display
    const fullCommand = `${qemuPath} ${args.join(' ')}`;

    // Notify renderer about VM started
    mainWindow.webContents.send('vm-started', {
      id: vmConfig.id,
      vncPort: vncPort,
      displayMode: displayMode,
      pid: qemuProcess.pid,
      qemuArgs: args,
      qemuCommand: fullCommand
    });

    resolve({
      success: true,
      pid: qemuProcess.pid,
      vncPort: vncPort,
      displayMode: displayMode,
      qemuArgs: args,
      qemuCommand: fullCommand
    });
  });
});

// Stop VM
ipcMain.handle('stop-vm', async (event, vmId) => {
  const process = qemuProcesses.get(vmId);
  if (process) {
    try {
      const info = vmProcessInfo.get(vmId);
      process.kill('SIGTERM');
      qemuProcesses.delete(vmId);
      if (info && info.vncPort) {
        usedVNCPorts.delete(info.vncPort);
      }
      vmProcessInfo.delete(vmId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'VM process not found' };
});

// Get VM status
ipcMain.handle('get-vm-status', async (event, vmId) => {
  const process = qemuProcesses.get(vmId);
  const info = vmProcessInfo.get(vmId);
  return {
    running: process !== undefined,
    pid: process ? process.pid : null,
    vncPort: info ? info.vncPort : null,
    displayMode: info ? info.displayMode : null
  };
});

// Get all running VMs
ipcMain.handle('get-running-vms', async () => {
  const runningVMs = [];
  vmProcessInfo.forEach((info, vmId) => {
    const process = qemuProcesses.get(vmId);
    if (process) {
      runningVMs.push({
        id: vmId,
        name: info.name,
        pid: process.pid,
        vncPort: info.vncPort,
        displayMode: info.displayMode
      });
    }
  });
  return runningVMs;
});

// Find available VNC port
function findAvailableVNCPort(startPort = 5900) {
  let port = startPort;
  const maxPort = 5999;

  while (port <= maxPort) {
    if (!usedVNCPorts.has(port)) {
      // Check if port is actually available (optional, can be slow)
      return port;
    }
    port++;
  }

  // If no port found in range, start from beginning
  port = 5900;
  while (port < startPort && port <= maxPort) {
    if (!usedVNCPorts.has(port)) {
      return port;
    }
    port++;
  }

  // Fallback: use random port in valid range (5900-5999)
  return Math.floor(Math.random() * 100) + 5900;
}

// Build QEMU command arguments from VM config
function buildQemuArgs(vmConfig) {
  const args = [];
  const isAndroid = vmConfig.type === 'android';

  // Memory
  if (vmConfig.memory) {
    args.push('-m', vmConfig.memory.toString());
  }

  // CPU
  if (vmConfig.cpus) {
    args.push('-smp', vmConfig.cpus.toString());
  }

  // Disk image
  if (vmConfig.diskImage) {
    if (isAndroid) {
      // Use virtio-blk for Android for better performance
      args.push('-drive', `file=${vmConfig.diskImage},if=virtio,format=qcow2`);
    } else if (vmConfig.virtioDrivers && vmConfig.virtioDrivers.attached) {
      // Use virtio-blk if VirtIO drivers are attached (better performance)
      // Detect disk format
      const diskFormat = vmConfig.diskImage.endsWith('.qcow2') ? 'qcow2' : 'raw';
      args.push('-drive', `file=${vmConfig.diskImage},if=virtio,format=${diskFormat}`);
    } else {
      args.push('-hda', vmConfig.diskImage);
    }
  }

  // CD/DVD
  if (vmConfig.cdrom) {
    args.push('-cdrom', vmConfig.cdrom);
  }

  // Boot order
  if (vmConfig.bootOrder) {
    args.push('-boot', vmConfig.bootOrder);
  }

  // Network
  if (vmConfig.network) {
    if (vmConfig.network.type === 'user') {
      args.push('-netdev', `user,id=net0`);
      if (isAndroid) {
        // Use virtio-net for Android
        args.push('-device', 'virtio-net,netdev=net0');
      } else if (vmConfig.virtioDrivers && vmConfig.virtioDrivers.attached) {
        // Use virtio-net if VirtIO drivers are attached (better performance)
        args.push('-device', 'virtio-net,netdev=net0');
      } else {
        args.push('-device', 'e1000,netdev=net0');
      }
    } else if (vmConfig.network.type === 'bridge') {
      args.push('-netdev', `bridge,id=net0,br=${vmConfig.network.bridge}`);
      if (isAndroid) {
        args.push('-device', 'virtio-net,netdev=net0');
      } else if (vmConfig.virtioDrivers && vmConfig.virtioDrivers.attached) {
        // Use virtio-net if VirtIO drivers are attached (better performance)
        args.push('-device', 'virtio-net,netdev=net0');
      } else {
        args.push('-device', 'e1000,netdev=net0');
      }
    }
  }

  // Display - VNC, GUI, SDL, or none
  const displayMode = vmConfig.display?.mode || 'none';
  let vncPort = vmConfig.vnc?.port;

  if (displayMode === 'vnc' || displayMode === 'embedded') {
    // Use VNC display
    if (vncPort && vncPort >= 5900 && vncPort <= 5999) {
      // QEMU uses display number (0-99), not port number
      // Port 5900 = display 0, port 5901 = display 1, etc.
      const displayNumber = vncPort - 5900;
      args.push('-vnc', `:${displayNumber}`);
    } else if (vncPort) {
      // Invalid port range, use display 0 as fallback
      console.warn(`Invalid VNC port ${vncPort}, using display 0`);
      args.push('-vnc', ':0');
    }
  } else if (displayMode === 'gui') {
    // Use GUI display - opens separate window, no VNC needed
    if (process.platform === 'darwin') {
      // macOS: use cocoa display
      args.push('-display', 'cocoa');
    } else if (process.platform === 'linux') {
      // Linux: use GTK display
      args.push('-display', 'gtk');
    } else {
      // Windows: use GTK (SDL was removed in QEMU 7.1+)
      args.push('-display', 'gtk');
    }
  } else if (displayMode === 'sdl') {
    // SDL was removed in QEMU 7.1+, use GTK or cocoa instead
    if (process.platform === 'darwin') {
      args.push('-display', 'cocoa');
    } else {
      args.push('-display', 'gtk');
    }
  } else if (displayMode === 'gtk') {
    // Use GTK display (opens separate window)
    args.push('-display', 'gtk');
  } else {
    // No display - headless mode
    args.push('-display', 'none');
    // Still need some graphics device for VM to work
    if (!isAndroid) {
      args.push('-vga', 'std');
    }
  }

  // Android-specific options
  if (isAndroid && vmConfig.android) {
    // Acceleration
    const acceleration = vmConfig.android.acceleration || 'auto';
    if (acceleration === 'kvm') {
      args.push('-accel', 'kvm');
    } else if (acceleration === 'haxm') {
      args.push('-accel', 'haxm');
    } else {
      args.push('-accel', 'tcg');
    }

    // Machine type for Android
    args.push('-machine', 'type=q35');

    // Graphics - use virtio-vga for Android
    args.push('-device', 'virtio-vga');

    // Input devices for Android
    args.push('-device', 'virtio-tablet');
    args.push('-device', 'virtio-keyboard');

    // Sound
    args.push('-soundhw', 'es1370');
  }

  // Additional options (only if not Android, as Android options are handled above)
  if (vmConfig.options && !isAndroid) {
    vmConfig.options.forEach(option => {
      if (typeof option === 'string') {
        args.push(...option.split(' '));
      } else if (Array.isArray(option)) {
        args.push(...option);
      }
    });
  }

  // Extra QEMU args from settings
  if (appSettings?.qemuExtraArgs) {
    const extraArgs = appSettings.qemuExtraArgs.trim().split(/\s+/).filter(arg => arg.length > 0);
    args.push(...extraArgs);
  }

  return args;
}

// Browse for file
ipcMain.handle('browse-file', async (event, options) => {
  const dialogOptions = {
    properties: ['openFile'],
    filters: options.filters || []
  };

  if (options.defaultPath && fs.existsSync(options.defaultPath)) {
    dialogOptions.defaultPath = options.defaultPath;
  }

  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

// Browse for directory
ipcMain.handle('browse-directory', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

// Settings IPC handlers
ipcMain.handle('get-settings', async () => {
  if (!appSettings) {
    loadSettings();
  }
  // Get VM dir path
  const vmDir = appSettings.vmDir || path.join(app.getPath('userData'), 'vms');
  return { ...appSettings, vmDir };
});

ipcMain.handle('save-settings', async (event, settings) => {
  appSettings = { ...appSettings, ...settings };
  return saveSettings();
});

ipcMain.handle('reset-settings', async () => {
  appSettings = { ...defaultSettings };
  saveSettings();
  return { success: true };
});

// Download file with progress
function downloadFile(url, dest, onProgress, getFilenameFromHeader = false) {
  return new Promise((resolve, reject) => {
    let finalDest = dest;
    const protocol = url.startsWith('https') ? https : http;

    const makeRequest = (requestUrl, isRetry = false) => {
      // Close previous file if retrying
      if (isRetry && fs.existsSync(finalDest)) {
        try {
          const stats = fs.statSync(finalDest);
          if (stats.size === 0) {
            fs.unlinkSync(finalDest);
          }
        } catch (e) {
          // Ignore errors
        }
      }

      const file = fs.createWriteStream(finalDest);

      protocol.get(requestUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            file.close();
            reject(new Error('Redirect bez URL'));
            return;
          }
          // Resolve relative URLs
          const fullRedirectUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, requestUrl).href;
          file.close();
          if (fs.existsSync(finalDest)) {
            try {
              fs.unlinkSync(finalDest);
            } catch (e) {
              // Ignore errors
            }
          }
          return makeRequest(fullRedirectUrl, true);
        }

        // Try to get filename from Content-Disposition header if needed (only on first response)
        if (getFilenameFromHeader && !isRetry && response.headers['content-disposition']) {
          const contentDisposition = response.headers['content-disposition'];
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (filenameMatch && filenameMatch[1]) {
            let filename = filenameMatch[1].replace(/['"]/g, '');
            // Remove any path components and decode URL encoding
            filename = decodeURIComponent(path.basename(filename));
            if (filename && (filename.endsWith('.iso') || filename.endsWith('.img'))) {
              const newDest = path.join(path.dirname(dest), filename);
              file.close();
              finalDest = newDest;
              // Retry with new filename
              return makeRequest(requestUrl, true);
            }
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(finalDest)) {
            try {
              fs.unlinkSync(finalDest);
            } catch (e) {
              // Ignore errors
            }
          }
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastUpdate = Date.now();

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const now = Date.now();
          // Update progress every 200ms to avoid too many updates
          if (onProgress && totalSize && (now - lastUpdate > 200 || downloadedSize === totalSize)) {
            onProgress({
              downloaded: downloadedSize,
              total: totalSize,
              percent: Math.round((downloadedSize / totalSize) * 100)
            });
            lastUpdate = now;
          }
        });

        response.on('end', () => {
          file.end();
          resolve({ success: true, path: finalDest });
        });

        response.pipe(file);
      }).on('error', (error) => {
        file.close();
        if (fs.existsSync(finalDest)) {
          try {
            fs.unlinkSync(finalDest);
          } catch (e) {
            // Ignore errors
          }
        }
        reject(error);
      });
    };

    makeRequest(url);
  });
}

// Download Android ISO
ipcMain.handle('download-android-iso', async (event, options) => {
  const isoDir = appSettings?.isoDir || path.join(app.getPath('userData'), 'iso');
  if (!fs.existsSync(isoDir)) {
    fs.mkdirSync(isoDir, { recursive: true });
  }

  // Android-x86 download URLs (using SourceForge latest download)
  const androidVersions = {
    'android-x86-latest': {
      name: 'Android-x86 (Najnovšia verzia)',
      url: 'https://sourceforge.net/projects/android-x86/files/latest/download',
      filename: 'android-x86-latest.iso'
    },
    'android-x86-9.0': {
      name: 'Android-x86 9.0 (Pie)',
      url: 'https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download',
      filename: 'android-x86_64-9.0-r2.iso'
    },
    'android-x86-8.1': {
      name: 'Android-x86 8.1 (Oreo)',
      url: 'https://sourceforge.net/projects/android-x86/files/Release%208.1/android-x86_64-8.1-r6.iso/download',
      filename: 'android-x86_64-8.1-r6.iso'
    },
    'android-x86-7.1': {
      name: 'Android-x86 7.1 (Nougat)',
      url: 'https://sourceforge.net/projects/android-x86/files/Release%207.1/android-x86_64-7.1-r5.iso/download',
      filename: 'android-x86_64-7.1-r5.iso'
    }
  };

  const version = options?.version || 'android-x86-latest';
  const androidInfo = androidVersions[version];

  if (!androidInfo) {
    return { success: false, error: 'Nepodporovaná verzia Android' };
  }

  // For latest version, try to get filename from Content-Disposition header or use timestamp
  const timestamp = Date.now();
  let destPath = version === 'android-x86-latest'
    ? path.join(isoDir, `android-x86-latest-${timestamp}.iso`)
    : path.join(isoDir, androidInfo.filename);

  // Check if file already exists (for latest, check any file starting with android-x86-latest)
  if (version === 'android-x86-latest') {
    const files = fs.readdirSync(isoDir).filter(f => f.startsWith('android-x86-latest') && f.endsWith('.iso'));
    if (files.length > 0) {
      // Use the most recent file
      const latestFile = files.sort().reverse()[0];
      destPath = path.join(isoDir, latestFile);
      return { success: true, path: destPath, cached: true };
    }
  } else {
    if (fs.existsSync(destPath)) {
      return { success: true, path: destPath, cached: true };
    }
  }

  try {
    // Send progress updates
    const progressCallback = (progress) => {
      mainWindow.webContents.send('android-download-progress', {
        version: version,
        ...progress
      });
    };

    // For latest version, try to get filename from headers
    const result = await downloadFile(androidInfo.url, destPath, progressCallback, version === 'android-x86-latest');
    return { success: true, path: result.path, cached: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Create disk image (general purpose)
ipcMain.handle('create-disk', async (event, options) => {
  const diskImageDir = appSettings?.diskImageDir || path.join(app.getPath('userData'), 'disks');
  if (!fs.existsSync(diskImageDir)) {
    fs.mkdirSync(diskImageDir, { recursive: true });
  }

  const sizeGB = options?.sizeGB || 20;
  const format = options?.format || 'qcow2';
  const filename = options?.filename || `disk-${Date.now()}.${format}`;
  const diskPath = path.join(diskImageDir, filename);

  return new Promise((resolve, reject) => {
    const arch = appSettings?.qemuArch || 'x86_64';
    const qemuPath = appSettings?.qemuPath || `qemu-system-${arch}`;

    // Try to find qemu-img
    let qemuImgPath = 'qemu-img';
    if (qemuPath && qemuPath.includes('qemu-system')) {
      qemuImgPath = qemuPath.replace(`qemu-system-${arch}`, 'qemu-img');
    }

    // Try qemu-img command with path
    exec(`"${qemuImgPath}" create -f ${format} "${diskPath}" ${sizeGB}G`, (error, stdout, stderr) => {
      if (error) {
        // Fallback: try without path (system PATH)
        exec(`qemu-img create -f ${format} "${diskPath}" ${sizeGB}G`, (error2, stdout2, stderr2) => {
          if (error2) {
            reject({ success: false, error: error2.message });
          } else {
            resolve({ success: true, path: diskPath });
          }
        });
      } else {
        resolve({ success: true, path: diskPath });
      }
    });
  });
});

// Create Android disk image
ipcMain.handle('create-android-disk', async (event, options) => {
  const diskImageDir = appSettings?.diskImageDir || path.join(app.getPath('userData'), 'disks');
  if (!fs.existsSync(diskImageDir)) {
    fs.mkdirSync(diskImageDir, { recursive: true });
  }

  const sizeGB = options?.sizeGB || 16;
  const filename = options?.filename || `android-${Date.now()}.qcow2`;
  const diskPath = path.join(diskImageDir, filename);

  return new Promise((resolve, reject) => {
    const arch = appSettings?.qemuArch || 'x86_64';
    const qemuPath = appSettings?.qemuPath || `qemu-system-${arch}`;

    // Try to find qemu-img
    let qemuImgPath = 'qemu-img';
    if (qemuPath && qemuPath.includes('qemu-system')) {
      qemuImgPath = qemuPath.replace(`qemu-system-${arch}`, 'qemu-img');
    }

    // Try qemu-img command with path
    exec(`"${qemuImgPath}" create -f qcow2 "${diskPath}" ${sizeGB}G`, (error, stdout, stderr) => {
      if (error) {
        // Fallback: try without path (system PATH)
        exec(`qemu-img create -f qcow2 "${diskPath}" ${sizeGB}G`, (error2, stdout2, stderr2) => {
          if (error2) {
            reject({ success: false, error: error2.message });
          } else {
            resolve({ success: true, path: diskPath });
          }
        });
      } else {
        resolve({ success: true, path: diskPath });
      }
    });
  });
});

// Get disk info (size, format)
ipcMain.handle('get-disk-info', async (event, diskPath) => {
  if (!diskPath || !fs.existsSync(diskPath)) {
    return { success: false, error: 'Disk file not found' };
  }

  return new Promise((resolve) => {
    const arch = appSettings?.qemuArch || 'x86_64';
    const qemuPath = appSettings?.qemuPath || `qemu-system-${arch}`;

    // Try to find qemu-img
    let qemuImgPath = 'qemu-img';
    if (qemuPath && qemuPath.includes('qemu-system')) {
      qemuImgPath = qemuPath.replace(`qemu-system-${arch}`, 'qemu-img');
    }

    // Get disk info
    exec(`"${qemuImgPath}" info "${diskPath}"`, (error, stdout, stderr) => {
      if (error) {
        // Fallback: try without path
        exec(`qemu-img info "${diskPath}"`, (error2, stdout2, stderr2) => {
          if (error2) {
            resolve({ success: false, error: error2.message });
          } else {
            // Parse qemu-img info output
            const info = parseQemuImgInfo(stdout2);
            resolve({ success: true, ...info });
          }
        });
      } else {
        // Parse qemu-img info output
        const info = parseQemuImgInfo(stdout);
        resolve({ success: true, ...info });
      }
    });
  });
});

// Parse qemu-img info output
function parseQemuImgInfo(output) {
  const info = {
    format: 'unknown',
    size: 0,
    virtualSize: 0,
    actualSize: 0
  };

  // Parse format
  const formatMatch = output.match(/file format:\s*(\w+)/i);
  if (formatMatch) {
    info.format = formatMatch[1];
  }

  // Parse virtual size
  const virtualSizeMatch = output.match(/virtual size:\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*([KMGT]i?B)\)/i);
  if (virtualSizeMatch) {
    const size = parseFloat(virtualSizeMatch[2]);
    const unit = virtualSizeMatch[3].toUpperCase();
    info.virtualSize = convertToBytes(size, unit);
    info.size = size;
    info.sizeUnit = unit;
  }

  // Parse actual size
  const actualSizeMatch = output.match(/actual size:\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*([KMGT]i?B)\)/i);
  if (actualSizeMatch) {
    const size = parseFloat(actualSizeMatch[2]);
    const unit = actualSizeMatch[3].toUpperCase();
    info.actualSize = convertToBytes(size, unit);
  }

  return info;
}

// Convert size to bytes
function convertToBytes(size, unit) {
  const multipliers = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
    'KIB': 1024,
    'MIB': 1024 * 1024,
    'GIB': 1024 * 1024 * 1024,
    'TIB': 1024 * 1024 * 1024 * 1024
  };
  return size * (multipliers[unit] || 1);
}

// Resize disk
ipcMain.handle('resize-disk', async (event, options) => {
  const { diskPath, newSizeGB } = options;

  if (!diskPath || !fs.existsSync(diskPath)) {
    return { success: false, error: 'Disk file not found' };
  }

  if (!newSizeGB || newSizeGB <= 0) {
    return { success: false, error: 'Invalid size' };
  }

  return new Promise((resolve) => {
    const arch = appSettings?.qemuArch || 'x86_64';
    const qemuPath = appSettings?.qemuPath || `qemu-system-${arch}`;

    // Try to find qemu-img
    let qemuImgPath = 'qemu-img';
    if (qemuPath && qemuPath.includes('qemu-system')) {
      qemuImgPath = qemuPath.replace(`qemu-system-${arch}`, 'qemu-img');
    }

    // Resize disk (only works for qcow2 and raw formats)
    exec(`"${qemuImgPath}" resize "${diskPath}" ${newSizeGB}G`, (error, stdout, stderr) => {
      if (error) {
        // Fallback: try without path
        exec(`qemu-img resize "${diskPath}" ${newSizeGB}G`, (error2, stdout2, stderr2) => {
          if (error2) {
            resolve({ success: false, error: error2.message });
          } else {
            resolve({ success: true, path: diskPath, newSize: newSizeGB });
          }
        });
      } else {
        resolve({ success: true, path: diskPath, newSize: newSizeGB });
      }
    });
  });
});

// Download VirtIO drivers ISO
ipcMain.handle('download-virtio-drivers', async (event, options) => {
  const isoDir = appSettings?.isoDir || path.join(app.getPath('userData'), 'iso');
  if (!fs.existsSync(isoDir)) {
    fs.mkdirSync(isoDir, { recursive: true });
  }

  // VirtIO drivers download URLs (Fedora project)
  // Latest stable version
  const virtioVersions = {
    'latest': {
      name: 'VirtIO Drivers (Najnovšia verzia)',
      // Fedora's latest VirtIO drivers ISO
      url: 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso',
      filename: 'virtio-win.iso'
    },
    '0.1.240': {
      name: 'VirtIO Drivers 0.1.240',
      url: 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.240-1/virtio-win-0.1.240.iso',
      filename: 'virtio-win-0.1.240.iso'
    },
    '0.1.229': {
      name: 'VirtIO Drivers 0.1.229',
      url: 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.229-1/virtio-win-0.1.229.iso',
      filename: 'virtio-win-0.1.229.iso'
    }
  };

  const version = options?.version || 'latest';
  const virtioInfo = virtioVersions[version];

  if (!virtioInfo) {
    return { success: false, error: 'Nepodporovaná verzia VirtIO ovladačov' };
  }

  const destPath = path.join(isoDir, virtioInfo.filename);

  // Check if file already exists
  if (fs.existsSync(destPath)) {
    return { success: true, path: destPath, cached: true };
  }

  try {
    // Send progress updates
    const progressCallback = (progress) => {
      mainWindow.webContents.send('virtio-download-progress', {
        version: version,
        ...progress
      });
    };

    const result = await downloadFile(virtioInfo.url, destPath, progressCallback, false);
    return { success: true, path: result.path, cached: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Attach VirtIO drivers to VM
ipcMain.handle('attach-virtio-drivers', async (event, vmId, virtioIsoPath) => {
  const vmDir = appSettings?.vmDir || path.join(app.getPath('userData'), 'vms');
  const vmPath = path.join(vmDir, `${vmId}.json`);

  if (!fs.existsSync(vmPath)) {
    return { success: false, error: 'VM not found' };
  }

  try {
    const vmConfig = JSON.parse(fs.readFileSync(vmPath, 'utf8'));

    // Check if VM is running
    if (qemuProcesses.has(vmId)) {
      return { success: false, error: 'VM musí byť zastavená pred pripojením ovladačov' };
    }

    // Set VirtIO ISO as CDROM
    vmConfig.cdrom = virtioIsoPath;
    vmConfig.virtioDrivers = {
      isoPath: virtioIsoPath,
      attached: true,
      attachedAt: Date.now()
    };

    // Save updated VM config
    fs.writeFileSync(vmPath, JSON.stringify(vmConfig, null, 2));

    return { success: true, vmConfig };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Create Android VM with optimized settings
ipcMain.handle('create-android-vm', async (event, options) => {
  const displayMode = options.displayMode || 'embedded'; // Android VMs typically need display
  const vncPort = (displayMode === 'vnc' || displayMode === 'embedded') ? (options.vncPort || 0) : 0;

  const vmConfig = {
    id: Date.now().toString(),
    name: options.name || 'Android VM',
    type: 'android',
    memory: options.memory || 4096, // Android needs more RAM
    cpus: options.cpus || 2,
    diskImage: options.diskImage,
    cdrom: options.isoPath,
    bootOrder: 'd', // Boot from CD/DVD first
    network: {
      type: 'user'
    },
    display: {
      mode: displayMode
    },
    vnc: vncPort > 0 ? {
      port: vncPort
    } : null,
    android: {
      version: options.androidVersion || 'android-x86-9.0',
      acceleration: options.acceleration || 'auto'
    },
    running: false
  };

  // Save VM
  const vmDir = appSettings?.vmDir || path.join(app.getPath('userData'), 'vms');
  if (!fs.existsSync(vmDir)) {
    fs.mkdirSync(vmDir, { recursive: true });
  }

  const filename = `${vmConfig.id}.json`;
  const filepath = path.join(vmDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(vmConfig, null, 2));

  return { success: true, vmConfig };
});

// Check for updates from GitHub
ipcMain.handle('check-updates', async () => {
  return new Promise((resolve) => {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version || '1.0.0';
    const repoUrl = 'https://api.github.com/repos/AnubisSK/AnubisQemuControl/releases/latest';

    https.get(repoUrl, {
      headers: {
        'User-Agent': 'AnubisQemuControl'
      }
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
            const downloadUrl = release.html_url; // Link to release page

            // Simple version comparison (assuming semantic versioning)
            const currentParts = currentVersion.split('.').map(Number);
            const latestParts = latestVersion.split('.').map(Number);
            
            let updateAvailable = false;
            for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
              const current = currentParts[i] || 0;
              const latest = latestParts[i] || 0;
              if (latest > current) {
                updateAvailable = true;
                break;
              } else if (latest < current) {
                break;
              }
            }

            resolve({
              success: true,
              updateAvailable: updateAvailable,
              currentVersion: currentVersion,
              latestVersion: latestVersion,
              downloadUrl: downloadUrl,
              releaseNotes: release.body || ''
            });
          } else if (res.statusCode === 404) {
            // No releases found
            resolve({
              success: true,
              updateAvailable: false,
              currentVersion: currentVersion,
              latestVersion: currentVersion,
              error: 'Žiadne vydania nenájdené'
            });
          } else {
            resolve({
              success: false,
              error: `HTTP ${res.statusCode}: ${res.statusMessage}`
            });
          }
        } catch (error) {
          resolve({
            success: false,
            error: error.message
          });
        }
      });
    }).on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });
  });
});

