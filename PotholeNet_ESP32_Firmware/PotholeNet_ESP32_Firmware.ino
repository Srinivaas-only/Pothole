/*
 * ============================================================
 *  PotholeNet ESP32-CAM Firmware v2.0
 *  Access Point Mode — AI-Thinker ESP32-CAM (built-in USB)
 * ============================================================
 *
 * WHAT IT DOES:
 *   - Creates a Wi-Fi hotspot (Access Point mode)
 *   - Phone connects to the ESP32's Wi-Fi network
 *   - Streams live camera feed as MJPEG
 *   - Provides single-frame capture for ML detection
 *   - LED flash control, camera settings
 *   - Captive portal auto-redirects phone to status page
 *
 * ENDPOINTS:
 *   http://192.168.4.1/              → Status page (HTML)
 *   http://192.168.4.1:81/stream     → MJPEG live stream
  *   http://192.168.4.1/capture       → Single JPEG capture
 *   http://192.168.4.1/control       → Control (LED, camera)
 *   http://192.168.4.1/heartbeat     → JSON status for app
 *   http://192.168.4.1/status        → Detailed JSON diagnostics
 *
 * FLASHING (Arduino IDE):
 *   1. Install ESP32 board package:
 *      File → Preferences → Additional Board URLs:
 *      https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
 *   2. Select Board: "AI Thinker ESP32-CAM"
 *   3. Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   4. Upload Speed: 115200
 *   5. Flash Frequency: 80MHz
 *   6. For boards WITHOUT built-in USB: hold GPIO0 → GND during upload
 *   7. For boards WITH built-in USB-C: just click Upload
 *   8. If stuck on "Connecting....", press and hold BOOT button,
 *      release once upload begins
 *
 * AFTER FLASHING:
 *   - ESP32 creates its own Wi-Fi hotspot (configurable SSID in secrets.h)
 *   - Connect your phone to this Wi-Fi network
 *   - A captive portal page should auto-appear, or browse to 192.168.4.1
 *   - Open the PotholeNet app — it auto-detects the ESP32 stream
 *
 * POWER NOTES:
 *   - ESP32-CAM needs stable 5V / 1A+ power supply
 *   - If camera init fails (brown-out), add a 1000µF cap across 5V/GND
 *   - Flash LED draws significant current — use sparingly
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "esp_http_server.h"
#include "secrets.h"       // SSID & password — copy secrets.h.example to secrets.h and edit

// =========================
// CONFIGURATION
// =========================
const int   AP_CHANNEL  = 6;          // Wi-Fi channel (1-13)
const int   MAX_CLIENTS = 4;          // Max connected devices
const int   LED_PIN     = 4;          // Built-in flash LED

// Stream settings
const int   STREAM_PORT = 81;         // MJPEG stream port
const int   CONTROL_PORT = 80;        // HTTP control port
const int   JPEG_QUALITY = 10;        // 0-63, lower = better quality
const framesize_t FRAME_SIZE = FRAMESIZE_VGA; // Default: 640x480

// =========================
// AI-THINKER ESP32-CAM PIN MAP
// =========================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// =========================
// GLOBALS
// =========================
httpd_handle_t stream_httpd  = NULL;
httpd_handle_t control_httpd = NULL;
DNSServer dnsServer;
bool cameraReady = false;
unsigned long bootTime = 0;
int streamClients = 0;

// MJPEG boundary
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY     = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART         = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// =========================
// UTILITY: JSON response helper
// =========================
static void send_json(httpd_req_t *req, const char *json) {
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_sendstr(req, json);
}

// =========================
// HANDLER: Root status page
// =========================
static esp_err_t index_handler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  char html[2048];
  snprintf(html, sizeof(html),
    "<!DOCTYPE html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>PotholeNet ESP32-CAM</title>"
    "<style>"
    "*{box-sizing:border-box;margin:0;padding:0}"
    "body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:16px}"
    "h1{color:#22c55e;font-size:1.5rem;margin-bottom:12px}"
    ".card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:16px;margin:8px 0}"
    ".label{color:#888;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px}"
    ".value{color:#22c55e;font-size:1.1rem;margin-top:4px;word-break:break-all}"
    "a{color:#22d3ee;text-decoration:none}"
    "a:hover{text-decoration:underline}"
    ".btn{display:inline-block;background:#22c55e;color:#000;padding:10px 20px;border-radius:8px;"
    "font-weight:bold;margin:8px 4px;text-decoration:none}"
    ".btn:hover{background:#16a34a}"
    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}"
    "img{width:100%%;border-radius:8px;margin-top:8px}"
    "</style></head><body>"
    "<h1>&#128663; PotholeNet ESP32-CAM</h1>"

    "<div class='card'>"
    "<div class='label'>Status</div>"
    "<div class='value'>&#9989; Online &mdash; Camera %s</div>"
    "</div>"

    "<div class='card'>"
    "<div class='label'>Live Stream</div>"
    "<div class='value'><a href='http://192.168.4.1:81/stream'>http://192.168.4.1:81/stream</a></div>"
    "<img src='http://192.168.4.1/capture' alt='Camera feed'>"
    "</div>"

    "<div class='card grid'>"
    "<div><div class='label'>Flash LED</div>"
    "<a href='/control?led=on' class='btn' style='background:#f59e0b'>ON</a>"
    "<a href='/control?led=off' class='btn'>OFF</a></div>"
    "<div><div class='label'>API Endpoints</div>"
    "<div class='value' style='font-size:0.8rem'>/capture<br>/heartbeat<br>/status<br>/control</div></div>"
    "</div>"

    "<div class='card'>"
    "<div class='label'>Hardware</div>"
    "<div class='value'>AI-Thinker ESP32-CAM<br>Mode: Wi-Fi AP<br>"
    "SSID: %s<br>Heap: %d KB</div>"
    "</div>"

    "<div class='card'>"
    "<div class='label'>Open PotholeNet App</div>"
    "<div class='value'>Connect your phone to <b>%s</b> Wi-Fi, then open the PotholeNet app.</div>"
    "</div>"

    "</body></html>",
    cameraReady ? "Ready" : "FAILED",
    AP_SSID,
    ESP.getFreeHeap() / 1024,
    AP_SSID
  );

  httpd_resp_sendstr(req, html);
  return ESP_OK;
}

// =========================
// HANDLER: MJPEG Stream (port 81)
// =========================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;
  char part_buf[64];

  res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  streamClients++;
  Serial.printf("[STREAM] Client connected (total: %d)\n", streamClients);

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[STREAM] Capture failed");
      res = ESP_FAIL;
      break;
    }

    size_t jpg_buf_len = fb->len;
    uint8_t *jpg_buf = fb->buf;

    // If not JPEG (shouldn't happen with our config), convert
    if (fb->format != PIXFORMAT_JPEG) {
      bool converted = frame2jpg(fb, 80, &jpg_buf, &jpg_buf_len);
      esp_camera_fb_return(fb);
      fb = NULL;
      if (!converted) {
        Serial.println("[STREAM] JPEG conversion failed");
        res = ESP_FAIL;
        break;
      }
    }

    // Send MJPEG part header
    size_t hlen = snprintf(part_buf, 64, STREAM_PART, jpg_buf_len);
    res = httpd_resp_send_chunk(req, part_buf, hlen);
    if (res != ESP_OK) { if (fb) esp_camera_fb_return(fb); else free(jpg_buf); break; }

    // Send JPEG data
    res = httpd_resp_send_chunk(req, (const char *)jpg_buf, jpg_buf_len);
    if (fb) { esp_camera_fb_return(fb); fb = NULL; jpg_buf = NULL; }
    else { free(jpg_buf); jpg_buf = NULL; }
    if (res != ESP_OK) break;

    // Send boundary
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res != ESP_OK) break;

    // Yield to watchdog
    taskYIELD();
  }

  streamClients--;
  Serial.printf("[STREAM] Client disconnected (total: %d)\n", streamClients);
  return res;
}

// =========================
// HANDLER: Single frame capture
// =========================
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    send_json(req, "{\"error\":\"capture_failed\"}");
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache");

  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// =========================
// HANDLER: Control endpoint
//   /control?led=on|off
//   /control?brightness=N (-2 to 2)
//   /control?contrast=N   (-2 to 2)
//   /control?resolution=VGA|QVGA|CIF
//   /control?quality=N    (0-63)
//   /control?vflip=0|1
//   /control?hmirror=0|1
// =========================
static esp_err_t control_handler(httpd_req_t *req) {
  char query[256] = {0};
  char param[32]  = {0};
  bool ok = true;

  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    sensor_t *s = esp_camera_sensor_get();

    // LED flash control
    if (httpd_query_key_value(query, "led", param, sizeof(param)) == ESP_OK) {
      if (strcmp(param, "on") == 0) {
        digitalWrite(LED_PIN, HIGH);
        Serial.println("[CTRL] LED ON");
      } else {
        digitalWrite(LED_PIN, LOW);
        Serial.println("[CTRL] LED OFF");
      }
    }

    // Camera brightness
    if (httpd_query_key_value(query, "brightness", param, sizeof(param)) == ESP_OK) {
      int val = atoi(param);
      s->set_brightness(s, constrain(val, -2, 2));
      Serial.printf("[CTRL] Brightness → %d\n", val);
    }

    // Camera contrast
    if (httpd_query_key_value(query, "contrast", param, sizeof(param)) == ESP_OK) {
      int val = atoi(param);
      s->set_contrast(s, constrain(val, -2, 2));
      Serial.printf("[CTRL] Contrast → %d\n", val);
    }

    // Camera saturation
    if (httpd_query_key_value(query, "saturation", param, sizeof(param)) == ESP_OK) {
      int val = atoi(param);
      s->set_saturation(s, constrain(val, -2, 2));
      Serial.printf("[CTRL] Saturation → %d\n", val);
    }

    // Resolution
    if (httpd_query_key_value(query, "resolution", param, sizeof(param)) == ESP_OK) {
      framesize_t fs = FRAMESIZE_VGA;
      if (strcmp(param, "QVGA") == 0)      fs = FRAMESIZE_QVGA;  // 320x240
      else if (strcmp(param, "CIF") == 0)   fs = FRAMESIZE_CIF;   // 400x296
      else if (strcmp(param, "VGA") == 0)   fs = FRAMESIZE_VGA;   // 640x480
      else if (strcmp(param, "SVGA") == 0)  fs = FRAMESIZE_SVGA;  // 800x600
      else if (strcmp(param, "XGA") == 0)   fs = FRAMESIZE_XGA;   // 1024x768
      else if (strcmp(param, "SXGA") == 0)  fs = FRAMESIZE_SXGA;  // 1280x1024
      else if (strcmp(param, "UXGA") == 0)  fs = FRAMESIZE_UXGA;  // 1600x1200

      if (s->set_framesize(s, fs) == 0) {
        Serial.printf("[CTRL] Resolution → %s\n", param);
      } else {
        ok = false;
        Serial.printf("[CTRL] Resolution FAILED: %s\n", param);
      }
    }

    // JPEG quality
    if (httpd_query_key_value(query, "quality", param, sizeof(param)) == ESP_OK) {
      int q = constrain(atoi(param), 4, 63);
      s->set_quality(s, q);
      Serial.printf("[CTRL] Quality → %d\n", q);
    }

    // Vertical flip
    if (httpd_query_key_value(query, "vflip", param, sizeof(param)) == ESP_OK) {
      s->set_vflip(s, atoi(param));
      Serial.printf("[CTRL] VFlip → %s\n", param);
    }

    // Horizontal mirror
    if (httpd_query_key_value(query, "hmirror", param, sizeof(param)) == ESP_OK) {
      s->set_hmirror(s, atoi(param));
      Serial.printf("[CTRL] HMirror → %s\n", param);
    }
  }

  char resp[64];
  snprintf(resp, sizeof(resp), "{\"status\":\"%s\"}", ok ? "ok" : "partial");
  send_json(req, resp);
  return ESP_OK;
}

// =========================
// HANDLER: Heartbeat (for app disconnect detection)
// =========================
static esp_err_t heartbeat_handler(httpd_req_t *req) {
  char buf[128];
  snprintf(buf, sizeof(buf),
    "{\"alive\":true,\"uptime\":%lu,\"clients\":%d,\"heap\":%lu,\"camera\":%s}",
    (millis() - bootTime) / 1000,
    WiFi.softAPgetStationNum(),
    (unsigned long)ESP.getFreeHeap(),
    cameraReady ? "true" : "false"
  );
  send_json(req, buf);
  return ESP_OK;
}

// =========================
// HANDLER: Detailed status (for diagnostics)
// =========================
static esp_err_t status_handler(httpd_req_t *req) {
  char buf[512];
  snprintf(buf, sizeof(buf),
    "{"
    "\"ip\":\"192.168.4.1\","
    "\"ssid\":\"%s\","
    "\"clients\":%d,"
    "\"uptime\":%lu,"
    "\"heap_free\":%lu,"
    "\"heap_min\":%lu,"
    "\"camera\":%s,"
    "\"stream_clients\":%d,"
    "\"led\":%d,"
    "\"resolution\":\"VGA\""
    "}",
    AP_SSID,
    WiFi.softAPgetStationNum(),
    (millis() - bootTime) / 1000,
    (unsigned long)ESP.getFreeHeap(),
    (unsigned long)ESP.getMinFreeHeap(),
    cameraReady ? "true" : "false",
    streamClients,
    digitalRead(LED_PIN) ? 1 : 0
  );
  send_json(req, buf);
  return ESP_OK;
}

// =========================
// START SERVERS
// =========================
void startServers() {
  // ---------- Control server (port 80) ----------
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = CONTROL_PORT;
  config.ctrl_port   = 32768;
  config.max_uri_handlers = 8;

  httpd_uri_t index_uri = {
    .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL
  };
  httpd_uri_t capture_uri = {
    .uri = "/capture", .method = HTTP_GET, .handler = capture_handler, .user_ctx = NULL
  };
  httpd_uri_t control_uri = {
    .uri = "/control", .method = HTTP_GET, .handler = control_handler, .user_ctx = NULL
  };
  httpd_uri_t heartbeat_uri = {
    .uri = "/heartbeat", .method = HTTP_GET, .handler = heartbeat_handler, .user_ctx = NULL
  };
  httpd_uri_t status_uri = {
    .uri = "/status", .method = HTTP_GET, .handler = status_handler, .user_ctx = NULL
  };

  if (httpd_start(&control_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(control_httpd, &index_uri);
    httpd_register_uri_handler(control_httpd, &capture_uri);
    httpd_register_uri_handler(control_httpd, &control_uri);
    httpd_register_uri_handler(control_httpd, &heartbeat_uri);
    httpd_register_uri_handler(control_httpd, &status_uri);
    Serial.println("[HTTP] Control server started on port 80");
  } else {
    Serial.println("[HTTP] FAILED to start control server!");
  }

  // ---------- Stream server (port 81) ----------
  config.server_port = STREAM_PORT;
  config.ctrl_port   = 32769;
  config.max_uri_handlers = 2;

  httpd_uri_t stream_uri = {
    .uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = NULL
  };

  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    Serial.println("[HTTP] Stream server started on port 81");
  } else {
    Serial.println("[HTTP] FAILED to start stream server!");
  }
}

// =========================
// SETUP
// =========================
void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println("\n\n");
  Serial.println("╔══════════════════════════════════════╗");
  Serial.println("║    PotholeNet ESP32-CAM  v2.0       ║");
  Serial.println("║    Access Point Mode                 ║");
  Serial.println("╚══════════════════════════════════════╝");
  Serial.println();

  bootTime = millis();

  // LED pin
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // ── Camera init ──
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location  = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    Serial.println("[CAM] PSRAM found — enabling HQ mode");
    config.frame_size   = FRAMESIZE_VGA;
    config.jpeg_quality = JPEG_QUALITY;
    config.fb_count     = 2;
    config.grab_mode    = CAMERA_GRAB_LATEST;
  } else {
    Serial.println("[CAM] No PSRAM — using limited mode");
    config.frame_size   = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count     = 1;
    config.fb_location  = CAMERA_FB_IN_DRAM;
  }

  // Init camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] INIT FAILED (0x%x)\n", err);
    Serial.println("[CAM] Check wiring, power supply (5V/1A+), add 1000uF cap");
    cameraReady = false;
    // Blink LED rapidly to indicate failure
    while (true) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(200);
    }
  }

  cameraReady = true;
  Serial.println("[CAM] Camera initialized OK");

  // Camera sensor defaults (rear-camera mounting)
  sensor_t *s = esp_camera_sensor_get();
  s->set_framesize(s, FRAME_SIZE);
  s->set_brightness(s, 0);      // -2 to 2
  s->set_contrast(s, 0);        // -2 to 2
  s->set_saturation(s, 0);      // -2 to 2
  s->set_vflip(s, 1);           // Flip vertically (rear camera)
  s->set_hmirror(s, 1);         // Mirror horizontally (rear camera)
  s->set_special_effect(s, 0);  // No effect
  s->set_whitebal(s, 1);        // Auto white balance
  s->set_awb_gain(s, 1);        // Auto white balance gain
  s->set_exposure_ctrl(s, 1);   // Auto exposure
  s->set_aec2(s, 1);            // Auto exposure DSP
  s->set_gain_ctrl(s, 1);       // Auto gain
  s->set_agc_gain(s, 0);        // Auto gain ceiling
  s->set_gainceiling(s, (gainceiling_t)0);
  s->set_bpc(s, 0);             // Bad pixel correction
  s->set_wpc(s, 1);             // White pixel correction
  s->set_raw_gma(s, 1);         // Raw gamma
  s->set_lenc(s, 1);            // Lens correction
  s->set_dcw(s, 1);             // Downsize enable

  // ── Wi-Fi AP ──
  Serial.println("[WIFI] Starting Access Point...");
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, 0, MAX_CLIENTS);
  IPAddress IP = WiFi.softAPIP();

  // ── DNS Server for captive portal ──
  // Redirect all DNS queries to our IP so phone auto-opens portal
  dnsServer.start(53, "*", IP);

  Serial.println();
  Serial.println("╔══════════════════════════════════════╗");
  Serial.println("║  PotholeNet ESP32-CAM Ready!         ║");
  Serial.println("╠══════════════════════════════════════╣");
  Serial.printf("║  SSID:     %-25s║\n", AP_SSID);
  Serial.printf("║  Password: %-25s║\n", AP_PASSWORD);
  Serial.printf("║  IP:       %-25s║\n", IP.toString().c_str());
  Serial.printf("║  Stream:   http://%s:81/stream  ║\n", IP.toString().c_str());
  Serial.printf("║  Capture:  http://%s/capture     ║\n", IP.toString().c_str());
  Serial.printf("║  Heartbeat: http://%s/heartbeat   ║\n", IP.toString().c_str());
  Serial.printf("║  Heap:     %-5lu bytes free        ║\n", (unsigned long)ESP.getFreeHeap());
  Serial.println("╚══════════════════════════════════════╝");

  // ── Start HTTP servers ──
  startServers();

  // ── Ready indicator: 3 blinks ──
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(150);
    digitalWrite(LED_PIN, LOW);
    delay(150);
  }

  Serial.println("[READY] System online. Waiting for connections...");
}

// =========================
// LOOP
// =========================
void loop() {
  // Process DNS requests for captive portal
  dnsServer.processNextRequest();

  // Heartbeat blink every 5 seconds
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > 5000) {
    digitalWrite(LED_PIN, HIGH);
    delay(30);
    digitalWrite(LED_PIN, LOW);
    lastBlink = millis();

    // Periodic health log (every 30 seconds)
    static unsigned long lastLog = 0;
    if (millis() - lastLog > 30000) {
      Serial.printf("[HEALTH] Heap: %lu KB | Clients: %d | Stream: %d | Uptime: %lu s\n",
        (unsigned long)ESP.getFreeHeap() / 1024,
        WiFi.softAPgetStationNum(),
        streamClients,
        (millis() - bootTime) / 1000
      );
      lastLog = millis();
    }
  }

  delay(10);  // Small delay to prevent watchdog issues
}