# PotholeNet ESP32-CAM Firmware

Firmware for the **AI-Thinker ESP32-CAM** (with built-in USB port). Creates a Wi-Fi Access Point (hotspot) so your phone connects directly to the camera — no router needed.

## What It Does

| Feature | URL |
|---------|-----|
| Status page | `http://192.168.4.1/` |
| MJPEG live stream | `http://192.168.4.1:81/stream` |
| Single frame capture | `http://192.168.4.1/capture` |
| Control (LED, camera) | `http://192.168.4.1/control?led=on` |
| Heartbeat (app) | `http://192.168.4.1/heartbeat` |
| Detailed diagnostics | `http://192.168.4.1/status` |

## Quick Start

### 1. Arduino IDE Setup (one-time)

1. Install **Arduino IDE 2.x** from [arduino.cc](https://www.arduino.cc/en/software)
2. Go to **File → Preferences → Additional Board Manager URLs**, add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools → Board → Boards Manager**, search **"esp32"**, install the ESP32 package

### 2. Board Settings

| Setting | Value |
|---------|-------|
| Board | **AI Thinker ESP32-CAM** |
| Upload Speed | 115200 |
| Flash Frequency | 80MHz |
| Partition Scheme | **Huge APP (3MB No OTA/1MB SPIFFS)** |
| Flash Mode | QIO |
| PSRAM | **Enabled** |

### 3. Flash the Firmware

1. Open `PotholeNet_ESP32_Firmware.ino` in Arduino IDE
2. Make sure `secrets.h` exists (copy from `secrets.h.example` if needed)
3. Connect ESP32-CAM via USB-C cable
4. Select the correct COM port under **Tools → Port**
5. Click **Upload** (→ button)
6. For boards without built-in USB: hold **BOOT** button during upload, release when "Writing..." appears
7. Open **Serial Monitor** at 115200 baud to see the startup messages

### 4. Connect Your Phone

1. After flashing, the ESP32-CAM creates a Wi-Fi hotspot:
   - **SSID:** `PotholeNet-AP`
   - **Password:** `potholenet`
2. Connect your phone to this Wi-Fi network
3. A captive portal page should auto-appear, or open a browser and go to `192.168.4.1`
4. Open the **PotholeNet app** — it auto-detects the camera stream

## Control API

### LED Flash
```
GET /control?led=on     → Turn flash ON
GET /control?led=off    → Turn flash OFF
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

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Camera init fails (0x105) | Add a **1000µF capacitor** between 5V and GND. Use a better 5V/2A power supply. |
| Upload fails / "Connecting..." | Hold **BOOT** button, click Upload, release BOOT when "Writing..." appears |
| Brown-out detector triggered | Power supply too weak. Use 5V/2A with short USB cable. |
| Camera image is all white | Lens protector film still on — peel it off |
| Can't connect to Wi-Fi | Password must be exactly 8+ characters. Default: `potholenet` |
| Stream is laggy | Lower resolution: `/control?resolution=QVGA` or quality: `/control?quality=30` |
| No PSRAM detected | Some cheap clones lack PSRAM. Firmware auto-adjusts to limited mode. |

## Power Requirements

- **Minimum:** 5V / 1A (basic streaming)
- **Recommended:** 5V / 2A (stable streaming + flash LED)
- Add a **1000µF electrolytic capacitor** across 5V/GND for brown-out protection

## File Structure

```
PotholeNet_ESP32_Firmware/
├── PotholeNet_ESP32_Firmware.ino   # Main firmware (open this in Arduino IDE)
├── secrets.h.example               # Template — copy to secrets.h
├── secrets.h                       # Your Wi-Fi credentials (gitignored)
└── README.md                       # This file