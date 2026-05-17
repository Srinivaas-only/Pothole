import logging
import os
import tempfile
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)

# YOLOv8 target classes and their categories
TARGET_CLASSES: Dict[int, str] = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    15: "cat",
    16: "dog",
    17: "horse",
    18: "sheep",
    19: "cow",
    20: "elephant",
    21: "bear",
}

# Classification categories
HUMAN_CLASSES = {0}
VEHICLE_CLASSES = {1, 2, 3, 5, 7}
ANIMAL_CLASSES = {15, 16, 17, 18, 19, 20, 21}


class Detector:
    """Manages loading and running ML models for pothole and object detection."""

    def __init__(self):
        self.roboflow_model = None
        self.yolo_model = None
        self.models_loaded = {"pothole": False, "yolov8": False}

    def load_models(self) -> None:
        """Load both ML models. Called once at server startup."""
        settings = get_settings()

        # Load Roboflow pothole model
        try:
            from roboflow import Roboflow

            rf = Roboflow(api_key=settings.ROBOFLOW_API_KEY)
            project = rf.workspace(settings.ROBOFLOW_WORKSPACE).project(
                settings.ROBOFLOW_PROJECT
            )
            self.roboflow_model = project.version(
                settings.ROBOFLOW_VERSION
            ).model
            self.models_loaded["pothole"] = True
            logger.info("Roboflow pothole model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load Roboflow model: {e}")
            self.models_loaded["pothole"] = False

        # Load YOLOv8n model
        try:
            from ultralytics import YOLO

            self.yolo_model = YOLO("yolov8n.pt")
            self.models_loaded["yolov8"] = True
            logger.info("YOLOv8n model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load YOLOv8n model: {e}")
            self.models_loaded["yolov8"] = False

    def decode_image(self, image_bytes: bytes) -> Optional[np.ndarray]:
        """Decode raw image bytes into an OpenCV numpy array."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img

    def run_detection(self, image_bytes: bytes) -> dict:
        """
        Run both ML models on the given image bytes.

        Returns a structured detection result dict matching DetectionResponse schema.
        """
        settings = get_settings()

        # Decode image
        img = self.decode_image(image_bytes)
        if img is None:
            raise ValueError("Could not decode image. Ensure it is a valid JPEG/PNG.")

        # Save to temp file for model inference
        temp_fd, temp_path = tempfile.mkstemp(suffix=".jpg")
        try:
            cv2.imwrite(temp_path, img)

            # Run Roboflow pothole detection
            pothole_results = self._run_pothole_detection(
                temp_path, settings.POTHOLE_CONFIDENCE_THRESHOLD
            )

            # Run YOLOv8 object detection
            yolo_results = self._run_yolo_detection(temp_path)

        finally:
            # Clean up temp file
            os.close(temp_fd)
            if os.path.exists(temp_path):
                os.unlink(temp_path)

        # Build alert string
        alerts = []
        if pothole_results["detected"]:
            alerts.append("⚠️ POTHOLE DETECTED")
        if yolo_results["humans"]["detected"]:
            alerts.append("🧍 HUMAN ON ROAD")
        if yolo_results["vehicles"]["detected"]:
            alerts.append("🚗 VEHICLE NEARBY")
        if yolo_results["animals"]["detected"]:
            alerts.append("🐄 ANIMAL ON ROAD")

        alert_str = " | ".join(alerts) if alerts else "✅ ALL CLEAR"

        return {
            "pothole": pothole_results,
            "humans": yolo_results["humans"],
            "vehicles": yolo_results["vehicles"],
            "animals": yolo_results["animals"],
            "alert": alert_str,
        }

    def _run_pothole_detection(self, image_path: str, confidence: int) -> dict:
        """Run Roboflow pothole model on an image file."""
        if not self.models_loaded["pothole"] or self.roboflow_model is None:
            logger.warning("Pothole model not loaded, skipping detection")
            return {"detected": False, "count": 0, "details": []}

        try:
            result_json = self.roboflow_model.predict(image_path, confidence=confidence).json()
            predictions = result_json.get("predictions", [])

            details = []
            for pred in predictions:
                details.append(
                    {
                        "confidence": pred.get("confidence", 0),
                        "x": pred.get("x", 0),
                        "y": pred.get("y", 0),
                        "width": pred.get("width", 0),
                        "height": pred.get("height", 0),
                    }
                )

            return {
                "detected": len(details) > 0,
                "count": len(details),
                "details": details,
            }
        except Exception as e:
            logger.error(f"Pothole detection failed: {e}")
            return {"detected": False, "count": 0, "details": []}

    def _run_yolo_detection(self, image_path: str) -> dict:
        """Run YOLOv8n on an image file and categorize detections."""
        humans = {"detected": False, "count": 0, "details": []}
        vehicles = {"detected": False, "count": 0, "details": []}
        animals = {"detected": False, "count": 0, "details": []}

        if not self.models_loaded["yolov8"] or self.yolo_model is None:
            logger.warning("YOLOv8 model not loaded, skipping detection")
            return {"humans": humans, "vehicles": vehicles, "animals": animals}

        try:
            results = self.yolo_model(image_path, verbose=False)

            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    confidence = float(box.conf[0])

                    if class_id not in TARGET_CLASSES:
                        continue

                    label = TARGET_CLASSES[class_id]
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                    detail = {
                        "label": label,
                        "confidence": round(confidence, 4),
                        "box": [x1, y1, x2, y2],
                    }

                    if class_id in HUMAN_CLASSES:
                        humans["details"].append(detail)
                        humans["count"] += 1
                    elif class_id in VEHICLE_CLASSES:
                        vehicles["details"].append(detail)
                        vehicles["count"] += 1
                    elif class_id in ANIMAL_CLASSES:
                        animals["details"].append(detail)
                        animals["count"] += 1

            humans["detected"] = humans["count"] > 0
            vehicles["detected"] = vehicles["count"] > 0
            animals["detected"] = animals["count"] > 0

        except Exception as e:
            logger.error(f"YOLOv8 detection failed: {e}")

        return {"humans": humans, "vehicles": vehicles, "animals": animals}

    def run_detection_dual_mode(
        self, image_bytes: bytes, mode: str = "driving", velocity_kmh: Optional[float] = None
    ) -> dict:
        """
        Run detection in dual-mode.

        Both REVERSE and DRIVING modes run YOLO (humans/vehicles/animals) AND
        Roboflow pothole detection — pothole inference is no longer gated by mode.
        The `mode` field is still returned so the frontend alert state machine
        can shape the UI (reverse cues vs. predictive driving cues).
        """
        logger.info(f"Running {mode.upper()} detection")

        img = self.decode_image(image_bytes)
        if img is None:
            raise ValueError("Could not decode image. Ensure it is a valid JPEG/PNG.")

        temp_fd, temp_path = tempfile.mkstemp(suffix=".jpg")
        try:
            cv2.imwrite(temp_path, img)
            yolo_results = self._run_yolo_detection(temp_path)
            settings = get_settings()
            pothole_results = self._run_pothole_detection(
                temp_path, settings.POTHOLE_CONFIDENCE_THRESHOLD
            )
        finally:
            # Clean up temp file
            os.close(temp_fd)
            if os.path.exists(temp_path):
                os.unlink(temp_path)

        # Build alert string
        alerts = []
        if pothole_results["detected"]:
            alerts.append("⚠️ POTHOLE DETECTED")
        if yolo_results["humans"]["detected"]:
            alerts.append("🧍 HUMAN ON ROAD")
        if yolo_results["vehicles"]["detected"]:
            alerts.append("🚗 VEHICLE NEARBY")
        if yolo_results["animals"]["detected"]:
            alerts.append("🐄 ANIMAL ON ROAD")

        alert_str = " | ".join(alerts) if alerts else "✅ ALL CLEAR"

        return {
            "mode": mode.upper(),
            "pothole": pothole_results,
            "humans": yolo_results["humans"],
            "vehicles": yolo_results["vehicles"],
            "animals": yolo_results["animals"],
            "alert": alert_str,
            "velocity_kmh": velocity_kmh,
        }


# Colors for annotation overlay (BGR for OpenCV).
_OVERLAY_COLORS = {
    "pothole":  (0, 0, 255),     # red
    "humans":   (0, 255, 0),     # green
    "vehicles": (255, 200, 0),   # cyan-ish
    "animals":  (255, 0, 255),   # magenta
}


def _draw_box(img, x1, y1, x2, y2, label, color):
    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    cv2.rectangle(img, (x1, max(0, y1 - th - 6)), (x1 + tw + 4, y1), color, -1)
    cv2.putText(img, label, (x1 + 2, max(th, y1) - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)


def annotate_detections(image_bytes: bytes, result: dict) -> bytes:
    """Draw bounding boxes from a detection result onto the image, return JPEG bytes.

    Falls back to the original bytes if decode/encode fails.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes

    for p in result.get("pothole", {}).get("details", []):
        cx, cy = p.get("x", 0), p.get("y", 0)
        w, h = p.get("width", 0), p.get("height", 0)
        x1, y1 = int(cx - w / 2), int(cy - h / 2)
        x2, y2 = int(cx + w / 2), int(cy + h / 2)
        _draw_box(img, x1, y1, x2, y2,
                  f"pothole {p.get('confidence', 0):.2f}",
                  _OVERLAY_COLORS["pothole"])

    for cat in ("humans", "vehicles", "animals"):
        color = _OVERLAY_COLORS[cat]
        for d in result.get(cat, {}).get("details", []):
            box = d.get("box")
            if not box:
                continue
            x1, y1, x2, y2 = box
            _draw_box(img, x1, y1, x2, y2,
                      f"{d.get('label', cat)} {d.get('confidence', 0):.2f}",
                      color)

    mode = result.get("mode")
    if mode:
        cv2.putText(img, mode, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9,
                    (255, 255, 255), 2, cv2.LINE_AA)

    ok, buf = cv2.imencode(".jpg", img)
    return buf.tobytes() if ok else image_bytes


# Module-level singleton
_detector: Optional[Detector] = None


def get_detector() -> Detector:
    """Get or create the global Detector singleton."""
    global _detector
    if _detector is None:
        _detector = Detector()
    return _detector