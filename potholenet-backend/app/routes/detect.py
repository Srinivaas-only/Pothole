import logging
from typing import Optional
import time

from fastapi import APIRouter, File, UploadFile, HTTPException, Depends, Query
from sqlalchemy.orm import Session

from app.models.schemas import DetectionResponse, DetectionCategory, ErrorResponse, DualModeDetectionResponse
from app.services.detector import annotate_detections, get_detector
from app.services.hazard_store import create_or_update_report
from app import main as app_main
from app.database import get_db
from app.models.db_models import PotholeDetection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["detection"])

# Dual-mode thresholds
GPS_STALE_SECONDS = 60        # GPS data older than this → stale, ignored
REVERSE_SPEED_THRESHOLD = 10  # km/h — at or below this speed = REVERSE mode


@router.post(
    "/detect",
    response_model=DetectionResponse,
    summary="Run pothole and object detection on an uploaded image",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid image"},
        500: {"model": ErrorResponse, "description": "Model inference error"},
    },
)
async def detect_objects(image: UploadFile = File(...)):
    """
    Accept a JPEG/PNG image via multipart form upload and run:
    1. Roboflow pothole detection model
    2. YOLOv8n COCO object detection

    Returns structured detection results with pothole, human, vehicle, and animal
    categories, plus an alert string.
    """
    # Validate file type
    if image.content_type and image.content_type not in (
        "image/jpeg",
        "image/png",
        "image/jpg",
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image format: {image.content_type}. Accepted: JPEG, PNG.",
        )

    detector = get_detector()

    try:
        image_bytes = await image.read()

        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty image file received.")

        result = detector.run_detection(image_bytes)
        return DetectionResponse(**result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Detection endpoint error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Model inference failed: {str(e)}"
        )


@router.post(
    "/detect/dual-mode",
    response_model=DualModeDetectionResponse,
    summary="Dual-mode detection: REVERSE (YOLO only) vs DRIVING (Pothole + YOLO)",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid image or parameters"},
        500: {"model": ErrorResponse, "description": "Model inference error"},
    },
)
async def detect_dual_mode(
    image: UploadFile = File(...),
    velocity_kmh: Optional[float] = Query(
        None,
        ge=0,
        description="Vehicle speed in km/h. <=10 = REVERSE, >10 = DRIVING. Overrides GPS state.",
    ),
    db: Session = Depends(get_db),
):
    """
    Dual-mode detection endpoint. Mode is determined by speed with a priority chain:

    **Priority 1 — Explicit query param** `?velocity_kmh=X`
    **Priority 2 — GPS state** from `POST /location/update` (if fresh < 60s)
    **Priority 3 — Default** to REVERSE (safer: assumes stationary)

    **REVERSE Mode** (speed ≤ 10 km/h):
    - YOLOv8 runs to detect humans / vehicles / animals behind the car
    - Pothole detection SKIPPED (irrelevant at parking speed)

    **DRIVING Mode** (speed > 10 km/h):
    - Roboflow pothole detection + YOLOv8 object detection
    - Full hazard detection at road speeds
    """
    # Validate file type
    if image.content_type and image.content_type not in (
        "image/jpeg",
        "image/png",
        "image/jpg",
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image format: {image.content_type}. Accepted: JPEG, PNG.",
        )

    detector = get_detector()

    try:
        image_bytes = await image.read()

        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty image file received.")

        # Push the raw frame to the stream cache
        app_main.frame_state["jpeg"] = image_bytes
        app_main.frame_state["timestamp"] = time.time()

        # ---- MODE SELECTION (priority chain) ----
        resolved_velocity = None
        speed_source = "none"

        # Priority 1: Explicit query parameter
        if velocity_kmh is not None:
            resolved_velocity = velocity_kmh
            speed_source = "query_param"
        else:
            # Priority 2: GPS state (if fresh)
            gps = app_main.gps_state
            gps_velocity = gps.get("velocity_kmh")
            gps_age = None
            if gps.get("last_update") is not None:
                gps_age = time.time() - gps["last_update"]

            if gps_velocity is not None and gps_age is not None and gps_age <= GPS_STALE_SECONDS:
                resolved_velocity = gps_velocity
                speed_source = f"gps_state (age={gps_age:.1f}s)"
            else:
                # Priority 3: Default to REVERSE (safer)
                resolved_velocity = 0.0
                speed_source = "default"

        # Determine mode based on resolved speed
        if resolved_velocity <= REVERSE_SPEED_THRESHOLD:
            mode = "reverse"
        else:
            mode = "driving"

        logger.info(
            f"Mode={mode.upper()} | velocity={resolved_velocity} km/h | source={speed_source}"
        )

        result = detector.run_detection_dual_mode(
            image_bytes, mode=mode, velocity_kmh=resolved_velocity
        )

        # Keep raw frame in "jpeg" (served by /stream) for low-latency live view.
        # Store annotated copy separately for /stream-annotated.
        app_main.frame_state["annotated"] = annotate_detections(image_bytes, result)
        app_main.frame_state["timestamp"] = time.time()

        # Save pothole detection to database if potholes detected
        if result.get("pothole", {}).get("detected"):
            save_pothole_detection(db, result, resolved_velocity)

        return DualModeDetectionResponse(**result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Dual-mode detection endpoint error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Model inference failed: {str(e)}"
        )




def save_pothole_detection(db: Session, detection_result: dict, velocity_kmh: Optional[float]):
    """
    Save pothole detection to database with location and time.
    
    Args:
        db: Database session
        detection_result: Detection result from run_detection_dual_mode()
        velocity_kmh: Current vehicle velocity
    """
    try:
        # Get phone GPS location
        latitude = app_main.gps_state.get("latitude")
        longitude = app_main.gps_state.get("longitude")
        mode = detection_result.get("mode", "DRIVING")
        
        # Get pothole confidence (average of all detected potholes)
        pothole_details = detection_result.get("pothole", {}).get("details", [])
        confidence = 0.0
        if pothole_details:
            confidence = sum([p.get("confidence", 0) for p in pothole_details]) / len(pothole_details)
        
        # Create database record
        pothole_record = PotholeDetection(
            latitude=latitude,
            longitude=longitude,
            confidence=confidence,
            velocity_kmh=velocity_kmh,
            mode=mode,
            pothole_count=detection_result.get("pothole", {}).get("count", 0)
        )
        
        db.add(pothole_record)
        db.commit()

        logger.info(
            f"Pothole detection saved: "
            f"id={pothole_record.id}, "
            f"location=({latitude}, {longitude}), "
            f"confidence={confidence:.2f}, "
            f"velocity={velocity_kmh} km/h"
        )

        # Auto-publish to the deduped HazardReport table so it appears on the
        # in-app map. create_or_update_report bumps severity for any existing
        # report within DEDUP_RADIUS_M (5m) and DEDUP_WINDOW_DAYS (30d) instead
        # of inserting a duplicate row. Skip if we don't have GPS coords.
        if latitude is not None and longitude is not None:
            try:
                hazard = create_or_update_report(
                    db=db,
                    latitude=latitude,
                    longitude=longitude,
                    confidence=float(confidence),
                    vehicle_type="car",
                )
                logger.info(
                    f"Hazard map updated: id={hazard['report_id']}, "
                    f"severity={hazard['severity_score']}, "
                    f"is_new={hazard['is_new']}"
                )
            except Exception as e:
                logger.warning(f"Hazard auto-publish failed (non-fatal): {e}")
        else:
            logger.info("Skipping hazard auto-publish — no GPS coords available")

    except Exception as e:
        logger.error(f"Failed to save pothole detection: {e}", exc_info=True)
        db.rollback()