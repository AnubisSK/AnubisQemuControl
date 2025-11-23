# AnubisQemuControl

Moderná desktopová aplikácia pre ovládanie QEMU virtuálnych strojov s rozhraním podobným VirtualBoxu.

## Funkcie

- 🖥️ **Moderné tmavé rozhranie** - Elegantný tmavý štýl podobný VirtualBoxu
- 🚀 **Jednoduché ovládanie** - Vytváranie, spúšťanie a zastavovanie VM
- 📊 **Prehľad zdrojov** - Zobrazenie RAM, CPU a diskových zdrojov
- 🌐 **Sieťová konfigurácia** - Podpora NAT a Bridge sietí
- 🖱️ **VNC prístup** - Vzdialený prístup k VM cez VNC
- 💾 **Ukladanie konfigurácií** - Automatické ukladanie VM konfigurácií

## Požiadavky

- **Node.js** (v16 alebo novší)
- **QEMU** - Musí byť nainštalované a dostupné v PATH
- **Windows** - Aplikácia je optimalizovaná pre Windows

## Inštalácia

1. Nainštalujte závislosti:
```bash
npm install
```

2. Spustite aplikáciu:
```bash
npm start
```

## Vývoj

Pre vývoj s automatickým otvorením DevTools:
```bash
npm run dev
```

## Build pre Windows

Vytvorenie inštalačného balíčka:
```bash
npm run build:win
```

Výsledné súbory budú v priečinku `dist/`.

## Použitie

1. **Vytvorenie novej VM:**
    - Kliknite na tlačidlo "Nová VM"
    - Vyplňte základné informácie (názov, typ OS)
    - Nastavte systémové zdroje (RAM, CPU)
    - Vyberte disk image súbor
    - Voliteľne nastavte sieť a VNC port
    - Kliknite na "Vytvoriť VM"

2. **Spustenie VM:**
    - Vyberte VM zo zoznamu vľavo
    - Kliknite na tlačidlo "▶ Spustiť"

3. **Zastavenie VM:**
    - Kliknite na tlačidlo "⏹ Zastaviť"

4. **VNC prístup:**
    - Po spustení VM použite VNC klienta na pripojenie
    - Adresa: `localhost:<VNC_PORT>`
    - Port sa zobrazí v detaile VM

## Technológie

- **Electron** - Desktopová aplikácia
- **TailwindCSS** - Moderné CSS framework
- **QEMU** - Virtualizačný engine

## Licencia

MIT

## Poznámky

- Uistite sa, že QEMU je správne nainštalované a dostupné v systémovom PATH
- Pre najlepšiu kompatibilitu použite QEMU 6.0 alebo novšie
- VM konfigurácie sa ukladajú v `%APPDATA%/AnubisQemuControll/vms/`

## Obrazky



<img width="1413" height="908" alt="Snímka obrazovky 2025-11-23 o 18 03 09" src="https://github.com/user-attachments/assets/51a6c93d-ed22-4fc5-801c-2336f156d661" />
<img width="1413" height="908" alt="Snímka obrazovky 2025-11-23 o 18 02 51" src="https://github.com/user-attachments/assets/c01160fd-d770-4190-b6ae-b8916b0e7b77" />
<img width="1413" height="908" alt="Snímka obrazovky 2025-11-23 o 18 02 13" src="https://github.com/user-attachments/assets/9b173aae-4c7b-4e06-bca2-77ecf076dd0b" />
