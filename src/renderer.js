// Check if we're in Electron
if (typeof require === 'undefined') {
  console.error('renderer.js: require is not available. Make sure nodeIntegration is enabled.');
  alert('Chyba: renderer.js nemôže načítať Electron moduly. Skontrolujte nastavenia aplikácie.');
} else {
  try {
    const { ipcRenderer } = require('electron');
    
    let currentVM = null;
    let vms = [];
    let appSettings = null;

    // Load settings
    async function loadSettings() {
      appSettings = await ipcRenderer.invoke('get-settings');
      applySettingsToUI();
    }

    // Apply settings to UI
    function applySettingsToUI() {
      if (!appSettings) return;

      document.getElementById('settingQemuPath').value = appSettings.qemuPath || '';
      document.getElementById('settingQemuArch').value = appSettings.qemuArch || 'x86_64';
      document.getElementById('settingDefaultMemory').value = appSettings.defaultMemory || 2048;
      document.getElementById('settingDefaultCPU').value = appSettings.defaultCPU || 2;
      document.getElementById('settingDefaultNetwork').value = appSettings.defaultNetwork || 'user';
      document.getElementById('settingDefaultVNCPort').value = appSettings.defaultVNCPort || 0;
      document.getElementById('settingVMDir').value = appSettings.vmDir || '';
      document.getElementById('settingDiskImageDir').value = appSettings.diskImageDir || '';
      document.getElementById('settingISODir').value = appSettings.isoDir || '';
      document.getElementById('settingQemuExtraArgs').value = appSettings.qemuExtraArgs || '';
      document.getElementById('settingAutoStartVNC').checked = appSettings.autoStartVNC !== false;
      document.getElementById('settingShowQemuOutput').checked = appSettings.showQemuOutput !== false;
      document.getElementById('settingShowQemuArgs').checked = appSettings.showQemuArgs || false;
      document.getElementById('settingLanguage').value = appSettings.language || 'sk';
      document.getElementById('settingStartMinimized').checked = appSettings.startMinimized || false;
      document.getElementById('settingMinimizeToTray').checked = appSettings.minimizeToTray || false;
    }

    // Check QEMU installation
    async function checkQEMU() {
      const result = await ipcRenderer.invoke('check-qemu');
      const statusEl = document.getElementById('qemuStatus');

      if (result.installed) {
        statusEl.textContent = `QEMU: ${result.version.split('\n')[0]}`;
        statusEl.className = 'text-xs px-2 py-1 rounded bg-green-600 text-white';
      } else {
        statusEl.textContent = 'QEMU nie je nainštalované';
        statusEl.className = 'text-xs px-2 py-1 rounded bg-red-600 text-white';
      }
    }

    // Load VMs
    async function loadVMs() {
      vms = await ipcRenderer.invoke('get-vms');
      // Update running status for all VMs
      await updateAllVMStatuses();
      renderVMList();
    }

    // Update running status for all VMs
    async function updateAllVMStatuses() {
      const runningVMs = await ipcRenderer.invoke('get-running-vms');
      const runningIds = new Set(runningVMs.map(vm => vm.id));

      vms.forEach(vm => {
        vm.running = runningIds.has(vm.id);
        // Update VNC port and display mode if running
        if (vm.running) {
          const runningVM = runningVMs.find(r => r.id === vm.id);
          if (runningVM) {
            if (runningVM.vncPort) {
              if (!vm.vnc) vm.vnc = {};
              vm.vnc.port = runningVM.vncPort;
            }
            if (runningVM.displayMode) {
              if (!vm.display) vm.display = {};
              vm.display.mode = runningVM.displayMode;
            }
          }
        }
      });
    }

    // Render VM list
    function renderVMList() {
      const vmListEl = document.getElementById('vmList');
      vmListEl.innerHTML = '';

      if (vms.length === 0) {
        vmListEl.innerHTML = '<div class="text-dark-text2 text-sm text-center py-4">Žiadne VM</div>';
        return;
      }

      vms.forEach(vm => {
        const vmItem = document.createElement('div');
        vmItem.className = 'vm-item';
        if (vm.running) {
          vmItem.classList.add('running');
        }
        vmItem.dataset.vmId = vm.id;

        if (currentVM && currentVM.id === vm.id) {
          vmItem.classList.add('active');
        }

        vmItem.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex-1">
                        <div class="font-medium">${vm.name}</div>
                        <div class="text-xs text-dark-text2 mt-1">${vm.type === 'android' ? '🤖 Android' : (vm.type || 'Linux')}</div>
                        ${vm.running && vm.vnc?.port ? `<div class="text-xs text-green-400 mt-1">VNC: ${vm.vnc.port}</div>` : ''}
                        ${vm.running && vm.display?.mode === 'none' ? `<div class="text-xs text-dark-text2 mt-1">Headless</div>` : ''}
                    </div>
                    <div class="ml-2">
                        <span class="status-${vm.running ? 'running' : 'stopped'}">
                            ${vm.running ? '▶' : '⏹'}
                        </span>
                    </div>
                </div>
            `;

        vmItem.addEventListener('click', () => selectVM(vm));
        vmListEl.appendChild(vmItem);
      });

      // Update running VMs summary
      updateRunningVMsSummary();
    }

    // Update running VMs summary
    function updateRunningVMsSummary() {
      const runningVMs = vms.filter(vm => vm.running);
      const summaryEl = document.getElementById('runningVMsSummary');
      const listEl = document.getElementById('runningVMsList');
      const countEl = document.getElementById('runningVMsCount');
      const countNumberEl = document.getElementById('runningVMsCountNumber');

      // Update count in header
      if (runningVMs.length > 0) {
        countEl.classList.remove('hidden');
        countNumberEl.textContent = runningVMs.length;
      } else {
        countEl.classList.add('hidden');
      }

      if (runningVMs.length === 0) {
        summaryEl.classList.add('hidden');
        return;
      }

      summaryEl.classList.remove('hidden');
      listEl.innerHTML = '';

      runningVMs.forEach(vm => {
        const item = document.createElement('div');
        item.className = 'text-xs p-2 bg-dark-surface2 rounded border border-dark-border';
        item.innerHTML = `
                <div class="font-medium">${vm.name}</div>
                <div class="text-dark-text2 mt-1">
                    ${vm.vnc?.port ? `VNC: localhost:${vm.vnc.port}` : (vm.display?.mode === 'none' ? 'Headless' : 'Bez VNC')}
                </div>
            `;
        item.addEventListener('click', () => selectVM(vm));
        item.classList.add('cursor-pointer', 'hover:bg-dark-border');
        listEl.appendChild(item);
      });
    }

    // Select VM
    async function selectVM(vm) {
      currentVM = vm;

      // Update UI
      document.querySelectorAll('.vm-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.vmId === vm.id) {
          item.classList.add('active');
        }
      });

      // Show toolbar and details
      document.getElementById('vmToolbar').style.display = 'flex';
      document.getElementById('emptyState').style.display = 'none';
      document.getElementById('emptyContent').classList.add('hidden');
      document.getElementById('vmDetails').classList.remove('hidden');

      // Load VM status
      const status = await ipcRenderer.invoke('get-vm-status', vm.id);
      vm.running = status.running;

      // Update details
      updateVMDetails(vm);
      updateToolbarButtons(vm.running);
    }

    // Update VM details
    async function updateVMDetails(vm) {
      document.getElementById('vmName').textContent = vm.name;
      document.getElementById('vmType').textContent = vm.type === 'android' ? '🤖 Android' : (vm.type || 'Linux');
      document.getElementById('vmMemory').textContent = `${vm.memory || 2048} MB`;
      document.getElementById('vmCPU').textContent = `${vm.cpus || 2} jadier`;
      document.getElementById('vmDiskImage').textContent = vm.diskImage || 'Nie je nastavené';

      // Load and display disk size
      const resizeButton = document.getElementById('btnResizeDisk');
      const diskSizeEl = document.getElementById('vmDiskSize');
      if (vm.diskImage) {
        try {
          const diskInfo = await ipcRenderer.invoke('get-disk-info', vm.diskImage);
          if (diskInfo.success) {
            const sizeGB = (diskInfo.virtualSize / (1024 * 1024 * 1024)).toFixed(2);
            diskSizeEl.textContent = `Veľkosť: ${sizeGB} GB (formát: ${diskInfo.format})`;
            resizeButton.classList.remove('hidden');
            resizeButton.dataset.diskPath = vm.diskImage;
            resizeButton.dataset.currentSize = sizeGB;
          } else {
            diskSizeEl.textContent = 'Nepodarilo sa načítať informácie o disku';
            resizeButton.classList.add('hidden');
          }
        } catch (error) {
          diskSizeEl.textContent = 'Nepodarilo sa načítať informácie o disku';
          resizeButton.classList.add('hidden');
        }
      } else {
        diskSizeEl.textContent = '-';
        resizeButton.classList.add('hidden');
      }

      document.getElementById('vmCDROM').textContent = vm.cdrom || 'Nie je nastavené';
      document.getElementById('vmNetworkType').textContent = vm.network?.type || 'User Mode';

      // Update VirtIO drivers status
      const virtioStatusEl = document.getElementById('vmVirtioStatus');
      const virtioButton = document.getElementById('btnDownloadVirtio');
      if (vm.virtioDrivers && vm.virtioDrivers.attached) {
        virtioStatusEl.innerHTML = `<span class="text-green-400">✓ VirtIO ovladače pripojené</span><br><span class="text-xs text-dark-text2">${vm.virtioDrivers.isoPath}</span>`;
        virtioButton.textContent = '🔄 Zmeniť VirtIO ovladače';
      } else {
        virtioStatusEl.textContent = 'VirtIO ovladače nie sú pripojené';
        virtioButton.textContent = '📥 Stiahnuť a pripojiť VirtIO ovladače';
      }
      virtioButton.dataset.vmId = vm.id;

      // Get current VM status to show actual VNC port and display mode
      const status = await ipcRenderer.invoke('get-vm-status', vm.id);
      const displayMode = status.displayMode || vm.display?.mode || 'none';
      const vncPort = status.vncPort || vm.vnc?.port;

      // Update display mode info
      const displayModeText = {
        'none': 'Žiadne (headless)',
        'gui': 'GUI (samostatné okno, bez VNC)',
        'vnc': 'VNC (externý klient)',
        'embedded': 'VNC (v aplikácii)',
        'sdl': 'SDL (samostatné okno)',
        'gtk': 'GTK (samostatné okno)'
      };

      if (vncPort && (displayMode === 'vnc' || displayMode === 'embedded')) {
        document.getElementById('vmVNCPort').innerHTML = `${vncPort} <span class="text-xs text-dark-text2">(localhost:${vncPort}) - ${displayModeText[displayMode] || displayMode}</span>`;
      } else if (displayMode !== 'none') {
        document.getElementById('vmVNCPort').innerHTML = `${displayModeText[displayMode] || displayMode}`;
      } else {
        document.getElementById('vmVNCPort').textContent = 'Nie je nastavené';
      }

      const statusEl = document.getElementById('vmStatus');
      if (vm.running) {
        statusEl.innerHTML = '<span class="status-running">▶ Beží</span>';

        // Show/hide embedded display panel
        const displayPanel = document.getElementById('vmDisplayPanel');
        if (displayMode === 'embedded' && vncPort) {
          displayPanel.classList.remove('hidden');
          loadEmbeddedVNC(vncPort);
        } else {
          displayPanel.classList.add('hidden');
        }

        // Show QEMU args if available
        const qemuArgsPanel = document.getElementById('vmQemuArgsPanel');
        if (vm.qemuCommand || vm.qemuArgs) {
          qemuArgsPanel.classList.remove('hidden');
          const argsText = vm.qemuCommand || (vm.qemuArgs ? vm.qemuArgs.join(' ') : '-');
          document.getElementById('vmQemuArgs').textContent = argsText;
        } else {
          qemuArgsPanel.classList.add('hidden');
        }
      } else {
        statusEl.innerHTML = '<span class="status-stopped">⏹ Zastavené</span>';
        document.getElementById('vmDisplayPanel').classList.add('hidden');
        document.getElementById('vmQemuArgsPanel').classList.add('hidden');
      }
    }

    // Load embedded VNC viewer
    function loadEmbeddedVNC(vncPort) {
      const placeholder = document.getElementById('vmDisplayPlaceholder');
      const frame = document.getElementById('vmDisplayFrame');

      // Use a simple VNC web client
      // For now, we'll use a simple approach with a VNC web client URL
      // In production, you might want to embed noVNC or similar
      const vncUrl = `http://localhost:${vncPort}`;

      // Try to use a VNC web client
      // Note: This requires a VNC web proxy or we can use an iframe with a VNC web client
      // For simplicity, we'll show instructions to connect
      placeholder.innerHTML = `
            <div class="text-center p-4">
                <div class="text-4xl mb-2">🖥️</div>
                <p class="mb-2">VNC Port: ${vncPort}</p>
                <p class="text-sm text-dark-text2 mb-4">Pre zobrazenie VM použite VNC klienta</p>
                <p class="text-xs text-dark-text2">Pripojte sa na: localhost:${vncPort}</p>
                <p class="text-xs text-dark-text2 mt-2">Alebo použite externý VNC klient ako TightVNC, RealVNC, alebo TigerVNC</p>
            </div>
        `;

      // Hide frame for now (can be enabled when VNC web proxy is available)
      frame.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }

    // Update toolbar buttons
    function updateToolbarButtons(running) {
      document.getElementById('btnStart').disabled = running;
      document.getElementById('btnStop').disabled = !running;
      document.getElementById('btnRestart').disabled = !running;
    }

    // Setup event listeners
    function setupEventListeners() {
      // New VM buttons
      document.getElementById('btnNewVM').addEventListener('click', showNewVMModal);
      document.getElementById('btnNewVMEmpty').addEventListener('click', showNewVMModal);

      // Android VM buttons
      document.getElementById('btnNewAndroidVM').addEventListener('click', showAndroidVMModal);
      document.getElementById('btnNewAndroidVMEmpty').addEventListener('click', showAndroidVMModal);

      // Settings button
      document.getElementById('btnSettings').addEventListener('click', showSettingsModal);

      // About button
      document.getElementById('btnAbout').addEventListener('click', showAboutModal);
      document.getElementById('btnCloseAboutModal').addEventListener('click', hideAboutModal);
      document.getElementById('btnCloseAbout').addEventListener('click', hideAboutModal);
      document.getElementById('btnCheckUpdate').addEventListener('click', checkForUpdates);
      document.getElementById('btnOpenGitHub').addEventListener('click', () => {
        require('electron').shell.openExternal('https://github.com/AnubisSK/AnubisQemuControl');
      });

      // Modal buttons
      document.getElementById('btnCloseModal').addEventListener('click', hideNewVMModal);
      document.getElementById('btnCancelVM').addEventListener('click', hideNewVMModal);

      // Settings modal buttons
      document.getElementById('btnCloseSettings').addEventListener('click', hideSettingsModal);
      document.getElementById('btnCancelSettings').addEventListener('click', hideSettingsModal);
      document.getElementById('btnResetSettings').addEventListener('click', resetSettings);

      // Settings form
      document.getElementById('settingsForm').addEventListener('submit', handleSaveSettings);

      // Settings browse buttons
      document.getElementById('btnBrowseQemu').addEventListener('click', () => browseFile('settingQemuPath', [
        { name: 'Executable', extensions: ['exe', 'bat', 'cmd'] },
        { name: 'All Files', extensions: ['*'] }
      ]));
      document.getElementById('btnBrowseVMDir').addEventListener('click', () => browseDirectory('settingVMDir'));
      document.getElementById('btnBrowseDiskImageDir').addEventListener('click', () => browseDirectory('settingDiskImageDir'));
      document.getElementById('btnBrowseISODir').addEventListener('click', () => browseDirectory('settingISODir'));

      // VM form
      document.getElementById('vmForm').addEventListener('submit', handleCreateVM);

      // Android VM modal buttons
      document.getElementById('btnCloseAndroidModal').addEventListener('click', hideAndroidVMModal);
      document.getElementById('btnCancelAndroidVM').addEventListener('click', hideAndroidVMModal);
      document.getElementById('androidVMForm').addEventListener('submit', handleCreateAndroidVM);

      // Browse buttons
      document.getElementById('btnBrowseDisk').addEventListener('click', () => browseFile('inputDiskImage', [
        { name: 'Disk Images', extensions: ['img', 'qcow2', 'raw', 'vdi', 'vmdk'] }
      ]));
      document.getElementById('btnBrowseCDROM').addEventListener('click', () => browseFile('inputCDROM', [
        { name: 'ISO Images', extensions: ['iso'] }
      ]));

      // Network type change
      document.getElementById('inputNetworkType').addEventListener('change', (e) => {
        const bridgeGroup = document.getElementById('networkBridgeGroup');
        bridgeGroup.classList.toggle('hidden', e.target.value !== 'bridge');
      });

      // Display mode change
      document.getElementById('inputDisplayMode').addEventListener('change', (e) => {
        const vncPortGroup = document.getElementById('vncPortGroup');
        const displayMode = e.target.value;
        vncPortGroup.classList.toggle('hidden', displayMode !== 'vnc' && displayMode !== 'embedded');
      });

      // Create disk checkbox change
      document.getElementById('inputCreateDisk').addEventListener('change', (e) => {
        const diskCreationOptions = document.getElementById('diskCreationOptions');
        const diskImageInput = document.getElementById('inputDiskImage');
        diskCreationOptions.classList.toggle('hidden', !e.target.checked);
        if (e.target.checked) {
          diskImageInput.disabled = true;
          diskImageInput.placeholder = 'Disk bude vytvorený automaticky';
        } else {
          diskImageInput.disabled = false;
          diskImageInput.placeholder = 'Cesta k disk image súboru';
        }
      });

      // Toolbar buttons
      document.getElementById('btnStart').addEventListener('click', startVM);
      document.getElementById('btnStop').addEventListener('click', stopVM);
      document.getElementById('btnRestart').addEventListener('click', restartVM);
      document.getElementById('btnEdit').addEventListener('click', editVM);
      document.getElementById('btnDelete').addEventListener('click', deleteVM);
      document.getElementById('btnClone').addEventListener('click', cloneVM);

      // Copy QEMU args button
      document.getElementById('btnCopyQemuArgs').addEventListener('click', () => {
        const argsText = document.getElementById('vmQemuArgs').textContent;
        if (argsText && argsText !== '-') {
          navigator.clipboard.writeText(argsText).then(() => {
            const btn = document.getElementById('btnCopyQemuArgs');
            const originalText = btn.textContent;
            btn.textContent = '✓ Skopírované!';
            setTimeout(() => {
              btn.textContent = originalText;
            }, 2000);
          }).catch(() => {
            alert('Nepodarilo sa skopírovať do schránky');
          });
        }
      });

      // Resize disk button
      document.getElementById('btnResizeDisk').addEventListener('click', showResizeDiskModal);
      document.getElementById('btnCloseResizeModal').addEventListener('click', hideResizeDiskModal);
      document.getElementById('btnCancelResize').addEventListener('click', hideResizeDiskModal);
      document.getElementById('btnConfirmResize').addEventListener('click', handleResizeDisk);

      // VirtIO drivers buttons
      document.getElementById('btnDownloadVirtio').addEventListener('click', showVirtioDownloadModal);
      document.getElementById('btnCloseVirtioModal').addEventListener('click', hideVirtioDownloadModal);
      document.getElementById('btnCancelVirtio').addEventListener('click', hideVirtioDownloadModal);
      document.getElementById('btnDownloadVirtioConfirm').addEventListener('click', handleDownloadVirtio);
    }

    // Show new VM modal
    function showNewVMModal() {
      // Reset form
      document.getElementById('vmForm').reset();
      document.getElementById('inputVMId').value = '';
      document.getElementById('vmModalTitle').textContent = 'Nová virtuálna mašina';
      document.getElementById('btnSubmitVM').textContent = 'Vytvoriť VM';

      // Reset disk creation options
      document.getElementById('inputCreateDisk').checked = false;
      document.getElementById('diskCreationOptions').classList.add('hidden');
      document.getElementById('inputDiskImage').disabled = false;
      document.getElementById('inputDiskImage').placeholder = 'Cesta k disk image súboru alebo nechajte prázdne pre auto-vytvorenie';

      // Apply default values from settings
      if (appSettings) {
        document.getElementById('inputMemory').value = appSettings.defaultMemory || 2048;
        document.getElementById('inputCPU').value = appSettings.defaultCPU || 2;
        document.getElementById('inputNetworkType').value = appSettings.defaultNetwork || 'user';
        document.getElementById('inputVNCPort').value = appSettings.defaultVNCPort || 0;
        document.getElementById('inputDisplayMode').value = appSettings.defaultDisplayMode || (appSettings.autoStartVNC ? 'vnc' : 'none');

        // Show/hide bridge group based on network type
        const bridgeGroup = document.getElementById('networkBridgeGroup');
        bridgeGroup.classList.toggle('hidden', appSettings.defaultNetwork !== 'bridge');

        // Show/hide VNC port group based on display mode
        const displayMode = document.getElementById('inputDisplayMode').value;
        const vncPortGroup = document.getElementById('vncPortGroup');
        vncPortGroup.classList.toggle('hidden', displayMode !== 'vnc' && displayMode !== 'embedded');
      }

      document.getElementById('newVMModal').classList.remove('hidden');
      document.getElementById('newVMModal').classList.add('fade-in');
    }

    // Show edit VM modal
    function showEditVMModal(vm) {
      if (!vm) return;

      // Set modal title and button
      document.getElementById('vmModalTitle').textContent = 'Upraviť virtuálnu mašinu';
      document.getElementById('btnSubmitVM').textContent = 'Uložiť zmeny';

      // Fill form with VM data
      document.getElementById('inputVMId').value = vm.id;
      document.getElementById('inputVMName').value = vm.name || '';
      document.getElementById('inputVMType').value = vm.type || 'linux';
      document.getElementById('inputMemory').value = vm.memory || 2048;
      document.getElementById('inputCPU').value = vm.cpus || 2;
      document.getElementById('inputDiskImage').value = vm.diskImage || '';
      document.getElementById('inputCDROM').value = vm.cdrom || '';

      // Reset disk creation options (not available when editing)
      document.getElementById('inputCreateDisk').checked = false;
      document.getElementById('diskCreationOptions').classList.add('hidden');
      document.getElementById('inputDiskImage').disabled = false;
      document.getElementById('inputDiskImage').placeholder = 'Cesta k disk image súboru';

      // Network settings
      const networkType = vm.network?.type || 'user';
      document.getElementById('inputNetworkType').value = networkType;
      document.getElementById('inputNetworkBridge').value = vm.network?.bridge || '';

      const bridgeGroup = document.getElementById('networkBridgeGroup');
      bridgeGroup.classList.toggle('hidden', networkType !== 'bridge');

      // Display settings
      const displayMode = vm.display?.mode || 'none';
      document.getElementById('inputDisplayMode').value = displayMode;
      document.getElementById('inputVNCPort').value = vm.vnc?.port || 0;

      const vncPortGroup = document.getElementById('vncPortGroup');
      vncPortGroup.classList.toggle('hidden', displayMode !== 'vnc' && displayMode !== 'embedded');

      document.getElementById('newVMModal').classList.remove('hidden');
      document.getElementById('newVMModal').classList.add('fade-in');
    }

    // Hide new VM modal
    function hideNewVMModal() {
      document.getElementById('newVMModal').classList.add('hidden');
      document.getElementById('vmForm').reset();
    }

    // Show Android VM modal
    function showAndroidVMModal() {
      document.getElementById('androidVMModal').classList.remove('hidden');
      document.getElementById('androidVMModal').classList.add('fade-in');
      document.getElementById('androidDownloadProgress').classList.add('hidden');
    }

    // Hide Android VM modal
    function hideAndroidVMModal() {
      document.getElementById('androidVMModal').classList.add('hidden');
      document.getElementById('androidVMForm').reset();
      document.getElementById('androidDownloadProgress').classList.add('hidden');
    }

    // Handle Android VM creation
    async function handleCreateAndroidVM(e) {
      e.preventDefault();

      const vmName = document.getElementById('androidVMName').value;
      const androidVersion = document.getElementById('androidVersion').value;
      const memory = parseInt(document.getElementById('androidMemory').value) || 4096;
      const cpus = parseInt(document.getElementById('androidCPU').value) || 2;
      const diskSize = parseInt(document.getElementById('androidDiskSize').value) || 16;
      const acceleration = document.getElementById('androidAcceleration').value;

      const createButton = document.getElementById('btnCreateAndroidVM');
      const progressDiv = document.getElementById('androidDownloadProgress');

      try {
        // Disable button
        createButton.disabled = true;
        createButton.textContent = 'Pripravuje sa...';

        // Show download progress
        progressDiv.classList.remove('hidden');
        document.getElementById('androidDownloadStatus').textContent = 'Sťahuje sa Android ISO...';

        // Step 1: Download Android ISO
        const downloadResult = await ipcRenderer.invoke('download-android-iso', {
          version: androidVersion
        });

        if (!downloadResult.success) {
          throw new Error(`Chyba pri sťahovaní: ${downloadResult.error}`);
        }

        if (downloadResult.cached) {
          document.getElementById('androidDownloadStatus').textContent = 'Android ISO už je stiahnutý';
          document.getElementById('androidDownloadPercent').textContent = '100%';
          document.getElementById('androidDownloadBar').style.width = '100%';
        }

        // Step 2: Create disk image
        document.getElementById('androidDownloadStatus').textContent = 'Vytvára sa disk image...';
        const diskResult = await ipcRenderer.invoke('create-android-disk', {
          sizeGB: diskSize,
          filename: `${vmName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.qcow2`
        });

        if (!diskResult.success) {
          throw new Error(`Chyba pri vytváraní disku: ${diskResult.error}`);
        }

        // Step 3: Create VM configuration
        document.getElementById('androidDownloadStatus').textContent = 'Vytvára sa VM konfigurácia...';
        const vmResult = await ipcRenderer.invoke('create-android-vm', {
          name: vmName,
          androidVersion: androidVersion,
          memory: memory,
          cpus: cpus,
          diskImage: diskResult.path,
          isoPath: downloadResult.path,
          acceleration: acceleration === 'auto' ? 'tcg' : acceleration,
          displayMode: 'embedded', // Android VMs use embedded display by default
          vncPort: 0
        });

        if (!vmResult.success) {
          throw new Error(`Chyba pri vytváraní VM: ${vmResult.error}`);
        }

        // Success!
        document.getElementById('androidDownloadStatus').textContent = 'Android VM bola úspešne vytvorená!';

        // Hide modal and reload VMs
        setTimeout(async () => {
          hideAndroidVMModal();
          await loadVMs();
          // Select the newly created VM
          const newVM = vms.find(vm => vm.id === vmResult.vmConfig.id);
          if (newVM) {
            selectVM(newVM);
          }
          alert('Android VM bola úspešne vytvorená!\n\nTeraz môžete spustiť VM a nainštalovať Android z ISO súboru.\nPo inštalácii odpojte ISO a zmeňte boot order na disk.');
        }, 1000);

      } catch (error) {
        alert(`Chyba pri vytváraní Android VM: ${error.message}`);
        createButton.disabled = false;
        createButton.textContent = 'Vytvoriť Android VM';
      }
    }

    // Listen for Android download progress
    ipcRenderer.on('android-download-progress', (event, data) => {
      const percent = data.percent || 0;
      const downloaded = formatBytes(data.downloaded || 0);
      const total = formatBytes(data.total || 0);

      document.getElementById('androidDownloadPercent').textContent = `${percent}%`;
      document.getElementById('androidDownloadBar').style.width = `${percent}%`;
      document.getElementById('androidDownloadStatus').textContent = `Sťahuje sa: ${downloaded} / ${total}`;

      // Calculate speed (simplified)
      if (data.downloaded && data.total) {
        const speed = (data.downloaded / data.total) * 100;
        document.getElementById('androidDownloadSpeed').textContent = `Priebeh: ${percent}%`;
      }
    });

    // Format bytes helper
    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Browse for file
    async function browseFile(inputId, filters) {
      // Get default directory from settings if available
      let defaultPath = null;
      if (inputId === 'inputDiskImage' && appSettings?.diskImageDir) {
        defaultPath = appSettings.diskImageDir;
      } else if (inputId === 'inputCDROM' && appSettings?.isoDir) {
        defaultPath = appSettings.isoDir;
      }

      const result = await ipcRenderer.invoke('browse-file', {
        filters,
        defaultPath
      });
      if (result.success) {
        document.getElementById(inputId).value = result.path;
      }
    }

    // Browse for directory
    async function browseDirectory(inputId) {
      const result = await ipcRenderer.invoke('browse-directory');
      if (result.success) {
        document.getElementById(inputId).value = result.path;
      }
    }

    // Handle create/edit VM
    async function handleCreateVM(e) {
      e.preventDefault();

      // Check if editing existing VM
      const vmId = document.getElementById('inputVMId').value;
      const isEditing = vmId && vmId !== '';

      // Use default values from settings if not provided
      const defaultMemory = appSettings?.defaultMemory || 2048;
      const defaultCPU = appSettings?.defaultCPU || 2;
      const defaultNetwork = appSettings?.defaultNetwork || 'user';
      const defaultVNCPort = appSettings?.defaultVNCPort || 0;

      const displayMode = document.getElementById('inputDisplayMode').value || 'none';
      const vncPort = displayMode === 'vnc' || displayMode === 'embedded'
        ? (parseInt(document.getElementById('inputVNCPort').value) || defaultVNCPort)
        : 0;

      // Get existing VM if editing to preserve some settings
      let existingVM = null;
      if (isEditing) {
        existingVM = vms.find(v => v.id === vmId);
        if (!existingVM) {
          alert('VM nebola nájdená!');
          return;
        }
      }

      // Check if we need to create a disk automatically
      let diskImage = document.getElementById('inputDiskImage').value;
      const createDisk = document.getElementById('inputCreateDisk').checked;

      if (createDisk && !isEditing) {
        // Create disk automatically
        const submitButton = document.getElementById('btnSubmitVM');
        const originalText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Vytvára sa disk...';

        try {
          const diskSize = parseInt(document.getElementById('inputDiskSize').value) || 20;
          const diskFormat = document.getElementById('inputDiskFormat').value || 'qcow2';
          const vmName = document.getElementById('inputVMName').value || 'VM';
          const diskFilename = `${vmName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.${diskFormat}`;

          const diskResult = await ipcRenderer.invoke('create-disk', {
            sizeGB: diskSize,
            format: diskFormat,
            filename: diskFilename
          });

          if (!diskResult.success) {
            throw new Error(`Chyba pri vytváraní disku: ${diskResult.error}`);
          }

          diskImage = diskResult.path;
          submitButton.textContent = 'Vytvára sa VM...';
        } catch (error) {
          alert(`Chyba pri vytváraní disku: ${error.message}`);
          submitButton.disabled = false;
          submitButton.textContent = originalText;
          return;
        }
      }

      const vmConfig = {
        id: isEditing ? vmId : Date.now().toString(),
        name: document.getElementById('inputVMName').value,
        type: document.getElementById('inputVMType').value,
        memory: parseInt(document.getElementById('inputMemory').value) || defaultMemory,
        cpus: parseInt(document.getElementById('inputCPU').value) || defaultCPU,
        diskImage: diskImage,
        cdrom: document.getElementById('inputCDROM').value || null,
        network: {
          type: document.getElementById('inputNetworkType').value || defaultNetwork,
          bridge: document.getElementById('inputNetworkBridge').value || null
        },
        display: {
          mode: displayMode
        },
        vnc: vncPort > 0 ? {
          port: vncPort
        } : null,
        running: isEditing && existingVM ? existingVM.running : false
      };

      // Preserve Android-specific settings if editing Android VM
      if (isEditing && existingVM && existingVM.type === 'android' && existingVM.android) {
        vmConfig.type = 'android';
        vmConfig.android = existingVM.android;
        vmConfig.bootOrder = existingVM.bootOrder || 'd';
      }

      // Remove network if none
      if (vmConfig.network.type === 'none') {
        vmConfig.network = null;
      }

      try {
        await ipcRenderer.invoke('save-vm', vmConfig);
        await loadVMs();
        hideNewVMModal();

        // Select the VM (updated or newly created)
        const updatedVM = vms.find(v => v.id === vmConfig.id);
        if (updatedVM) {
          selectVM(updatedVM);
          if (isEditing) {
            alert('VM bola úspešne upravená!');
          } else if (createDisk) {
            alert(`VM bola úspešne vytvorená!\n\nDisk bol automaticky vytvorený: ${diskImage}`);
          }
        }
      } catch (error) {
        alert(`Chyba pri ukladaní VM: ${error.message}`);
      } finally {
        const submitButton = document.getElementById('btnSubmitVM');
        submitButton.disabled = false;
        submitButton.textContent = isEditing ? 'Uložiť zmeny' : 'Vytvoriť VM';
      }
    }

    // Start VM
    async function startVM() {
      if (!currentVM) return;

      try {
        const result = await ipcRenderer.invoke('start-vm', currentVM);
        if (result.success) {
          currentVM.running = true;
          if (result.vncPort) {
            if (!currentVM.vnc) currentVM.vnc = {};
            currentVM.vnc.port = result.vncPort;
          }
          if (result.displayMode) {
            if (!currentVM.display) currentVM.display = {};
            currentVM.display.mode = result.displayMode;
          }
          if (result.qemuArgs) {
            currentVM.qemuArgs = result.qemuArgs;
          }
          if (result.qemuCommand) {
            currentVM.qemuCommand = result.qemuCommand;
          }
          await updateVMDetails(currentVM);
          updateToolbarButtons(true);
          await loadVMs(); // Reload to update all VM statuses
        } else {
          alert(`Chyba pri spustení VM: ${result.error}`);
        }
      } catch (error) {
        alert(`Chyba: ${error.message}`);
      }
    }

    // Stop VM
    async function stopVM(skipConfirm = false) {
      if (!currentVM) return Promise.resolve();

      if (!skipConfirm && !confirm('Naozaj chcete zastaviť túto VM?')) {
        return Promise.resolve();
      }

      try {
        const result = await ipcRenderer.invoke('stop-vm', currentVM.id);
        if (result.success) {
          currentVM.running = false;
          await updateVMDetails(currentVM);
          updateToolbarButtons(false);
          await loadVMs(); // Reload to update all VM statuses
          document.getElementById('vmOutput').innerHTML = '<div class="text-dark-text2">VM bola zastavená</div>';
          return Promise.resolve();
        } else {
          alert(`Chyba pri zastavení VM: ${result.error}`);
          return Promise.reject(new Error(result.error));
        }
      } catch (error) {
        alert(`Chyba: ${error.message}`);
        return Promise.reject(error);
      }
    }

    // Restart VM
    async function restartVM() {
      if (!currentVM) return;

      if (!confirm('Naozaj chcete reštartovať túto VM?')) return;

      await stopVM();
      setTimeout(async () => {
        await startVM();
      }, 1000);
    }

    // Edit VM
    async function editVM() {
      if (!currentVM) return;

      // Check if VM is running
      if (currentVM.running) {
        if (!confirm('VM je momentálne spustená. Na úpravu nastavení musí byť zastavená. Chcete ju zastaviť a pokračovať v úprave?')) {
          return;
        }
        // Stop VM first (skip confirm dialog since we already asked)
        try {
          await stopVM(true);
          setTimeout(() => {
            showEditVMModal(currentVM);
          }, 500);
        } catch (error) {
          // Error already shown in stopVM
        }
      } else {
        showEditVMModal(currentVM);
      }
    }

    // Delete VM
    async function deleteVM() {
      if (!currentVM) return;

      if (!confirm(`Naozaj chcete vymazať VM "${currentVM.name}"?`)) return;

      if (currentVM.running) {
        await stopVM();
      }

      try {
        const result = await ipcRenderer.invoke('delete-vm', currentVM.id);
        if (result.success) {
          currentVM = null;
          await loadVMs();

          // Show empty state
          document.getElementById('vmToolbar').style.display = 'none';
          document.getElementById('emptyState').style.display = 'block';
          document.getElementById('emptyContent').classList.remove('hidden');
          document.getElementById('vmDetails').classList.add('hidden');
        } else {
          alert(`Chyba pri vymazaní VM: ${result.error}`);
        }
      } catch (error) {
        alert(`Chyba: ${error.message}`);
      }
    }

    // Clone VM
    function cloneVM() {
      if (!currentVM) return;
      // TODO: Implement clone functionality
      alert('Funkcia klónovania bude implementovaná v budúcej verzii');
    }

    // Settings functions
    function showSettingsModal() {
      document.getElementById('settingsModal').classList.remove('hidden');
      document.getElementById('settingsModal').classList.add('fade-in');
      loadSettings();
    }

    function hideSettingsModal() {
      document.getElementById('settingsModal').classList.add('hidden');
    }

    async function handleSaveSettings(e) {
      e.preventDefault();

      const settings = {
        qemuPath: document.getElementById('settingQemuPath').value.trim(),
        qemuArch: document.getElementById('settingQemuArch').value,
        defaultMemory: parseInt(document.getElementById('settingDefaultMemory').value) || 2048,
        defaultCPU: parseInt(document.getElementById('settingDefaultCPU').value) || 2,
        defaultNetwork: document.getElementById('settingDefaultNetwork').value,
        defaultVNCPort: parseInt(document.getElementById('settingDefaultVNCPort').value) || 0,
        vmDir: document.getElementById('settingVMDir').value.trim() || null,
        diskImageDir: document.getElementById('settingDiskImageDir').value.trim(),
        isoDir: document.getElementById('settingISODir').value.trim(),
        qemuExtraArgs: document.getElementById('settingQemuExtraArgs').value.trim(),
        autoStartVNC: document.getElementById('settingAutoStartVNC').checked,
        showQemuOutput: document.getElementById('settingShowQemuOutput').checked,
        showQemuArgs: document.getElementById('settingShowQemuArgs').checked,
        language: document.getElementById('settingLanguage').value,
        startMinimized: document.getElementById('settingStartMinimized').checked,
        minimizeToTray: document.getElementById('settingMinimizeToTray').checked
      };

      const result = await ipcRenderer.invoke('save-settings', settings);
      if (result.success) {
        appSettings = { ...appSettings, ...settings };
        await checkQEMU(); // Re-check QEMU with new path
        hideSettingsModal();
        alert('Nastavenia boli uložené');
      } else {
        alert(`Chyba pri ukladaní nastavení: ${result.error}`);
      }
    }

    async function resetSettings() {
      if (!confirm('Naozaj chcete obnoviť všetky nastavenia na predvolené hodnoty?')) {
        return;
      }

      const result = await ipcRenderer.invoke('reset-settings');
      if (result.success) {
        await loadSettings();
        alert('Nastavenia boli obnovené na predvolené hodnoty');
      }
    }

    // Listen for VM output
    ipcRenderer.on('vm-output', (event, data) => {
      if (currentVM && currentVM.id === data.id) {
        const outputEl = document.getElementById('vmOutput');
        const outputDiv = document.createElement('div');
        outputDiv.textContent = data.output;
        outputEl.appendChild(outputDiv);
        outputEl.scrollTop = outputEl.scrollHeight;
      }
    });

    // Listen for VM started
    ipcRenderer.on('vm-started', async (event, data) => {
      const vm = vms.find(v => v.id === data.id);
      if (vm) {
        vm.running = true;
        if (data.vncPort) {
          if (!vm.vnc) vm.vnc = {};
          vm.vnc.port = data.vncPort;
        }
        if (data.displayMode) {
          if (!vm.display) vm.display = {};
          vm.display.mode = data.displayMode;
        }
        if (data.qemuArgs) {
          vm.qemuArgs = data.qemuArgs;
        }
        if (data.qemuCommand) {
          vm.qemuCommand = data.qemuCommand;
        }
      }

      if (currentVM && currentVM.id === data.id) {
        currentVM.running = true;
        if (data.vncPort) {
          if (!currentVM.vnc) currentVM.vnc = {};
          currentVM.vnc.port = data.vncPort;
        }
        if (data.displayMode) {
          if (!currentVM.display) currentVM.display = {};
          currentVM.display.mode = data.displayMode;
        }
        if (data.qemuArgs) {
          currentVM.qemuArgs = data.qemuArgs;
        }
        if (data.qemuCommand) {
          currentVM.qemuCommand = data.qemuCommand;
        }
        await updateVMDetails(currentVM);
        updateToolbarButtons(true);
      }

      await loadVMs(); // Reload to update all VM statuses
    });

    // Listen for VM stopped
    ipcRenderer.on('vm-stopped', async (event, vmId) => {
      const vm = vms.find(v => v.id === vmId);
      if (vm) {
        vm.running = false;
      }

      if (currentVM && currentVM.id === vmId) {
        currentVM.running = false;
        await updateVMDetails(currentVM);
        updateToolbarButtons(false);
      }

      await loadVMs(); // Reload to update all VM statuses
    });

    // Resize disk functions
    function showResizeDiskModal() {
      const button = document.getElementById('btnResizeDisk');
      const diskPath = button.dataset.diskPath;
      const currentSize = parseFloat(button.dataset.currentSize);

      if (!diskPath) return;

      document.getElementById('resizeCurrentSize').textContent = `${currentSize} GB`;
      document.getElementById('resizeNewSize').value = Math.ceil(currentSize);
      document.getElementById('resizeNewSize').min = Math.ceil(currentSize);
      document.getElementById('resizeProgress').classList.add('hidden');
      document.getElementById('resizeDiskModal').classList.remove('hidden');
      document.getElementById('resizeDiskModal').dataset.diskPath = diskPath;
    }

    function hideResizeDiskModal() {
      document.getElementById('resizeDiskModal').classList.add('hidden');
      document.getElementById('resizeProgress').classList.add('hidden');
    }

    async function handleResizeDisk() {
      const modal = document.getElementById('resizeDiskModal');
      const diskPath = modal.dataset.diskPath;
      const newSizeGB = parseInt(document.getElementById('resizeNewSize').value);
      const currentSize = parseFloat(document.getElementById('resizeCurrentSize').textContent);

      if (!diskPath || !newSizeGB) {
        alert('Neplatné údaje');
        return;
      }

      if (newSizeGB < currentSize) {
        alert('Môžete iba zväčšiť disk. Zmenšenie nie je podporované.');
        return;
      }

      if (newSizeGB === currentSize) {
        alert('Nová veľkosť musí byť väčšia ako súčasná.');
        return;
      }

      const confirmButton = document.getElementById('btnConfirmResize');
      const cancelButton = document.getElementById('btnCancelResize');
      const progressDiv = document.getElementById('resizeProgress');
      const statusEl = document.getElementById('resizeStatus');
      const barEl = document.getElementById('resizeBar');

      confirmButton.disabled = true;
      cancelButton.disabled = true;
      progressDiv.classList.remove('hidden');
      statusEl.textContent = 'Zmena veľkosti disku...';
      barEl.style.width = '50%';

      try {
        const result = await ipcRenderer.invoke('resize-disk', {
          diskPath: diskPath,
          newSizeGB: newSizeGB
        });

        if (result.success) {
          barEl.style.width = '100%';
          statusEl.textContent = 'Disk bol úspešne zmenený!';

          setTimeout(async () => {
            hideResizeDiskModal();
            if (currentVM) {
              await updateVMDetails(currentVM);
            }
            alert(`Veľkosť disku bola úspešne zmenená na ${newSizeGB} GB`);
          }, 1000);
        } else {
          throw new Error(result.error || 'Nepodarilo sa zmeniť veľkosť disku');
        }
      } catch (error) {
        alert(`Chyba pri zmene veľkosti disku: ${error.message}`);
        progressDiv.classList.add('hidden');
      } finally {
        confirmButton.disabled = false;
        cancelButton.disabled = false;
      }
    }

    // VirtIO drivers functions
    function showVirtioDownloadModal() {
      if (!currentVM) return;

      if (currentVM.running) {
        alert('VM musí byť zastavená pred pripojením ovladačov');
        return;
      }

      document.getElementById('virtioDownloadModal').classList.remove('hidden');
      document.getElementById('virtioDownloadProgress').classList.add('hidden');
      document.getElementById('virtioVersion').value = 'latest';
    }

    function hideVirtioDownloadModal() {
      document.getElementById('virtioDownloadModal').classList.add('hidden');
      document.getElementById('virtioDownloadProgress').classList.add('hidden');
    }

    async function handleDownloadVirtio() {
      if (!currentVM) return;

      const version = document.getElementById('virtioVersion').value;
      const confirmButton = document.getElementById('btnDownloadVirtioConfirm');
      const cancelButton = document.getElementById('btnCancelVirtio');
      const progressDiv = document.getElementById('virtioDownloadProgress');
      const statusEl = document.getElementById('virtioDownloadStatus');
      const percentEl = document.getElementById('virtioDownloadPercent');
      const barEl = document.getElementById('virtioDownloadBar');
      const speedEl = document.getElementById('virtioDownloadSpeed');

      confirmButton.disabled = true;
      cancelButton.disabled = true;
      progressDiv.classList.remove('hidden');
      statusEl.textContent = 'Sťahuje sa VirtIO ISO...';
      percentEl.textContent = '0%';
      barEl.style.width = '0%';

      try {
        // Step 1: Download VirtIO ISO
        const downloadResult = await ipcRenderer.invoke('download-virtio-drivers', {
          version: version
        });

        if (!downloadResult.success) {
          throw new Error(`Chyba pri sťahovaní: ${downloadResult.error}`);
        }

        if (downloadResult.cached) {
          statusEl.textContent = 'VirtIO ISO už je stiahnutý';
          percentEl.textContent = '100%';
          barEl.style.width = '100%';
        }

        // Step 2: Attach VirtIO ISO to VM
        statusEl.textContent = 'Pripojuje sa VirtIO ISO k VM...';
        const attachResult = await ipcRenderer.invoke('attach-virtio-drivers', currentVM.id, downloadResult.path);

        if (!attachResult.success) {
          throw new Error(`Chyba pri pripájaní: ${attachResult.error}`);
        }

        // Success!
        statusEl.textContent = 'VirtIO ovladače boli úspešne pripojené!';

        setTimeout(async () => {
          hideVirtioDownloadModal();
          await loadVMs();
          if (currentVM) {
            const updatedVM = vms.find(v => v.id === currentVM.id);
            if (updatedVM) {
              currentVM = updatedVM;
              await updateVMDetails(currentVM);
            }
          }
          alert('VirtIO ovladače boli úspešne stiahnuté a pripojené k VM!\n\nV Windows VM otvorte tento CD/DVD disk a nainštalujte ovladače pre lepší výkon.');
        }, 1000);

      } catch (error) {
        alert(`Chyba: ${error.message}`);
        progressDiv.classList.add('hidden');
      } finally {
        confirmButton.disabled = false;
        cancelButton.disabled = false;
      }
    }

    // Listen for VirtIO download progress
    ipcRenderer.on('virtio-download-progress', (event, data) => {
      const percent = data.percent || 0;
      const downloaded = formatBytes(data.downloaded || 0);
      const total = formatBytes(data.total || 0);

      document.getElementById('virtioDownloadPercent').textContent = `${percent}%`;
      document.getElementById('virtioDownloadBar').style.width = `${percent}%`;
      document.getElementById('virtioDownloadStatus').textContent = `Sťahuje sa: ${downloaded} / ${total}`;

      if (data.downloaded && data.total) {
        document.getElementById('virtioDownloadSpeed').textContent = `Priebeh: ${percent}%`;
      }
    });

    // About modal functions
    function showAboutModal() {
      // Set current version
      document.getElementById('aboutVersion').textContent = '1.0.0';
      
      // Hide update section initially
      document.getElementById('updateStatus').classList.add('hidden');
      document.getElementById('updateDownloadSection').classList.add('hidden');
      
      document.getElementById('aboutModal').classList.remove('hidden');
      document.getElementById('aboutModal').classList.add('fade-in');
    }

    function hideAboutModal() {
      document.getElementById('aboutModal').classList.add('hidden');
    }

    async function checkForUpdates() {
      const checkButton = document.getElementById('btnCheckUpdate');
      const statusDiv = document.getElementById('updateStatus');
      const statusText = document.getElementById('updateStatusText');
      const downloadSection = document.getElementById('updateDownloadSection');
      const updateInfo = document.getElementById('updateInfo');
      const downloadLink = document.getElementById('btnDownloadUpdate');

      try {
        checkButton.disabled = true;
        checkButton.textContent = 'Kontroluje sa...';
        statusDiv.classList.remove('hidden');
        statusText.textContent = 'Kontroluje sa dostupnosť aktualizácií...';
        statusText.className = 'text-sm text-dark-text';

        const result = await ipcRenderer.invoke('check-updates');

        if (result.success) {
          if (result.updateAvailable) {
            statusText.textContent = '✓ Nájdená nová verzia!';
            statusText.className = 'text-sm text-green-400';
            updateInfo.textContent = `Dostupná verzia: ${result.latestVersion}\nAktuálna verzia: ${result.currentVersion}`;
            downloadLink.href = result.downloadUrl || 'https://github.com/AnubisSK/AnubisQemuControl/releases/latest';
            downloadSection.classList.remove('hidden');
          } else {
            statusText.textContent = '✓ Máte najnovšiu verziu';
            statusText.className = 'text-sm text-green-400';
            downloadSection.classList.add('hidden');
          }
        } else {
          statusText.textContent = `✗ Chyba: ${result.error || 'Nepodarilo sa skontrolovať aktualizácie'}`;
          statusText.className = 'text-sm text-red-400';
          downloadSection.classList.add('hidden');
        }
      } catch (error) {
        statusText.textContent = `✗ Chyba: ${error.message}`;
        statusText.className = 'text-sm text-red-400';
        downloadSection.classList.add('hidden');
      } finally {
        checkButton.disabled = false;
        checkButton.textContent = '🔄 Skontrolovať aktualizácie';
      }
    }

        // Initialize app
        document.addEventListener('DOMContentLoaded', async () => {
          try {
            console.log('renderer.js: Initializing application...');
            await loadSettings();
            await checkQEMU();
            await loadVMs();
            setupEventListeners();
            console.log('renderer.js: Application initialized successfully');
          } catch (error) {
            console.error('renderer.js: Error during initialization:', error);
            alert('Chyba pri inicializácii aplikácie: ' + error.message);
          }
        });
} catch (error) {
    console.error('renderer.js: Failed to load Electron modules:', error);
    alert('Chyba: Nepodarilo sa načítať Electron moduly: ' + error.message);
  }
}

