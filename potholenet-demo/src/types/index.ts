export type AppScene =
  | "CLEAR"
  | "APPROACHING"
  | "DANGER"
  | "PERSON"
  | "POTHOLE"
  | "DRIVING"
  | "DISCONNECTED";

export type TabView = "camera" | "map" | "settings";

export type CameraSource = "phone" | "esp32";

export interface Detection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  isHuman: boolean;
  isVehicle: boolean;
  // True if this vehicle's bbox center shifted significantly vs the previous frame.
  // Computed in useDetection by matching nearest previous detection. Only meaningful
  // for vehicles; humans/potholes leave it undefined.
  isMoving?: boolean;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  conf: number;
  color: string;
}

export type AlertLevel = "green" | "orange" | "red" | "cyan" | "gray";
export type PulseSpeed = "none" | "slow" | "fast";

export interface SceneConfig {
  alertLevel: AlertLevel;
  alertLabel: string;
  borderColor: string;
  glowColor: string;
  glowSpread: number;
  pulse: PulseSpeed;
  confColor: string;
  detections: { pot: boolean; hum: boolean; veh: boolean };
  bboxes: BBox[];
  showDisconnect: boolean;
}

export type StreamRotation = 0 | 90 | "auto";

export interface AppSettings {
  cameraSource: CameraSource;
  esp32Url: string;
  backendUrl: string;
  soundsEnabled: boolean;
  voiceCuesEnabled: boolean;
  hapticsEnabled: boolean;
  wakeLockEnabled: boolean;
  detectionThreshold: number;
  useBackendDetection: boolean;
  // 0 = native, 90 = clockwise 90°, "auto" = follow phone orientation
  // (portrait → rotate 90°, landscape → native)
  streamRotation: StreamRotation;
}

export const DEFAULT_SETTINGS: AppSettings = {
  cameraSource: "esp32",
  esp32Url: "http://172.20.10.3",
  // Empty = use same-origin via Vite proxy (avoids mixed-content blocks on HTTPS).
  backendUrl: "",
  soundsEnabled: true,
  voiceCuesEnabled: true,
  hapticsEnabled: true,
  wakeLockEnabled: true,
  detectionThreshold: 0.5,
  useBackendDetection: true,
  streamRotation: "auto",
};
