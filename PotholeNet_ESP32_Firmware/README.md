# PotholeNet ESP32-CAM Firmware

Firmware for the **AI-Thinker ESP32-CAM** (with built-in USB-C port). Connects to your home Wi-Fi so all devices (phone, server, ESP32) are on the same network with internet access.

## What It Does

| Feature | URL |
|---------|-----|
| Status page | `http://potholenet.local/` |
| MJPEG live stream | `http://potholenet.local:81/stream` |
| Single frame capture | `http://potholenet.local/capture` |
| Camera settings | `http://potholenet.local/control?brightness=1` |
| Heartbeat (app) | `http://potholenet.local/heartbeat` |
| Detailed diagnostics | `http://potholenet.local/status` |

> If `potholenet.local` doesn't resolve, use the IP shown in Serial Monitor (e.g. `http://192.168.1.105`).

---

## Complete Flashing Guide (No Errors)

### Step 1: Install Arduino IDE

1. Download **Arduino IDE 2.x** from [arduino.cc/en/software](https://www.arduino.cc/en/software)
2. Run the installer — let it install all drivers including USB Serial

### Step 2: Add ESP32 Board Package

1. Open Arduino IDE
2. Go to **File → Preferences**
3. In **"Additional board manager URLs"**, paste this on a new line:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Click **OK**
5. Go to **Tools → Board → Boards Manager...** (or sidebar icon)
6. Search **"esp32"**
7. Install **"esp32 by Espressif Systems"** (latest version)
8. Wait — it downloads ~500MB

### Step 3: Set Up Wi-Fi Credentials

1. In File Explorer, open the `PotholeNet_ESP32_Firmware/` folder
2. Make a copy of `secrets.h.example` and rename it to `secrets.h`
3. Open `secrets.h` in Notepad or any text editor
4. Replace with your actual home Wi-Fi name and password:
   ```cpp
   #define WIFI_SSID     "MyHomeWiFi"
   #define WIFI_PASSWORD "mywifipassword"
   ```
5. Save the file

> ⚠️ The `secrets.h` file is gitignored — your password won't be uploaded to GitHub.

### Step 4: Open the Firmware

1. In Arduino IDE, go to **File → Open**
2. Navigate to the `PotholeNet_ESP32_Firmware/` folder
3. Open `PotholeNet_ESP32_Firmware.ino`
4. You should see two tabs: the main `.ino` file and `secrets.h`

### Step 5: Configure Board Settings

1. Go to **Tools → Board → esp32 → AI Thinker ESP32-CAM**
   - If you don't see it, the ESP32 package didn't install correctly (redo Step 2)
2. Set these **exact settings**:

| Setting | Value |
|---------|-------|
| Board | **AI Thinker ESP32-CAM** |
| Upload Speed | 115200 |
| USB CDC On Boot | **Enabled** ← IMPORTANT! |
| Flash Frequency | 80MHz |
| Flash Mode | QIO |
| Partition Scheme | **Huge APP (3MB No OTA/1MB SPIFFS)** |
| PSRAM | **Enabled** |

> **"USB CDC On Boot: Enabled"** is critical for boards with built-in USB. Without it, Serial Monitor won't work and the board may not appear on any COM port.

### Step 6: Connect the ESP32-CAM

1. Use a **good quality USB-C cable** (data + power, not power-only)
2. Plug the USB-C cable into the ESP32-CAM
3. Plug the other end into your computer
4. Wait a few seconds for Windows to detect it

**Check it's detected:**
- Go to **Tools → Port**
- You should see something like `COM3` or `COM4`
- If you don't see any COM port:
  - Try a different USB cable (must support data, not just charging)
  - Try a different USB port on your computer
  - Check Device Manager → Ports (COM & LPT) → look for "Silicon Labs CP210x" or "USB Serial Device"
  - If you see a yellow warning icon, right-click → Update Driver → Search automatically

### Step 7: Upload the Firmware

1. Select the correct **COM port** under **Tools → Port**
2. Click the **Upload button** (→ arrow, or Ctrl+U)
3. You'll see in the console:
   ```
   Sketch uses 1234567 bytes (39%) of program storage space.
   Global variables use 12345 bytes (4%) of dynamic memory.
   ```
4. Then it connects and writes:
   ```
   Connecting........_____....._____
   Writing | ██████████████ | 100%
   Hard resetting via RTS pin...
   ```
5. When you see **"Hard resetting via RTS pin..."** — it's done!

**If it gets stuck on "Connecting....":**
- The AI-Thinker ESP32-CAM with built-in USB usually auto-enters boot mode
- If it doesn't: press and **hold the BOOT button** on the ESP32-CAM, click Upload, release BOOT when you see "Writing..."
- Some boards need you to press **RESET once after upload** to start the program

### Step 8: Verify It's Working

1. Open **Serial Monitor** (Tools → Serial Monitor, or Ctrl+Shift+M)
2. Set baud rate to **115200** (dropdown in the top-right of Serial Monitor)
3. Press the **RESET button** on the ESP32-CAM
4. You should see:
   ```
   ╔══════════════════════════════════════╗
   ║    PotholeNet ESP32-CAM  v3.0       ║
   ║    Station Mode (Wi-Fi Client)       ║
   ╚══════════════════════════════════════╝

   [CAM] PSRAM found — enabling HQ mode
   [CAM] Camera initialized OK
   [WIFI] Connecting to "MyHomeWiFi"...
   ..........
   [WIFI] Connected! IP: 192.168.1.105 (RSSI: -45 dBm)
   [MDNS] Started! Access at http://potholenet.local
   [HTTP] Control server started on port 80
   [HTTP] Stream server started on port 81
   [READY] System online. Waiting for connections...
   ```

5. Open a browser on your computer (must be on same Wi-Fi) and go to:
   - `http://potholenet.local/` — should show the status page with a camera image
   - Or use the IP address shown in Serial Monitor

---

## Control API

### LED Flash
```
GET /control?led=on     → Turn flash ON
GET /control?led=off    → Turn flash OFF
```

### Servo (if ENABLE_SERVO = true)
```
GET /control?servo=left    → 0°
GET /control?center        → 90°
GET /control?right         → 180°
GET /control?servo=45      → Custom angle (0-180)
```

### Camera Settings
```
GET /control?brightness=1     → -2 to 2
GET /control?contrast=1       → -2 to 2
GET /control?saturation=-1    → -2 to 2
GET /control?resolution=VGA   → QVGA, CIF, VGA, SVGA, XGA, SXGA, UXGA
GET /control?quality=10       → 4-63 (lower = better)
GET /control?vflip=0          → 0 or 1
GET /control?hmirror=0        → 0 or 1
```

### Combine multiple settings
```
GET /control?brightness=1&contrast=2&led=on
```

## Wiring

### Servo Motor (optional)
```
Servo Signal  → GPIO 12
Servo VCC    → 5V (external supply recommended)
Servo GND    → GND
```

> ⚠️ The ESP32-CAM has very few free GPIO pins. GPIO 12 is the only reliably available one. **Do NOT use GPIO 0, 2, 4, 15, 16, 33** — they're used by the camera or boot config.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **No COM port appears** | Try a different USB cable (must be data cable, not charge-only). Try a different USB port. Check Device Manager for driver issues. |
| **"Connecting..." forever** | Hold BOOT button during upload, release when "Writing..." appears. Make sure Upload Speed is 115200. |
| **Upload fails with timeout** | Close Serial Monitor before uploading (it locks the COM port). Try again. |
| **Brown-out detector triggered** | Power supply too weak. Use a short, good quality USB cable. Add 1000µF capacitor across 5V/GND. |
| **Camera init fails (0x105)** | Add a 1000µF capacitor between 5V and GND. Use 5V/2A power supply. Check camera ribbon cable is seated properly. |
| **Camera image all white** | Peel off the lens protector film! |
| **Wi-Fi won't connect** | Check SSID and password in `secrets.h` are exactly right (case-sensitive). Make sure it's a 2.4GHz network (ESP32 doesn't support 5GHz). |
| **Can't access potholenet.local** | mDNS doesn't work on all devices. Use the IP address from Serial Monitor instead. Android doesn't support mDNS natively — use the IP. |
| **Stream is laggy** | Lower resolution: `/control?resolution=QVGA` or quality: `/control?quality=30` |
| **Board not in board list** | ESP32 package not installed. Redo Step 2. Make sure the URL is correct in Preferences. |
| **Compilation error: ESPmDNS.h not found** | Wrong board selected. Select "AI Thinker ESP32-CAM" under Tools → Board. |
| **Sketch too large** | Change Partition Scheme to "Huge APP (3MB No OTA/1MB SPIFFS)". |

---

## Power Requirements

- **Minimum:** 5V / 1A (basic streaming)
- **Recommended:** 5V / 2A (stable streaming)
- Add a **1000µF electrolytic capacitor** across 5V/GND for brown-out protection
- Use a **short USB cable** (long cables cause voltage drop)

## File Structure

```
PotholeNet_ESP32_Firmware/
├── PotholeNet_ESP32_Firmware.ino   # Main firmware (open this in Arduino IDE)
├── secrets.h.example               # Template — copy to secrets.h and edit
├── secrets.h                       # Your Wi-Fi credentials (gitignored)
└── README.md                       # This file
```

## Important Notes

- **2.4GHz Wi-Fi only** — ESP32 does NOT support 5GHz networks. If your router has both, make sure you use the 2.4GHz band.
- **Same network** — Your phone, computer, and ESP32 must all be on the same Wi-Fi network for the app to work.
- **Android + mDNS** — Android doesn't support mDNS natively. Use the IP address shown in Serial Monitor in the app settings.
- **Camera orientation** — The firmware defaults to vflip + hmirror (for rear-camera mounting). Adjust via `/control?vflip=0&hmirror=0` if needed.