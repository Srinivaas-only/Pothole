import type { AppScene, Detection } from "../types";

export type EdgeAlertColor = "red" | "orange" | "green";

export interface EdgeAlertState {
  color: EdgeAlertColor;
  pulse: boolean;
}

/**
 * Whole-screen edge alert state. Potholes are ignored (they still detect and
 * draw boxes elsewhere). Pulse signals urgency on top of color:
 *   - Red + pulse  → human or animal (always urgent)
 *   - Orange + pulse → vehicle that's MOVING (per useDetection's tag)
 *   - Orange solid → vehicle is stationary
 *   - Green       → nothing of concern in frame
 */
export function deriveEdgeColor(detections: Detection[]): EdgeAlertState {
  const nonPotholes = detections.filter((d) => d.label !== "pothole");
  if (nonPotholes.some((d) => !d.isVehicle)) return { color: "red", pulse: true };
  const vehicles = nonPotholes.filter((d) => d.isVehicle);
  if (vehicles.length > 0) {
    const anyMoving = vehicles.some((d) => d.isMoving);
    return { color: "orange", pulse: anyMoving };
  }
  return { color: "green", pulse: false };
}

const HUMAN_CLASSES = ["person", "dog", "cat"];
const VEHICLE_CLASSES = ["car", "truck", "motorcycle", "bicycle", "bus"];

export function isHumanDetection(label: string): boolean {
  return HUMAN_CLASSES.includes(label);
}

export function isVehicleDetection(label: string): boolean {
  return VEHICLE_CLASSES.includes(label);
}

export function deriveAlertState(
  detections: Detection[],
  gpsSpeedKmh: number,
  cameraConnected: boolean
): AppScene {
  if (!cameraConnected) return "DISCONNECTED";
  if (gpsSpeedKmh > 5) return "DRIVING";
  if (detections.some((d) => d.isHuman)) return "PERSON";
  if (detections.some((d) => d.label === "pothole")) return "POTHOLE";
  const vehicles = detections.filter((d) => d.isVehicle);
  if (vehicles.length > 0) {
    const largestArea = Math.max(...vehicles.map((d) => (d.bbox[2] - d.bbox[0]) * (d.bbox[3] - d.bbox[1])));
    if (largestArea > 25000) return "DANGER";
    if (largestArea > 8000) return "APPROACHING";
  }
  return "CLEAR";
}