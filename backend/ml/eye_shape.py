"""
Eye shape and geometric analysis using MediaPipe FaceMesh landmarks.
Analyzes eye width, height, aspect ratio (EAR), canthal tilt, and symmetry.
Follows clinical and geometric guidelines:
- Avoids forcing eyes into mutually exclusive bins.
- Avoids falsely claiming 2D landmarks can reliably diagnose hooded or monolid folds.
- Returns 'Undetermined' when features are ambiguous or unreliable.
"""
from typing import Dict, List, Optional
import numpy as np

# MediaPipe canonical eye landmark indices
# Left eye in image (subject's right eye):
L_EYE_OUTER = 33
L_EYE_INNER = 133
L_EYE_TOP = 159
L_EYE_BOTTOM = 145

# Right eye in image (subject's left eye):
R_EYE_INNER = 362
R_EYE_OUTER = 263
R_EYE_TOP = 386
R_EYE_BOTTOM = 374

def analyze_eye_shape(landmarks: np.ndarray, mm_per_px: Optional[float] = None) -> Dict:
    """
    Analyzes eye shape from facial landmarks.
    landmarks: shape (N, 2) where N >= 468.
    mm_per_px: optional iris-calibrated conversion factor.
    """
    if landmarks is None or len(landmarks) < 468:
        return {
            "eye_shape": "Undetermined",
            "eye_shape_confidence": None,
            "categories": ["Undetermined"],
            "measurements": {
                "eye_width_mm": None,
                "eye_height_mm": None,
                "aspect_ratio": None,
                "canthal_tilt_deg": None,
                "symmetry_score": None
            },
            "explanation": "Insufficient or missing facial landmarks for eye analysis.",
            "classifier_type": "landmark_heuristic",
            "confidence_note": "Geometric landmark heuristic; no clinically validated ML classifier."
        }

    # Extract eye corner and lid landmarks
    p_l_outer = landmarks[L_EYE_OUTER]
    p_l_inner = landmarks[L_EYE_INNER]
    p_l_top = landmarks[L_EYE_TOP]
    p_l_bottom = landmarks[L_EYE_BOTTOM]

    p_r_inner = landmarks[R_EYE_INNER]
    p_r_outer = landmarks[R_EYE_OUTER]
    p_r_top = landmarks[R_EYE_TOP]
    p_r_bottom = landmarks[R_EYE_BOTTOM]

    # Distances in pixels
    w_l = float(np.linalg.norm(p_l_outer - p_l_inner))
    h_l = float(np.linalg.norm(p_l_top - p_l_bottom))
    ear_l = h_l / max(w_l, 1e-5)

    w_r = float(np.linalg.norm(p_r_outer - p_r_inner))
    h_r = float(np.linalg.norm(p_r_top - p_r_bottom))
    ear_r = h_r / max(w_r, 1e-5)

    # Sanity check: plausible eye dimensions
    if w_l < 5.0 or w_r < 5.0 or h_l < 1.0 or h_r < 1.0:
        return {
            "eye_shape": "Undetermined",
            "eye_shape_confidence": None,
            "categories": ["Undetermined"],
            "measurements": {
                "eye_width_mm": None,
                "eye_height_mm": None,
                "aspect_ratio": None,
                "canthal_tilt_deg": None,
                "symmetry_score": None
            },
            "explanation": "Detected eye dimensions are too small or unreliably detected.",
            "classifier_type": "landmark_heuristic",
            "confidence_note": "Geometric landmark heuristic; no clinically validated ML classifier."
        }

    avg_w_px = (w_l + w_r) / 2.0
    avg_h_px = (h_l + h_r) / 2.0
    avg_ear = (ear_l + ear_r) / 2.0

    # Calculate head roll angle to normalize canthal tilt
    dx_eyes = p_r_inner[0] - p_l_inner[0]
    dy_eyes = p_r_inner[1] - p_l_inner[1]
    head_roll_rad = np.arctan2(dy_eyes, dx_eyes)

    # Canthal tilt calculation:
    # Outer corner elevation relative to inner corner (positive = higher/upturned)
    # Note: image Y axis points downwards
    h_diff_l = p_l_inner[1] - p_l_outer[1]
    tilt_l_rad = np.arctan2(h_diff_l, max(abs(p_l_outer[0] - p_l_inner[0]), 1e-5)) - head_roll_rad
    tilt_l_deg = float(np.degrees(tilt_l_rad))

    h_diff_r = p_r_inner[1] - p_r_outer[1]
    tilt_r_rad = np.arctan2(h_diff_r, max(abs(p_r_outer[0] - p_r_inner[0]), 1e-5)) + head_roll_rad
    tilt_r_deg = float(np.degrees(tilt_r_rad))

    avg_canthal_tilt_deg = float(np.mean([tilt_l_deg, tilt_r_deg]))

    # Eye symmetry calculation
    width_sym = min(w_l, w_r) / max(w_l, w_r, 1e-5)
    height_sym = min(h_l, h_r) / max(h_l, h_r, 1e-5)
    ear_sym = min(ear_l, ear_r) / max(ear_l, ear_r, 1e-5)
    symmetry_score = round(float(np.mean([width_sym, height_sym, ear_sym]) * 100), 1)

    # Real-world measurements in mm (if calibrated scale available)
    eye_width_mm = round(avg_w_px * mm_per_px, 1) if mm_per_px else None
    eye_height_mm = round(avg_h_px * mm_per_px, 1) if mm_per_px else None

    # Categorization based on anatomical metrics
    categories: List[str] = []

    # Aspect ratio evaluation (Round vs Almond)
    if avg_ear >= 0.38:
        categories.append("Round")
    elif 0.25 <= avg_ear < 0.38:
        categories.append("Almond")

    # Canthal tilt evaluation (Upturned vs Downturned)
    if avg_canthal_tilt_deg >= 4.0:
        categories.append("Upturned")
    elif avg_canthal_tilt_deg <= -3.0:
        categories.append("Downturned")

    # Extreme or ambiguous cases check:
    # If eye aspect ratio is abnormally low (<0.22, e.g. squinting) or high (>0.50),
    # or asymmetry is high (<65%), do not force classification.
    if avg_ear < 0.22 or avg_ear > 0.50 or symmetry_score < 65.0 or len(categories) == 0:
        primary_shape = "Undetermined"
        categories = ["Undetermined"]
        explanation = (
            "Eye proportions or asymmetry fall outside reliable classification thresholds. "
            "Hooded and Monolid eyelid types require high-resolution 3D crease analysis not supported by 2D landmarks."
        )
    else:
        if len(categories) == 1:
            primary_shape = categories[0]
        else:
            # Combine non-mutually exclusive categories cleanly
            primary_shape = f"{categories[0]} ({categories[1]})"

        tilt_desc = (
            f"positive canthal tilt of {avg_canthal_tilt_deg:.1f}°"
            if avg_canthal_tilt_deg > 0
            else f"canthal tilt of {avg_canthal_tilt_deg:.1f}°"
        )
        explanation = (
            f"Characterized by an eye aspect ratio of {avg_ear:.2f} and {tilt_desc}. "
            "Note: Hooded or Monolid eyelid folds cannot be reliably diagnosed from 2D landmarks alone."
        )

    return {
        "eye_shape": primary_shape,
        "eye_shape_confidence": None, # Unvalidated heuristic: do not fabricate high ML confidence
        "categories": categories,
        "measurements": {
            "eye_width_mm": eye_width_mm,
            "eye_height_mm": eye_height_mm,
            "aspect_ratio": round(float(avg_ear), 3),
            "canthal_tilt_deg": round(float(avg_canthal_tilt_deg), 1),
            "symmetry_score": symmetry_score
        },
        "explanation": explanation,
        "classifier_type": "landmark_heuristic",
        "confidence_note": "Geometric landmark heuristic; no clinically validated ML classifier."
    }
