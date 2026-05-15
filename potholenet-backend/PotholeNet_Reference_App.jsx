import { useState, useEffect, useCallback, useRef } from "react";

// ============================================
// TYPES
// ============================================
type AppScene =
  | "REVERSE_CLEAR"
  | "REVERSE_APPROACHING"
  | "REVERSE_DANGER"
  | "REVERSE_PERSON"
  | "REVERSE_POTHOLE"
  | "DRIVING"
  | "DISCONNECTED";

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  conf: number;
  color: string;
}

interface SceneConfig {
  mode: "REVERSE" | "DRIVING";
  alertLevel: "green" | "orange" | "red" | "cyan" | "gray";
  alertLabel: string;
  modeColor: string;
  borderColor: string;
  glowColor: string;
  glowSpread: number;
  pulse: "none" | "slow" | "fast";
  speed: number;
  confidence: string;
  confColor: string;
  detections: { pot: boolean; hum: boolean; veh: boolean };
  bboxes: BBox[];
  showHazardCard: boolean;
  showDisconnect: boolean;
  streamLost: boolean;
  description: string;
  ipCallout: string;
}

// ============================================
// SCENE CONFIGS
// ============================================
const SCENES: Record<AppScene, SceneConfig> = {
  REVERSE_CLEAR: {
    mode: "REVERSE",
    alertLevel: "green",
    alertLabel: "CLEAR",
    modeColor: "#22c55e",
    borderColor: "#22c55e",
    glowColor: "rgba(34,197,94,0.15)",
    glowSpread: 20,
    pulse: "none",
    speed: 0,
    confidence: "—",
    confColor: "#22d3ee",
    detections: { pot: false, hum: false, veh: false },
    bboxes: [],
    showHazardCard: false,
    showDisconnect: false,
    streamLost: false,
    description: "No obstacles detected — green means clear to reverse",
    ipCallout: "",
  },
  REVERSE_APPROACHING: {
    mode: "REVERSE",
    alertLevel: "orange",
    alertLabel: "SLOW DOWN",
    modeColor: "#f59e0b",
    borderColor: "#f59e0b",
    glowColor: "rgba(245,158,11,0.2)",
    glowSpread: 30,
    pulse: "slow",
    speed: 3,
    confidence: "87%",
    confColor: "#f59e0b",
    detections: { pot: false, hum: false, veh: true },
    bboxes: [{ x: 130, y: 80, w: 50, h: 80, label: "car", conf: 87, color: "#f59e0b" }],
    showHazardCard: false,
    showDisconnect: false,
    streamLost: false,
    description: "Vehicle detected at 1–3m — beep cadence increases",
    ipCallout: "",
  },
  REVERSE_DANGER: {
    mode: "REVERSE",
    alertLevel: "red",
    alertLabel: "STOP",
    modeColor: "#ef4444",
    borderColor: "#ef4444",
    glowColor: "rgba(239,68,68,0.25)",
    glowSpread: 40,
    pulse: "fast",
    speed: 2,
    confidence: "94%",
    confColor: "#ef4444",
    detections: { pot: false, hum: false, veh: true },
    bboxes: [{ x: 120, y: 140, w: 60, h: 90, label: "car", conf: 94, color: "#ef4444" }],
    showHazardCard: false,
    showDisconnect: false,
    streamLost: false,
    description: "Vehicle within 1m — immediate stop warning",
    ipCallout: "",
  },
  REVERSE_PERSON: {
    mode: "REVERSE",
    alertLevel: "red",
    alertLabel: "⚠ PERSON — STOP",
    modeColor: "#ef4444",
    borderColor: "#ef4444",
    glowColor: "rgba(239,68,68,0.3)",
    glowSpread: 40,
    pulse: "fast",
    speed: 1,
    confidence: "91%",
    confColor: "#ef4444",
    detections: { pot: false, hum: true, veh: false },
    bboxes: [{ x: 150, y: 130, w: 40, h: 55, label: "person", conf: 91, color: "#ef4444" }],
    showHazardCard: false,
    showDisconnect: false,
    streamLost: false,
    description: "Person detected at ANY distance — instant red (ethical value module)",
    ipCallout: "IP Pillar: Ethical Value Module — person/animal detection bypasses distance thresholds",
  },
  REVERSE_POTHOLE: {
    mode: "REVERSE",
    alertLevel: "red",
    alertLabel: "POTHOLE DETECTED",
    modeColor: "#22c55e",
    borderColor: "#ef4444",
    glowColor: "rgba(239,68,68,0.15)",
    glowSpread: 15,
    pulse: "none",
    speed: 1,
    confidence: "82%",
    confColor: "#ef4444",
    detections: { pot: true, hum: false, veh: false },
    bboxes: [{ x: 135, y: 165, w: 50, h: 30, label: "pothole", conf: 82, color: "#ef4444" }],
    showHazardCard: false,
    showDisconnect: false,
    streamLost: false,
    description: "Pothole detected on road surface — hazard alert",
    ipCallout: "",
  },
  DRIVING: {
    mode: "DRIVING",
    alertLevel: "cyan",
    alertLabel: "MONITORING",
    modeColor: "#22d3ee",
    borderColor: "#22d3ee",
    glowColor: "rgba(34,211,238,0.1)",
    glowSpread: 15,
    pulse: "none",
    speed: 47,
    confidence: "76%",
    confColor: "#22d3ee",
    detections: { pot: true, hum: false, veh: true },
    bboxes: [
      { x: 80, y: 175, w: 40, h: 25, label: "pothole", conf: 76, color: "#ef4444" },
      { x: 190, y: 55, w: 50, h: 65, label: "car", conf: 89, color: "#a855f7" },
    ],
    showHazardCard: true,
    showDisconnect: false,
    streamLost: false,
    description: "Driving mode — predictive warning from crowdsourced map",
    ipCallout: "IP Pillar: Cloud AI + Adaptive Learning — predictive warning from crowdsourced data",
  },
  DISCONNECTED: {
    mode: "REVERSE",
    alertLevel: "gray",
    alertLabel: "NO SIGNAL",
    modeColor: "#666666",
    borderColor: "#666666",
    glowColor: "transparent",
    glowSpread: 0,
    pulse: "none",
    speed: 0,
    confidence: "—",
    confColor: "#666666",
    detections: { pot: false, hum: false, veh: false },
    bboxes: [],
    showHazardCard: false,
    showDisconnect: true,
    streamLost: true,
    description: "Camera feed lost — NEVER shows false green",
    ipCallout: "IP Pillar: Value-Driven Decisions — system fails visibly, never silently",
  },
};

const ALERT_COLORS: Record<string, string> = {
  green: "#22c55e",
  orange: "#f59e0b",
  red: "#ef4444",
  cyan: "#22d3ee",
  gray: "#666666",
};

const DEMO_SEQUENCE: { scene: AppScene; duration: number }[] = [
  { scene: "REVERSE_CLEAR", duration: 3000 },
  { scene: "REVERSE_APPROACHING", duration: 3000 },
  { scene: "REVERSE_DANGER", duration: 3000 },
  { scene: "REVERSE_CLEAR", duration: 2000 },
  { scene: "REVERSE_PERSON", duration: 3500 },
  { scene: "REVERSE_POTHOLE", duration: 3000 },
  { scene: "DRIVING", duration: 4000 },
  { scene: "DISCONNECTED", duration: 3000 },
];

// ============================================
// CANVAS DRAWING
// ============================================
function drawRoad(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(100, 0);
  ctx.lineTo(220, 0);
  ctx.lineTo(290, 240);
  ctx.lineTo(30, 240);
  ctx.closePath();
  ctx.fill();
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(160, 0);
  ctx.lineTo(160, 240);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(100, 0);
  ctx.lineTo(30, 240);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(220, 0);
  ctx.lineTo(290, 240);
  ctx.stroke();
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#3a4055";
  const r = 4;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5a6080";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#ffee77";
  ctx.fillRect(x + 3, y + 2, 5, 4);
  ctx.fillRect(x + w - 8, y + 2, 5, 4);
  ctx.fillStyle = "#ff4444";
  ctx.fillRect(x + 3, y + h - 6, 5, 4);
  ctx.fillRect(x + w - 8, y + h - 6, 5, 4);
  ctx.fillStyle = "#2a3045";
  ctx.fillRect(x + 6, y + 8, w - 12, h * 0.25);
}

function drawPothole(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.ellipse(x, y, 20, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#d4d4d4";
  ctx.beginPath();
  ctx.arc(x, y - 18, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#777";
  ctx.fillRect(x - 5, y - 11, 10, 20);
  ctx.fillStyle = "#666";
  ctx.fillRect(x - 8, y - 9, 4, 14);
  ctx.fillRect(x + 4, y - 9, 4, 14);
  ctx.fillRect(x - 4, y + 9, 3, 12);
  ctx.fillRect(x + 1, y + 9, 3, 12);
  ctx.fillStyle = "#555";
  ctx.fillRect(x - 5, y + 19, 4, 3);
  ctx.fillRect(x + 1, y + 19, 4, 3);
}

function drawScene(canvas: HTMLCanvasElement, scene: AppScene) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = 320;
  canvas.height = 240;

  if (scene === "DISCONNECTED") {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, 320, 240);
    return;
  }

  drawRoad(ctx);

  switch (scene) {
    case "REVERSE_APPROACHING":
      drawCar(ctx, 135, 80, 50, 80);
      break;
    case "REVERSE_DANGER":
      drawCar(ctx, 125, 140, 60, 92);
      break;
    case "REVERSE_PERSON":
      drawPerson(ctx, 170, 165);
      break;
    case "REVERSE_POTHOLE":
      drawPothole(ctx, 160, 185);
      break;
    case "DRIVING":
      drawPothole(ctx, 105, 195);
      drawCar(ctx, 200, 55, 42, 62);
      break;
  }
}

// ============================================
// COMPONENTS
// ============================================

function StatusBar() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "10px 18px 4px",
        fontSize: 11,
        color: "#888",
        fontFamily: "var(--pn-font-ui, -apple-system, sans-serif)",
        userSelect: "none",
      }}
    >
      <span style={{ fontWeight: 500 }}>9:41</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10, letterSpacing: 0.5 }}>LTE</span>
        <svg width="18" height="11" viewBox="0 0 18 11">
          <rect x="0" y="0" width="15" height="11" rx="2" fill="none" stroke="#888" strokeWidth="1" />
          <rect x="2" y="2.5" width="9" height="6" rx="1" fill="#888" />
          <rect x="16" y="3" width="2" height="5" rx="0.5" fill="#888" />
        </svg>
      </div>
    </div>
  );
}

function AlertBorder({ config }: { config: SceneConfig }) {
  const pulseClass =
    config.pulse === "fast"
      ? "pulse-fast"
      : config.pulse === "slow"
      ? "pulse-slow"
      : "";

  return (
    <div
      className={pulseClass}
      style={{
        position: "absolute",
        inset: 0,
        border: `4px solid ${config.borderColor}`,
        boxShadow: `inset 0 0 ${config.glowSpread}px ${config.glowColor}`,
        pointerEvents: "none",
        zIndex: 5,
        transition: "box-shadow 0.4s ease",
      }}
    />
  );
}

function AlertLabel({ text, color }: { text: string; color: string }) {
  return (
    <div
      key={text}
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 6,
        fontFamily: "var(--pn-font-ui, -apple-system, sans-serif)",
        fontSize: text.length > 12 ? 11 : 13,
        fontWeight: 500,
        letterSpacing: "0.06em",
        padding: "5px 18px",
        borderRadius: 20,
        background: ALERT_COLORS[color] ? `${ALERT_COLORS[color]}e6` : "#666e6",
        color: "#fff",
        whiteSpace: "nowrap",
        textShadow: "0 1px 3px rgba(0,0,0,0.4)",
      }}
    >
      {text}
    </div>
  );
}

function ModeBadge({ mode, color }: { mode: string; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 6,
        fontFamily: "var(--pn-font-mono, monospace)",
        fontSize: 10,
        fontWeight: 500,
        padding: "3px 8px",
        borderRadius: 4,
        background: "rgba(0,0,0,0.65)",
        color,
        border: `1px solid ${color}44`,
        letterSpacing: "0.05em",
      }}
    >
      {mode}
    </div>
  );
}

function DetectionPill({
  label,
  active,
  activeColor,
}: {
  label: string;
  active: boolean;
  activeColor: string;
}) {
  const c = active ? activeColor : "#60a5fa";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 4,
        background: "rgba(0,0,0,0.65)",
        fontSize: 10,
        fontFamily: "var(--pn-font-mono, monospace)",
        color: c,
        border: `1px solid ${c}44`,
        transition: "color 0.3s, border-color 0.3s",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: c,
          transition: "background 0.3s",
          boxShadow: active ? `0 0 6px ${c}88` : "none",
        }}
      />
      {label}
    </div>
  );
}

function DetectionStack({ config }: { config: SceneConfig }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 6,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <DetectionPill label="POT" active={config.detections.pot} activeColor="#ef4444" />
      <DetectionPill label="HUM" active={config.detections.hum} activeColor="#f59e0b" />
      <DetectionPill label="VEH" active={config.detections.veh} activeColor="#a855f7" />
    </div>
  );
}

function BoundingBoxOverlay({ bboxes }: { bboxes: BBox[] }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }}>
      <svg viewBox="0 0 320 240" style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
        {bboxes.map((b, i) => (
          <g key={i}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill="none"
              stroke={b.color}
              strokeWidth={2}
              rx={2}
              strokeDasharray={b.label === "pothole" ? "6 3" : "none"}
            />
            <rect
              x={b.x}
              y={b.y - 14}
              width={b.label.length * 6.5 + 30}
              height={14}
              fill={`${b.color}cc`}
              rx={2}
            />
            <text
              x={b.x + 3}
              y={b.y - 3}
              fill="#fff"
              fontSize={10}
              fontFamily="monospace"
            >
              {b.label} {b.conf}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function SpeedBadge({ speed }: { speed: number }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 10,
        left: 10,
        zIndex: 6,
        fontFamily: "var(--pn-font-mono, monospace)",
        color: "#fff",
        background: "rgba(0,0,0,0.65)",
        padding: "4px 10px",
        borderRadius: 6,
        display: "flex",
        alignItems: "baseline",
        gap: 2,
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 500 }}>{speed}</span>
      <span style={{ fontSize: 10, color: "#888" }}>km/h</span>
    </div>
  );
}

function ConfidenceBadge({ value, color }: { value: string; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 10,
        right: 10,
        zIndex: 6,
        fontFamily: "var(--pn-font-mono, monospace)",
        fontSize: 11,
        color: "#888",
        background: "rgba(0,0,0,0.65)",
        padding: "4px 8px",
        borderRadius: 4,
      }}
    >
      CONF <span style={{ color }}>{value}</span>
    </div>
  );
}

function DisconnectOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
      }}
    >
      <svg width="52" height="52" viewBox="0 0 52 52" style={{ marginBottom: 14 }}>
        <circle cx="26" cy="26" r="22" fill="none" stroke="#555" strokeWidth="2.5" />
        <line x1="14" y1="14" x2="38" y2="38" stroke="#555" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span
        style={{
          fontFamily: "var(--pn-font-ui, sans-serif)",
          fontSize: 14,
          fontWeight: 500,
          color: "#777",
          letterSpacing: "0.06em",
        }}
      >
        CAMERA DISCONNECTED
      </span>
      <span
        style={{
          fontFamily: "var(--pn-font-ui, sans-serif)",
          fontSize: 11,
          color: "#444",
          marginTop: 6,
        }}
      >
        Check Wi-Fi connection to PotholeNet-AP
      </span>
    </div>
  );
}

function InfoStrip({ streamLost }: { streamLost: boolean }) {
  const inferMs = useRef(18);
  const [ms, setMs] = useState(18);
  useEffect(() => {
    const iv = setInterval(() => {
      inferMs.current = 15 + Math.floor(Math.random() * 11);
      setMs(inferMs.current);
    }, 1200);
    return () => clearInterval(iv);
  }, []);

  const items = [
    { label: "STREAM", value: streamLost ? "LOST" : "LIVE", color: streamLost ? "#ef4444" : "#22c55e" },
    { label: "GPS", value: "LOCKED", color: "#22d3ee" },
    { label: "CLOUD", value: "SYNCED", color: "#a855f7" },
    { label: "INFER", value: `${ms}ms`, color: "#f59e0b" },
  ];

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-around",
        padding: "10px 12px",
        background: "#111",
        borderTop: "1px solid #1a1a1a",
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "var(--pn-font-mono, monospace)",
              fontSize: 12,
              fontWeight: 500,
              color: it.color,
            }}
          >
            {it.value}
          </div>
          <div
            style={{
              fontFamily: "var(--pn-font-ui, sans-serif)",
              fontSize: 9,
              color: "#444",
              marginTop: 2,
              letterSpacing: "0.04em",
            }}
          >
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function HazardCard({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        margin: "8px 12px",
        padding: "11px 13px",
        background: "#1a1a1a",
        borderRadius: 10,
        border: "1px solid #2a2a2a",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
        <span
          style={{
            fontFamily: "var(--pn-font-ui, sans-serif)",
            fontSize: 12,
            fontWeight: 500,
            color: "#f59e0b",
          }}
        >
          Pothole ahead — 120m
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--pn-font-ui, sans-serif)",
          fontSize: 11,
          color: "#555",
          paddingLeft: 16,
        }}
      >
        Reported 3x in last 7 days · Severity: High
      </div>
    </div>
  );
}

function BottomNav() {
  const [toast, setToast] = useState("");

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1500);
  };

  const btnBase: React.CSSProperties = {
    background: "none",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "8px 12px",
    color: "#999",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "border-color 0.2s, color 0.2s",
    fontSize: 14,
  };

  return (
    <div style={{ position: "relative" }}>
      {toast && (
        <div
          style={{
            position: "absolute",
            top: -32,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#22c55e22",
            color: "#22c55e",
            fontSize: 11,
            padding: "4px 12px",
            borderRadius: 6,
            fontFamily: "var(--pn-font-ui, sans-serif)",
            whiteSpace: "nowrap",
            zIndex: 30,
          }}
        >
          {toast}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          padding: "12px 14px 24px",
          background: "#111",
        }}
      >
        <button
          style={{
            ...btnBase,
            border: "2px solid #ef4444",
            borderRadius: "50%",
            width: 48,
            height: 48,
            color: "#ef4444",
            padding: 0,
            fontSize: 18,
          }}
          onClick={() => flash("Report submitted")}
          title="Report hazard"
        >
          ⚠
        </button>
        <button style={btnBase} onClick={() => flash("Map view")} title="Map">
          ☰
        </button>
      </div>
    </div>
  );
}

// ============================================
// MAIN APP
// ============================================
const SCENE_KEYS: AppScene[] = [
  "REVERSE_CLEAR",
  "REVERSE_APPROACHING",
  "REVERSE_DANGER",
  "REVERSE_PERSON",
  "REVERSE_POTHOLE",
  "DRIVING",
  "DISCONNECTED",
];

const SCENE_LABELS: Record<AppScene, string> = {
  REVERSE_CLEAR: "Safe",
  REVERSE_APPROACHING: "Approaching",
  REVERSE_DANGER: "Danger",
  REVERSE_PERSON: "Person",
  REVERSE_POTHOLE: "Pothole",
  DRIVING: "Driving",
  DISCONNECTED: "Disconnected",
};

export default function PotholeNetApp() {
  const [scene, setScene] = useState<AppScene>("REVERSE_CLEAR");
  const [autoPlaying, setAutoPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoRef = useRef<number | null>(null);

  const config = SCENES[scene];

  useEffect(() => {
    if (canvasRef.current) {
      drawScene(canvasRef.current, scene);
    }
  }, [scene]);

  const startAutoDemo = useCallback(() => {
    if (autoPlaying) {
      if (autoRef.current) clearTimeout(autoRef.current);
      setAutoPlaying(false);
      return;
    }
    setAutoPlaying(true);
    let idx = 0;
    const step = () => {
      if (idx >= DEMO_SEQUENCE.length) {
        setScene("REVERSE_CLEAR");
        setAutoPlaying(false);
        return;
      }
      setScene(DEMO_SEQUENCE[idx].scene);
      autoRef.current = window.setTimeout(() => {
        idx++;
        step();
      }, DEMO_SEQUENCE[idx].duration);
    };
    step();
  }, [autoPlaying]);

  useEffect(() => {
    return () => {
      if (autoRef.current) clearTimeout(autoRef.current);
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d0d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
        fontFamily: "var(--pn-font-ui, -apple-system, sans-serif)",
      }}
    >
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes pulse-fast {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.15; }
        }
        .pulse-slow { animation: pulse-slow 1.2s ease-in-out infinite; }
        .pulse-fast { animation: pulse-fast 0.5s ease-in-out infinite; }
        * { box-sizing: border-box; margin: 0; }
        button:hover { opacity: 0.85; }
        button:active { transform: scale(0.96); }
      `}</style>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: "#fff", letterSpacing: "-0.02em" }}>
          PotholeNet
        </div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 4, letterSpacing: "0.04em" }}>
          Crowdsourced Road Hazard Intelligence
        </div>
      </div>

      {/* Phone frame */}
      <div
        style={{
          background: "#0a0a0a",
          borderRadius: 40,
          overflow: "hidden",
          width: "100%",
          maxWidth: 390,
          border: "2px solid #222",
          position: "relative",
        }}
      >
        <StatusBar />

        {/* Camera area */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "4/3", background: "#0a0a0a", overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
          <AlertBorder config={config} />
          <AlertLabel text={config.alertLabel} color={config.alertLevel} />
          <ModeBadge mode={config.mode} color={config.modeColor} />
          <DetectionStack config={config} />
          <BoundingBoxOverlay bboxes={config.bboxes} />
          <SpeedBadge speed={config.speed} />
          <ConfidenceBadge value={config.confidence} color={config.confColor} />
          <DisconnectOverlay visible={config.showDisconnect} />
        </div>

        <InfoStrip streamLost={config.streamLost} />
        <HazardCard visible={config.showHazardCard} />
        <BottomNav />
      </div>

      {/* State description */}
      <div
        style={{
          marginTop: 16,
          fontSize: 12,
          color: "#888",
          textAlign: "center",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        {config.description}
      </div>

      {/* IP callout */}
      {config.ipCallout && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "#22d3ee",
            textAlign: "center",
            maxWidth: 360,
            padding: "6px 12px",
            background: "rgba(34,211,238,0.08)",
            borderRadius: 6,
            border: "1px solid rgba(34,211,238,0.15)",
          }}
        >
          ⚡ {config.ipCallout}
        </div>
      )}

      {/* Demo controls */}
      <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 400 }}>
        {SCENE_KEYS.map((s) => (
          <button
            key={s}
            onClick={() => {
              if (autoPlaying) {
                if (autoRef.current) clearTimeout(autoRef.current);
                setAutoPlaying(false);
              }
              setScene(s);
            }}
            style={{
              fontSize: 11,
              padding: "6px 12px",
              background: scene === s ? "#222" : "transparent",
              color: scene === s ? "#fff" : "#666",
              border: `1px solid ${scene === s ? "#444" : "#2a2a2a"}`,
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "var(--pn-font-ui, sans-serif)",
              transition: "all 0.2s",
            }}
          >
            {SCENE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Auto demo button */}
      <button
        onClick={startAutoDemo}
        style={{
          marginTop: 12,
          fontSize: 12,
          padding: "8px 20px",
          background: autoPlaying ? "#ef4444" : "#22c55e",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: 500,
          fontFamily: "var(--pn-font-ui, sans-serif)",
          letterSpacing: "0.03em",
        }}
      >
        {autoPlaying ? "⏹ Stop Demo" : "▶ Play Auto Demo"}
      </button>
    </div>
  );
}
