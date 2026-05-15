import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AppScene, AppSettings, TabView, CameraSource } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SCENES } from "./constants/scenes";
import { ALERT_COLORS } from "./constants/colors";
import { deriveAlertState } from "./lib/alertLogic";
import { useESPHeartbeat } from "./hooks/useESPHeartbeat";
import { useGPS } from "./hooks/useGPS";
import { useDetection } from "./hooks/useDetection";
import { useAudioCues } from "./hooks/useAudioCues";
import { useVibration } from "./hooks/useVibration";
import { useWakeLock } from "./hooks/useWakeLock";
import { useHazards } from "./hooks/useHazards";
import { submitReport, checkHealth, updateLocation } from "./lib/api";
import type { HazardItem, HealthResponse } from "./lib/api";
import {
  Camera, MapPin, Settings, AlertTriangle,
  RotateCcw, Radio, RadioOff,
  Zap, Eye, EyeOff, Volume2, VolumeX, Smartphone, Wifi,
  ChevronDown, X, Map, Server, WifiOff, Activity
} from "lucide-react";

// ============================================
// CAMERA HOOK — Phone + ESP32
// ============================================
function usePhoneCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setLoading(false);
    }).catch(err => {
      if (!cancelled) {
        setError(err.name === "NotAllowedError" ? "Camera permission denied" : "Camera unavailable");
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [active]);

  return { videoRef, error, loading };
}


// ============================================
// OVERLAY COMPONENTS
// ============================================
function AlertBorder({ config }: { config: typeof SCENES[AppScene] }) {
  const cls = config.pulse === "fast" ? "pulse-fast" : config.pulse === "slow" ? "pulse-slow" : "";
  return (
    <div className={cls} style={{
      position: "absolute", inset: 0, border: `3px solid ${config.borderColor}`,
      boxShadow: `inset 0 0 ${config.glowSpread}px ${config.glowColor}`,
      pointerEvents: "none", zIndex: 5, transition: "all 0.4s ease", borderRadius: 12,
    }} />
  );
}

function AlertBanner({ text, color }: { text: string; color: string }) {
  return (
    <motion.div key={text} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
      style={{
        position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 6,
        fontSize: 14, fontWeight: 600, letterSpacing: "0.04em",
        padding: "8px 24px", borderRadius: 24,
        background: ALERT_COLORS[color] ? `${ALERT_COLORS[color]}dd` : "#555555dd",
        color: "#fff", whiteSpace: "nowrap", textShadow: "0 1px 4px rgba(0,0,0,0.5)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      }}>
      {text}
    </motion.div>
  );
}

function StatusDots({ detections }: { detections: typeof SCENES[AppScene]["detections"] }) {
  const items = [
    { label: "POT", on: detections.pot, color: "#ef4444" },
    { label: "HUM", on: detections.hum, color: "#f59e0b" },
    { label: "VEH", on: detections.veh, color: "#a855f7" },
  ];
  return (
    <div className="absolute top-[16px] right-[16px] z-[6] flex flex-col gap-[4px]">
      {items.map(it => (
        <div key={it.label} style={{
          display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
          borderRadius: 6, background: "rgba(0,0,0,0.6)", fontSize: 11, fontWeight: 500,
          color: it.on ? it.color : "#555", border: `1px solid ${it.on ? it.color + "66" : "transparent"}`,
          transition: "all 0.3s",
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", background: it.on ? it.color : "#444",
            boxShadow: it.on ? `0 0 8px ${it.color}88` : "none", transition: "all 0.3s",
          }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}

function CameraInfoBar({ gpsSpeed, inferenceMs, modelLoaded, cameraLabel }: {
  gpsSpeed: number; inferenceMs: number; modelLoaded: boolean; cameraLabel: string;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-[6]"
      style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.8))", padding: "24px 16px 12px" }}>
      <div className="flex justify-between items-end">
        <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontSize: 28, fontWeight: 600, color: "#fff" }}>{gpsSpeed}</span>
          <span style={{ fontSize: 11, color: "#888" }}>km/h</span>
        </div>
        <div className="flex gap-3">
          <StatusTag label="CAM" value={cameraLabel} color="#22c55e" />
          <StatusTag label="INFER" value={modelLoaded ? `${inferenceMs || 0}ms` : "LOAD"} color="#f59e0b" />
        </div>
      </div>
    </div>
  );
}

function StatusTag({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>{label}</div>
    </div>
  );
}

function DisconnectOverlay() {
  return (
    <div className="absolute inset-0 z-[20] flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)", borderRadius: 12 }}>
      <Camera size={48} className="text-[#444] mb-4" />
      <span style={{ fontSize: 16, fontWeight: 500, color: "#777" }}>No Camera</span>
      <span style={{ fontSize: 12, color: "#444", marginTop: 6 }}>Connect a camera or check settings</span>
    </div>
  );
}

// ============================================
// CAMERA VIEW
// ============================================
function CameraView({
  settings, scene, espConnected, gpsSpeed,
  onReport, mediaRef, inferenceMs, modelLoaded, onCameraError, onESPStreamReady,
}: {
  settings: AppSettings; scene: AppScene; espConnected: boolean;
  gpsSpeed: number;
  onReport: () => void;
  mediaRef: React.MutableRefObject<HTMLVideoElement | HTMLImageElement | null>;
  inferenceMs: number; modelLoaded: boolean;
  onCameraError: (hasError: boolean) => void;
  onESPStreamReady: (live: boolean) => void;
}) {
  const isESP32 = settings.cameraSource === "esp32";
  const phoneCam = usePhoneCamera(!isESP32);
  const config = SCENES[scene];

  // ESP32 stream state — dead simple
  const espImgRef = useRef<HTMLImageElement>(null);
  const [espLive, setEspLive] = useState(false);
  const [espError, setEspError] = useState(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Simple reconnect: just set a new src with cache-buster
  const espReconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    reconnectRef.current = setTimeout(() => {
      if (espImgRef.current) {
        espImgRef.current.src = `${settings.esp32Url}:81/stream?t=${Date.now()}`;
      }
    }, 3000);
  }, [settings.esp32Url]);

  // Cleanup reconnect timer on unmount
  useEffect(() => {
    return () => { if (reconnectRef.current) clearTimeout(reconnectRef.current); };
  }, []);

  // Notify parent when ESP32 stream state changes
  useEffect(() => {
    if (isESP32) onESPStreamReady(espLive);
  }, [espLive, isESP32]);

  // Keep mediaRef pointing to the correct element for detection
  useEffect(() => {
    if (isESP32) {
      mediaRef.current = espImgRef.current;
    } else {
      mediaRef.current = phoneCam.videoRef.current;
    }
    onCameraError(!!phoneCam.error);
  });

  const showDisconnect = (isESP32 && espError) || (!isESP32 && !!phoneCam.error);

  return (
    <div className="flex-1 min-h-0 flex flex-col px-3 pt-2 pb-1">
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-[#111]"
        style={{ border: "1px solid #222" }}>

        {!isESP32 && (
          <video ref={phoneCam.videoRef} autoPlay playsInline muted
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}

        {isESP32 && (
          <img ref={espImgRef}
            src={`${settings.esp32Url}:81/stream`}
            alt="ESP32 camera"
            onLoad={() => { setEspLive(true); setEspError(false); }}
            onError={() => { setEspLive(false); setEspError(true); espReconnect(); }}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}

        <AlertBorder config={config} />
        <AnimatePresence mode="wait">
          <AlertBanner text={config.alertLabel} color={config.alertLevel} />
        </AnimatePresence>
        <StatusDots detections={config.detections} />
        <CameraInfoBar
          gpsSpeed={gpsSpeed} inferenceMs={inferenceMs} modelLoaded={modelLoaded}
          cameraLabel={isESP32 ? (espLive ? "ESP32" : espError ? "OFF" : "...") : (!phoneCam.error ? "PHONE" : "ERR")} />

        {showDisconnect && <DisconnectOverlay />}
        {isESP32 && !espLive && !espError && (
          <div className="absolute inset-0 z-[20] flex flex-col items-center justify-center"
            style={{ background: "rgba(0,0,0,0.85)", borderRadius: 12 }}>
            <div className="animate-spin w-10 h-10 border-3 border-[#22d3ee33] border-t-[#22d3ee] rounded-full mb-3" />
            <span style={{ fontSize: 14, fontWeight: 500, color: "#22d3ee" }}>Connecting to ESP32-CAM...</span>
            <span style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{settings.esp32Url}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 py-3">
        <ControlButton icon={<AlertTriangle size={22} />} label="Report"
          primary onClick={onReport}
          style={{ borderColor: "#ef4444", color: "#ef4444" }} />
      </div>
    </div>
  );
}

function ControlButton({ icon, label, onClick, primary, style }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  primary?: boolean; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} aria-label={label}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
        padding: "10px 14px", borderRadius: 12, cursor: "pointer",
        background: primary ? "#ef444418" : "#ffffff08",
        border: `1px solid ${primary ? "#ef444466" : "#333"}`,
        color: primary ? "#ef4444" : "#999",
        transition: "all 0.15s ease",
        minWidth: 56, minHeight: 56,
        ...(style || {}),
      }}>
      {icon}
      <span style={{ fontSize: 9, opacity: 0.7 }}>{label}</span>
    </button>
  );
}

// ============================================
// MAP VIEW — Now with REAL hazard data from backend
// ============================================
function MapView({ gpsSpeed, hazards, nearbyCount, totalReports, loading }: {
  gpsSpeed: number;
  hazards: HazardItem[];
  nearbyCount: number;
  totalReports: number;
  loading: boolean;
}) {
  const closestHazard = hazards.length > 0 ? hazards[0] : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center px-4 py-3 gap-3">
      {/* Summary card */}
      <div className="w-full max-w-sm rounded-xl overflow-hidden bg-[#111] border border-[#222] p-5 text-center">
        <Map size={40} className="text-[#22d3ee] mx-auto mb-3" />
        <h2 className="text-white text-lg font-semibold mb-1">Hazard Map</h2>
        <p className="text-[#666] text-xs mb-4">
          Live pothole reports near your location
        </p>
        <div className="flex justify-center gap-6 text-sm">
          <div className="text-center">
            <div className="text-[#22c55e] font-semibold">{gpsSpeed}</div>
            <div className="text-[#555] text-xs">km/h</div>
          </div>
          <div className="text-center">
            <div className={`font-semibold ${nearbyCount > 0 ? "text-[#f59e0b]" : "text-[#555]"}`}>
              {loading ? "..." : nearbyCount}
            </div>
            <div className="text-[#555] text-xs">Nearby</div>
          </div>
          <div className="text-center">
            <div className={`font-semibold ${totalReports > 0 ? "text-[#ef4444]" : "text-[#555]"}`}>
              {totalReports}
            </div>
            <div className="text-[#555] text-xs">Total</div>
          </div>
        </div>
      </div>

      {/* Closest hazard alert */}
      {closestHazard && (
        <div className="w-full max-w-sm rounded-xl bg-[#ef444410] border border-[#ef444433] p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[#ef4444]" />
            <span className="text-[#ef4444] text-sm font-semibold">Closest Hazard</span>
          </div>
          <div className="text-[#ccc] text-xs space-y-1">
            <div>Distance: <span className="text-[#f59e0b] font-semibold">{Math.round(closestHazard.distance_m)}m</span></div>
            <div>Severity: <span className="text-[#ef4444] font-semibold">{closestHazard.severity_score}</span></div>
            <div>Location: {closestHazard.latitude.toFixed(4)}, {closestHazard.longitude.toFixed(4)}</div>
            <div>Last seen: {new Date(closestHazard.last_seen).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Hazard list */}
      {hazards.length > 0 && (
        <div className="w-full max-w-sm space-y-2">
          <h3 className="text-[#888] text-xs font-semibold uppercase tracking-wider">All Nearby Hazards</h3>
          {hazards.slice(0, 10).map((h, i) => (
            <div key={h.report_id} className="bg-[#111] border border-[#222] rounded-lg p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#ef444418] flex items-center justify-center text-[#ef4444] text-xs font-bold">
                {i + 1}
              </div>
              <div className="flex-1 text-xs">
                <div className="text-[#ccc]">{Math.round(h.distance_m)}m away — Severity: {h.severity_score}</div>
                <div className="text-[#555]">{new Date(h.last_seen).toLocaleDateString()}</div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-semibold ${h.distance_m < 100 ? "text-[#ef4444]" : h.distance_m < 500 ? "text-[#f59e0b]" : "text-[#22c55e]"}`}>
                  {h.distance_m < 100 ? "CLOSE" : h.distance_m < 500 ? "NEAR" : "OK"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && hazards.length === 0 && (
        <div className="text-[#555] text-xs py-4">No hazards nearby — road is clear!</div>
      )}
    </div>
  );
}

// ============================================
// SETTINGS VIEW
// ============================================
function SettingsView({ settings, onUpdate, backendHealth }: {
  settings: AppSettings; onUpdate: (s: AppSettings) => void;
  backendHealth: HealthResponse | null;
}) {
  const toggle = (key: keyof AppSettings) => {
    onUpdate({ ...settings, [key]: !settings[key] });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
      <div className="max-w-sm mx-auto space-y-4">

        {/* Camera source */}
        <SettingsGroup title="Camera Source">
          <div className="flex gap-2">
            <SourceButton
              icon={<Smartphone size={18} />} label="Phone Camera"
              active={settings.cameraSource === "phone"}
              onClick={() => onUpdate({ ...settings, cameraSource: "phone" })} />
            <SourceButton
              icon={<Wifi size={18} />} label="ESP32-CAM"
              active={settings.cameraSource === "esp32"}
              onClick={() => onUpdate({ ...settings, cameraSource: "esp32" })} />
          </div>
        </SettingsGroup>

        {/* ESP32 config */}
        {settings.cameraSource === "esp32" && (
          <SettingsGroup title="ESP32-CAM URL">
            <input type="text" value={settings.esp32Url}
              onChange={e => onUpdate({ ...settings, esp32Url: e.target.value })}
              placeholder="http://192.168.4.1"
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8,
                background: "#1a1a1a", border: "1px solid #333", color: "#fff",
                fontSize: 14, outline: "none",
              }} />
          </SettingsGroup>
        )}

        {/* Backend connection */}
        <SettingsGroup title="Backend Server">
          <input type="text" value={settings.backendUrl}
            onChange={e => onUpdate({ ...settings, backendUrl: e.target.value })}
            placeholder="http://localhost:8000"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 8,
              background: "#1a1a1a", border: "1px solid #333", color: "#fff",
              fontSize: 14, outline: "none", marginBottom: 12,
            }} />
          {backendHealth && (
            <div className="flex items-center gap-2 text-xs mb-2">
              <Activity size={12} className={backendHealth.status === "ok" ? "text-[#22c55e]" : "text-[#ef4444]"} />
              <span className={backendHealth.status === "ok" ? "text-[#22c55e]" : "text-[#ef4444]"}>
                {backendHealth.status === "ok" ? "Connected" : "Error"}
              </span>
              <span className="text-[#555]">
                | Pothole: {backendHealth.models_loaded.pothole ? "✓" : "✗"}
                | YOLO: {backendHealth.models_loaded.yolov8 ? "✓" : "✗"}
                | Reports: {backendHealth.reports_count}
              </span>
            </div>
          )}
          {!backendHealth && (
            <div className="flex items-center gap-2 text-xs text-[#666]">
              <WifiOff size={12} /> Not connected to backend
            </div>
          )}
          <ToggleRow icon={<Server size={16} />} label="Backend ML Detection"
            checked={settings.useBackendDetection}
            onChange={() => toggle("useBackendDetection")} />
          <div className="text-[#555] text-[10px] mt-1">
            {settings.useBackendDetection
              ? "✓ Using Roboflow (pothole) + YOLOv8 (objects) on server"
              : "Using local TF.js (objects only, no pothole detection)"}
          </div>
        </SettingsGroup>

        {/* Detection */}
        <SettingsGroup title="Detection & Alerts">
          <ToggleRow icon={<Eye size={16} />} label="Alert Sounds"
            checked={settings.soundsEnabled} onChange={() => toggle("soundsEnabled")} />
          <ToggleRow icon={<Zap size={16} />} label="Voice Cues"
            checked={settings.voiceCuesEnabled} onChange={() => toggle("voiceCuesEnabled")} />
          <ToggleRow icon={<Smartphone size={16} />} label="Haptic Feedback"
            checked={settings.hapticsEnabled} onChange={() => toggle("hapticsEnabled")} />
          <ToggleRow icon={<EyeOff size={16} />} label="Screen Wake Lock"
            checked={settings.wakeLockEnabled} onChange={() => toggle("wakeLockEnabled")} />
        </SettingsGroup>

        {/* About */}
        <div className="text-center py-4 space-y-1">
          <div className="text-[#555] text-xs font-medium">PotholeNet v1.0.0</div>
          <div className="text-[#22d3ee] text-[10px]">Implements UM IP PI 2017704203</div>
          <div className="text-[#444] text-[10px]">Assistive system. Driver retains full control.</div>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111] rounded-xl border border-[#222] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1a1a1a]">
        <span style={{ fontSize: 13, fontWeight: 600, color: "#888", letterSpacing: "0.04em" }}>{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function SourceButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      padding: "12px 16px", borderRadius: 10, cursor: "pointer",
      background: active ? "#22d3ee18" : "#ffffff08",
      border: `1px solid ${active ? "#22d3ee66" : "#333"}`,
      color: active ? "#22d3ee" : "#888", transition: "all 0.2s",
    }}>
      {icon}
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
    </button>
  );
}

function ToggleRow({ icon, label, checked, onChange }: {
  icon: React.ReactNode; label: string; checked: boolean; onChange: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "#666", display: "flex" }}>{icon}</span>
        <span style={{ fontSize: 15, color: "#e5e5e5", fontWeight: 400 }}>{label}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        style={{
          position: "relative",
          width: 51,
          height: 31,
          borderRadius: 16,
          background: checked ? "#34c759" : "rgba(120, 120, 128, 0.32)",
          border: "none",
          cursor: "pointer",
          transition: "background 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          flexShrink: 0,
          WebkitTapHighlightColor: "transparent",
          outline: "none",
        }}
      >
        <span style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 27,
          height: 27,
          borderRadius: 14,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4), 0 1px 1px rgba(0,0,0,0.1)",
          transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          transform: checked ? "translateX(20px)" : "translateX(0)",
        }} />
      </button>
    </div>
  );
}

// ============================================
// TAB BAR
// ============================================
function TabBar({ active, onChange, hazardCount }: { active: TabView; onChange: (t: TabView) => void; hazardCount: number }) {
  const tabs: { id: TabView; icon: React.ReactNode; label: string }[] = [
    { id: "camera", icon: <Camera size={20} />, label: "Camera" },
    { id: "map", icon: <MapPin size={20} />, label: `Map${hazardCount > 0 ? ` (${hazardCount})` : ""}` },
    { id: "settings", icon: <Settings size={20} />, label: "Settings" },
  ];
  return (
    <div className="flex items-center justify-around bg-[#111] border-t border-[#1a1a1a]"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)", paddingTop: 6 }}>
      {tabs.map(tab => {
        const isActive = tab.id === active;
        return (
          <button key={tab.id} onClick={() => onChange(tab.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            padding: "8px 20px", borderRadius: 10, cursor: "pointer",
            background: isActive ? "#22d3ee12" : "transparent",
            border: "none", transition: "all 0.2s",
          }}>
            <span style={{ color: isActive ? "#22d3ee" : "#555", transition: "color 0.2s" }}>{tab.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: 500,
              color: isActive ? "#22d3ee" : "#555", transition: "color 0.2s",
            }}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// MAIN APP — Everything Connected
// ============================================
export default function PotholeNetApp() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem("potholenet:settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  });
  useEffect(() => {
    try { localStorage.setItem("potholenet:settings", JSON.stringify(settings)); } catch {}
  }, [settings]);

  const [tab, setTab] = useState<TabView>("camera");
  const [scene, setScene] = useState<AppScene>("CLEAR");
  const [reportToast, setReportToast] = useState("");
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);

  const isESP32 = settings.cameraSource === "esp32";
  const { connected: espConnected } = useESPHeartbeat(settings.esp32Url, isESP32);
  const { speed: gpsSpeed, coords, gpsStatus } = useGPS(true);

  // ── Backend health check (every 15s) ──
  useEffect(() => {
    const doCheck = async () => {
      try {
        const health = await checkHealth();
        setBackendHealth(health);
      } catch {
        setBackendHealth(null);
      }
    };
    doCheck();
    const interval = setInterval(doCheck, 15000);
    return () => clearInterval(interval);
  }, [settings.backendUrl]);

  // ── Push GPS to backend (every 5s) ──
  useEffect(() => {
    if (!coords) return;
    const doUpdate = () => {
      updateLocation({
        latitude: coords.lat,
        longitude: coords.lng,
        speed_kmh: gpsSpeed,
      }).catch(() => {});
    };
    doUpdate();
    const interval = setInterval(doUpdate, 5000);
    return () => clearInterval(interval);
  }, [coords?.lat, coords?.lng, gpsSpeed]);

  // ── Hazard polling from backend ──
  const { hazards, nearbyCount } = useHazards(coords, true);

  // For detection, we need a ref to the video/img element
  const detectTargetRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);

  const { detections, inferenceMs, modelLoaded } = useDetection(
    detectTargetRef, tab === "camera", settings.detectionThreshold,
    settings.useBackendDetection, gpsSpeed
  );

  const [phoneCamError, setPhoneCamError] = useState(false);
  const [espStreamLive, setEspStreamLive] = useState(false);

  // Derive scene from detections — use ACTUAL stream state, not heartbeat
  useEffect(() => {
    if (tab !== "camera") return;
    const cameraOk = isESP32 ? espStreamLive : !phoneCamError;
    const derived = deriveAlertState(detections, gpsSpeed, !cameraOk);
    setScene(derived);
  }, [detections, gpsSpeed, espStreamLive, isESP32, tab, phoneCamError]);

  useAudioCues(scene, settings.soundsEnabled, settings.voiceCuesEnabled);
  useVibration(scene, settings.hapticsEnabled);
  useWakeLock(settings.wakeLockEnabled && tab === "camera");

  // ── Report pothole → POST /reports ──
  const handleReport = useCallback(async () => {
    if (settings.hapticsEnabled && navigator.vibrate) navigator.vibrate(50);

    // Get confidence from current detections
    const potholeDet = detections.find(d => d.label === "pothole");
    const confidence = potholeDet ? potholeDet.confidence : 50;

    if (coords) {
      try {
        const result = await submitReport({
          latitude: coords.lat,
          longitude: coords.lng,
          confidence,
          vehicle_type: "car",
          speed_kmh: gpsSpeed,
        });
        setReportToast(`📸 Pothole reported! Severity: ${result.severity_score}${result.is_new ? " (new)" : " (updated)"}`);
      } catch (err: any) {
        setReportToast(`⚠️ Report failed: ${err.message}`);
      }
    } else {
      setReportToast("⚠️ No GPS — can't report location");
    }
    setTimeout(() => setReportToast(""), 3000);
  }, [settings.hapticsEnabled, coords, detections, gpsSpeed]);

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col overflow-hidden"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div className="landscape-lock" />

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d0d0d] border-b border-[#1a1a1a]"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 8px)" }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 15, fontWeight: 700, color: "#22d3ee" }}>PotholeNet</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Backend status badge */}
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
            background: backendHealth ? "#22c55e18" : "#ef444418",
            color: backendHealth ? "#22c55e" : "#ef4444",
            border: `1px solid ${backendHealth ? "#22c55e33" : "#ef444433"}`,
          }}>
            {backendHealth ? "SERVER ✓" : "SERVER ✗"}
          </span>
          {/* Camera status — uses ACTUAL stream state, not heartbeat */}
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
            background: (isESP32 ? espStreamLive : true) ? "#22c55e18" : "#ef444418",
            color: (isESP32 ? espStreamLive : true) ? "#22c55e" : "#ef4444",
            border: `1px solid ${(isESP32 ? espStreamLive : true) ? "#22c55e33" : "#ef444433"}`,
          }}>
            {isESP32 ? (espStreamLive ? "ESP32 LIVE" : "ESP32 OFF") : "PHONE CAM"}
          </span>
          {/* GPS status */}
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
            background: gpsStatus === "locked" ? "#22d3ee18" : "#66666618",
            color: gpsStatus === "locked" ? "#22d3ee" : "#666",
          }}>
            GPS {gpsStatus === "locked" ? "✓" : "..."}
          </span>
        </div>
      </div>

      {/* Main content area */}
      {tab === "camera" && (
        <CameraView settings={settings} scene={scene} espConnected={espConnected}
          mediaRef={detectTargetRef} inferenceMs={inferenceMs} modelLoaded={modelLoaded}
          gpsSpeed={gpsSpeed} onReport={handleReport} onCameraError={setPhoneCamError}
          onESPStreamReady={setEspStreamLive} />
      )}
      {tab === "map" && (
        <MapView
          gpsSpeed={gpsSpeed}
          hazards={hazards}
          nearbyCount={nearbyCount}
          totalReports={backendHealth?.reports_count || 0}
          loading={false}
        />
      )}
      {tab === "settings" && (
        <SettingsView settings={settings} onUpdate={setSettings} backendHealth={backendHealth} />
      )}

      {/* Report toast */}
      <AnimatePresence>
        {reportToast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[#22c55e] text-black text-sm font-semibold px-5 py-3 rounded-xl"
            style={{ boxShadow: "0 8px 30px rgba(34,197,94,0.3)" }}>
            {reportToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab bar */}
      <TabBar active={tab} onChange={setTab} hazardCount={nearbyCount} />
    </div>
  );
}