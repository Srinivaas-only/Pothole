import type { AppScene, SceneConfig } from "../types";

export const SCENES: Record<AppScene, SceneConfig> = {
  CLEAR: {
    alertLevel: "green", alertLabel: "✓ CLEAR",
    borderColor: "#22c55e", glowColor: "rgba(34,197,94,0.15)", glowSpread: 20, pulse: "none",
    confColor: "#22c55e", detections: { pot: false, hum: false, veh: false }, bboxes: [],
    showDisconnect: false,
  },
  APPROACHING: {
    alertLevel: "orange", alertLabel: "⚠ SLOW DOWN",
    borderColor: "#f59e0b", glowColor: "rgba(245,158,11,0.2)", glowSpread: 30, pulse: "slow",
    confColor: "#f59e0b", detections: { pot: false, hum: false, veh: true },
    bboxes: [{ x: 130, y: 80, w: 50, h: 80, label: "car", conf: 87, color: "#f59e0b" }],
    showDisconnect: false,
  },
  DANGER: {
    alertLevel: "red", alertLabel: "🛑 STOP",
    borderColor: "#ef4444", glowColor: "rgba(239,68,68,0.25)", glowSpread: 40, pulse: "fast",
    confColor: "#ef4444", detections: { pot: false, hum: false, veh: true },
    bboxes: [{ x: 120, y: 140, w: 60, h: 90, label: "car", conf: 94, color: "#ef4444" }],
    showDisconnect: false,
  },
  PERSON: {
    alertLevel: "red", alertLabel: "🚶 PERSON — STOP",
    borderColor: "#ef4444", glowColor: "rgba(239,68,68,0.3)", glowSpread: 40, pulse: "fast",
    confColor: "#ef4444", detections: { pot: false, hum: true, veh: false },
    bboxes: [{ x: 150, y: 130, w: 40, h: 55, label: "person", conf: 91, color: "#ef4444" }],
    showDisconnect: false,
  },
  POTHOLE: {
    alertLevel: "red", alertLabel: "🕳️ POTHOLE",
    borderColor: "#ef4444", glowColor: "rgba(239,68,68,0.15)", glowSpread: 15, pulse: "none",
    confColor: "#ef4444", detections: { pot: true, hum: false, veh: false },
    bboxes: [{ x: 135, y: 165, w: 50, h: 30, label: "pothole", conf: 82, color: "#ef4444" }],
    showDisconnect: false,
  },
  DRIVING: {
    alertLevel: "cyan", alertLabel: "📡 MONITORING",
    borderColor: "#22d3ee", glowColor: "rgba(34,211,238,0.1)", glowSpread: 15, pulse: "none",
    confColor: "#22d3ee", detections: { pot: true, hum: false, veh: true },
    bboxes: [
      { x: 80, y: 175, w: 40, h: 25, label: "pothole", conf: 76, color: "#ef4444" },
      { x: 190, y: 55, w: 50, h: 65, label: "car", conf: 89, color: "#a855f7" },
    ],
    showDisconnect: false,
  },
  DISCONNECTED: {
    alertLevel: "gray", alertLabel: "",
    borderColor: "#666666", glowColor: "transparent", glowSpread: 0, pulse: "none",
    confColor: "#666666", detections: { pot: false, hum: false, veh: false }, bboxes: [],
    showDisconnect: true,
  },
};