import cv2
import numpy as np
import os
import joblib
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Optional, List
import tempfile
import logging

from backend.ml.face_utils import shared_face_analyzer, get_capture_guidance_message
from backend.ml.face_shape_classifier import face_shape_classifier, AnthropometricFaceShapeScorer

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/analyze/phase1")
@router.post("/api/predict")
@router.post("/predict")
async def analyze_phase1(
    image: Optional[UploadFile] = File(None),
    images: Optional[List[UploadFile]] = File(None)
):
    """
    Phase 1 Face Shape Classification API.
    Supports either:
    - Single image upload (backward compatibility)
    - Multi-frame image upload (for video stream / burst capture stabilization)
    
    Applies:
    1. Pre-prediction quality & pose validation on all frames
    2. Landmark extraction and temporal Median Absolute Deviation (MAD) feature stabilization
    3. Multi-frame soft-probability voting and outlier pruning
    4. Hybrid fusion with Farkas anthropometric craniofacial priors
    5. Boundary condition disambiguation and transparent confidence reporting
    """
    upload_list: List[UploadFile] = []
    if images:
        upload_list.extend(images)
    if image and (not images or image.filename not in [img.filename for img in images]):
        upload_list.insert(0, image)

    if not upload_list:
        raise HTTPException(status_code=400, detail="No image file provided.")

    decoded_frames = []
    for upload in upload_list:
        try:
            contents = await upload.read()
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                decoded_frames.append(img)
        except Exception as e:
            logger.warning(f"Failed to decode upload frame: {e}")
            continue

    if not decoded_frames:
        raise HTTPException(status_code=400, detail="Failed to decode any provided image.")

    # 1. Evaluate image quality and pose validity for all frames
    valid_frames = []
    first_invalid_quality = None

    for img in decoded_frames:
        face_data = shared_face_analyzer.process_image(img)
        if face_data["quality"]["status"] == "valid":
            pose_weight = face_shape_classifier.calculate_pose_weight(face_data)
            valid_frames.append({
                "img": img,
                "face_data": face_data,
                "pose_weight": pose_weight
            })
        elif first_invalid_quality is None:
            first_invalid_quality = face_data["quality"]

    # If NO frames passed quality validation, return guidance from primary invalid frame
    if not valid_frames:
        guidance_msg = get_capture_guidance_message(first_invalid_quality)
        return {
            "face_shape": "Unknown",
            "confidence": 0.0,
            "top_predictions": [],
            "features": None,
            "measurements": None,
            "error": guidance_msg,
            "guidance_message": guidance_msg,
            "quality": first_invalid_quality,
            "frames_evaluated": 0,
            "stability": "none"
        }

    # 2. Extract features and compute frame-level predictions
    features_list = []
    pose_weights_list = []
    frame_probs_list = []

    mod = face_shape_classifier.model_artifact
    pipeline = mod["pipeline"]
    feature_cols = mod["feature_cols"]

    for frame_entry in valid_frames:
        feat = face_shape_classifier.extract_features_from_image(frame_entry["img"])
        if feat is not None:
            features_list.append(feat)
            pose_weights_list.append(frame_entry["pose_weight"])
            
            # Predict single frame probabilities
            df_single = pd.DataFrame([feat])[feature_cols]
            p_single = pipeline.predict_proba(df_single.values)[0]
            frame_probs_list.append(p_single)

    if not features_list:
        return {
            "face_shape": "Unknown",
            "confidence": 0.0,
            "top_predictions": [],
            "features": None,
            "measurements": None,
            "error": "Face not detected. Please position your face in the frame.",
            "guidance_message": "Face not detected. Please position your face in the frame.",
            "quality": {"status": "invalid", "reasons": ["no_face"]},
            "frames_evaluated": 0,
            "stability": "none"
        }

    # 3. Temporal MAD Stabilization across frames
    stable_features = face_shape_classifier.stabilize_features_mad(features_list, pose_weights_list)

    # 4. Hybrid Prediction (ML Soft-Voting + Anthropometric Geometric Priors)
    result = face_shape_classifier.predict_hybrid(
        features=stable_features,
        frame_ml_probs_list=frame_probs_list,
        frames_evaluated=len(features_list)
    )

    # 5. Extract normalized and pixel measurements from the best-aligned valid frame
    best_frame = max(valid_frames, key=lambda f: f["pose_weight"])
    landmarks = best_frame["face_data"].get("landmarks")
    
    lw = stable_features.get("face_length_to_cheekbone_width", 1.20)
    jw = stable_features.get("jaw_width_to_cheekbone_width", 0.94)
    fw = stable_features.get("forehead_width_to_cheekbone_width", 0.86)
    jaw_ang = stable_features.get("avg_jaw_angle", 142.0)
    chin_ang = stable_features.get("chin_angle", 88.0)
    taper = stable_features.get("cheekbone_to_jaw_taper", 0.055)

    if jaw_ang <= 139.5 and jw >= 0.94:
        jawline_desc = "Strong & Angular (Sharp Gonial Angles)"
    elif chin_ang <= 86.5 or taper >= 0.058:
        jawline_desc = "Pointed & Tapered (V-Line Chin)"
    elif jaw_ang >= 142.0 and jw <= 0.93:
        jawline_desc = "Soft & Rounded (Curved Jawline)"
    elif lw >= 1.25 and jw >= 0.91:
        jawline_desc = "Straight & Uniform (Elongated Profile)"
    else:
        jawline_desc = "Gently Tapered (Balanced Harmony)"

    measurements = {
        "face_length_to_width_ratio": round(float(lw), 2),
        "forehead_width_relative": round(float(fw), 2),
        "cheekbone_width_relative": 1.0,
        "jaw_width_relative": round(float(jw), 2),
        "jawline_description": jawline_desc,
        "avg_jaw_angle": round(float(jaw_ang), 1),
        "chin_angle": round(float(chin_ang), 1)
    }

    if landmarks is not None and len(landmarks) >= 454:
        def dist_px(p1, p2):
            return float(np.linalg.norm(landmarks[p1] - landmarks[p2]))
        measurements.update({
            "cheekbone_width_px": round(dist_px(234, 454), 1),
            "jaw_width_px": round(dist_px(132, 361), 1),
            "forehead_width_px": round(dist_px(54, 284), 1),
            "face_length_px": round(dist_px(10, 152), 1)
        })

    return {
        "face_shape": result["face_shape"],
        "confidence": result["confidence"],
        "top_predictions": result["top_predictions"],
        "features": result["features"],
        "measurements": measurements,
        "frames_evaluated": result["frames_evaluated"],
        "stability": result["stability"],
        "is_boundary_case": result["is_boundary_case"],
        "secondary_shape": result["secondary_shape"],
        "explanation": result["explanation"],
        "guidance_message": "Face detected. You can continue.",
        "quality": {"status": "valid", "reasons": []}
    }
