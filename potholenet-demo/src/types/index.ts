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
}

export const DEFAULT_SETTINGS: AppSettings = {
  cameraSource: "phone",
  esp32Url: "http://172.20.10.3",
  backendUrl: "http://localhost:8000",
  soundsEnabled: true,
  voiceCuesEnabled: true,
  hapticsEnabled: true,
  wakeLockEnabled: true,
  detectionThreshold: 0.5,
  useBackendDetection: true,
};
