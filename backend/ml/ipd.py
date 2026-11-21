import numpy as np
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Iris centers
LEFT_IRIS = 468
RIGHT_IRIS = 473

# Iris boundaries (left and right eye in standard Mediapipe mapping)
LEFT_IRIS_BOUNDARIES = [469, 470, 471, 472]
RIGHT_IRIS_BOUNDARIES = [474, 475, 476, 477]

# Anatomical assumption (Not a clinical standard)
REFERENCE_IRIS_DIAMETER_MM = 11.7
MIN_VALID_FRAMES = 8

def _calculate_iris_diameter(landmarks: np.ndarray, center_idx: int, boundary_indices: List[int]) -> float:
    center = landmarks[center_idx]
    # Calculate average distance from center to boundaries
    distances = [np.linalg.norm(landmarks[idx] - center) for idx in boundary_indices]
    # Diameter is roughly 2 * average radius
    radius = float(np.mean(distances))
    return radius * 2.0

def calculate_ipd(
    landmarks: np.ndarray,
    reference_width_mm: Optional[float] = None,
    reference_width_px: Optional[float] = None
) -> Dict:
    """
    Calculates IPD using iris diameter calibration or known reference object.
    Distinguishes calibrated physical measurement from rough scaling, rejects
    turned head poses, and avoids false precision.
    """
    left_iris_center = landmarks[LEFT_IRIS]
    right_iris_center = landmarks[RIGHT_IRIS]
    
    # Calculate diameters
    left_dia_px = _calculate_iris_diameter(landmarks, LEFT_IRIS, LEFT_IRIS_BOUNDARIES)
    right_dia_px = _calculate_iris_diameter(landmarks, RIGHT_IRIS, RIGHT_IRIS_BOUNDARIES)
    
    if left_dia_px < 2.0 or right_dia_px < 2.0:
        return {"status": "invalid", "reasons": ["invalid_iris_detection"]}
        
    # Reject turned head poses causing perspective foreshortening & iris diameter asymmetry
    dia_max = max(left_dia_px, right_dia_px)
    dia_diff = abs(left_dia_px - right_dia_px)
    if dia_max > 0 and (dia_diff / dia_max) > 0.22:
        return {
            "status": "invalid",
            "reasons": ["turned_head_pose"],
            "message": "Head appears turned or tilted. Look directly forward at the camera."
        }
        
    # Calibration scale determination
    if reference_width_mm and reference_width_px and reference_width_px > 5.0:
        mm_per_pixel = reference_width_mm / reference_width_px
        method = "reference-calibrated"
        calibration_source = "reference_object"
        uncertainty_mm = 0.5
        note = f"Calibrated using reference object ({reference_width_mm:.1f} mm)."
    else:
        reference_iris_dia_px = float(np.median([left_dia_px, right_dia_px]))
        mm_per_pixel = REFERENCE_IRIS_DIAMETER_MM / reference_iris_dia_px
        method = "iris-calibrated"
        calibration_source = "iris_hvid_estimate"
        uncertainty_mm = 1.5
        note = "Iris-calibrated estimate based on average corneal diameter (11.7 mm HVID, +/-1.5 mm tolerance)."
    
    # IPD calculation
    iris_dist_px = float(np.linalg.norm(left_iris_center - right_iris_center))
    ipd_mm = iris_dist_px * mm_per_pixel
    
    result = {
        "status": "valid",
        "iris_dist_px": iris_dist_px,
        "method": method,
        "calibration_source": calibration_source,
        "mm_per_px": mm_per_pixel,
        "uncertainty_mm": uncertainty_mm,
        "calibration_note": note,
        "ipd_mm": round(float(ipd_mm), 1),
        "reasons": []
    }
    
    if ipd_mm < 50.0 or ipd_mm > 78.0:
        result["status"] = "invalid"
        result["reasons"].append("implausible_ipd_value")
            
    return result

def aggregate_ipd(measurements: List[Dict]) -> Dict:
    """
    Takes a list of valid IPD measurement dicts (from multiple frames) and aggregates them.
    Requires at least MIN_VALID_FRAMES.
    """
    valid_ipds = [m["ipd_mm"] for m in measurements if m.get("status") == "valid" and m.get("ipd_mm") is not None]
    
    if len(valid_ipds) < MIN_VALID_FRAMES:
        return {
            "status": "invalid",
            "reasons": ["not_enough_stable_frames"],
            "message": "Not enough stable frames. Please keep your face still and try again."
        }
        
    median_ipd = float(np.median(valid_ipds))
    mad = float(np.median([abs(x - median_ipd) for x in valid_ipds]))
    
    # Reject outliers around median
    threshold = max(mad * 3.0, 1.0)
    stable_ipds = [x for x in valid_ipds if abs(x - median_ipd) <= threshold]
    
    if len(stable_ipds) < MIN_VALID_FRAMES:
        return {
            "status": "invalid",
            "reasons": ["unstable_measurement"],
            "message": "Measurement unstable. Please keep your head still and look directly at the camera."
        }
        
    final_median = float(np.median(stable_ipds))
    final_mad = float(np.median([abs(x - final_median) for x in stable_ipds]))
    
    # Additional stability check
    if final_mad > 2.0:
        return {
            "status": "invalid",
            "reasons": ["unstable_measurement"],
            "message": "Measurement unstable. Please keep your head still and look directly at the camera."
        }
    
    return {
        "status": "valid",
        "ipd_mm": round(final_median, 1),
        "method": "iris-calibrated",
        "mad": round(final_mad, 2),
        "frames_used": len(stable_ipds),
        "uncertainty_mm": 1.5,
        "calibration_note": "Iris-calibrated estimate based on 11.7 mm average HVID (+/-1.5 mm tolerance)."
    }
