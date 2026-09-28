import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Optional

# Adjust import paths for the project structure
from backend.ml.face_utils import shared_face_analyzer
from backend.ml.ipd import calculate_ipd
from backend.ml.skin_tone import analyze_skin_tone

router = APIRouter()

@router.post("/api/analyze/quality")
async def analyze_quality(image: UploadFile = File(...)):
    try:
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image file.")
        
    if img is None:
        raise HTTPException(status_code=400, detail="Failed to decode image.")
        
    face_data = shared_face_analyzer.process_image(img)
    return {"quality": face_data["quality"]}

@router.post("/api/analyze/phase2")
async def analyze_phase2(
    image: UploadFile = File(...)
):
    try:
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image file.")
        
    if img is None:
        raise HTTPException(status_code=400, detail="Failed to decode image.")
        
    # Shared analysis (quality + landmarks)
    face_data = shared_face_analyzer.process_image(img)
    
    if face_data["quality"]["status"] != "valid":
        return {
            "quality": face_data["quality"],
            "ipd": {"status": "invalid", "reasons": ["quality_check_failed"]},
            "skin_tone": {"status": "invalid", "reasons": ["quality_check_failed"]}
        }
        
    landmarks = face_data["landmarks"]
    image_rgb = face_data["image_rgb"]
    
    # 1. IPD Calculation (Iris calibrated)
    ipd_result = calculate_ipd(landmarks)
    
    # 2. Skin Tone Analysis
    skin_result = analyze_skin_tone(image_rgb, landmarks)
    
    # 3. Physical Measurements
    measurements = {}
    if ipd_result["status"] == "valid" and ipd_result.get("ipd_mm") and ipd_result.get("iris_dist_px"):
        mm_per_px = ipd_result["ipd_mm"] / ipd_result["iris_dist_px"]
        
        def dist(p1, p2):
            return np.linalg.norm(landmarks[p1] - landmarks[p2])
            
        # Standard mediapipe indices for face dimensions
        cheekbone_width_px = dist(234, 454)
        jaw_width_px = dist(132, 361)
        forehead_width_px = dist(71, 301)
        face_length_px = dist(10, 152)
        
        measurements = {
            "cheekbone_width_mm": round(cheekbone_width_px * mm_per_px, 1),
            "jaw_width_mm": round(jaw_width_px * mm_per_px, 1),
            "forehead_width_mm": round(forehead_width_px * mm_per_px, 1),
            "face_length_mm": round(face_length_px * mm_per_px, 1)
        }
        
    # Annotate image
    annotated_img = img.copy()
    
    # Draw measurement lines and text if we have them
    import base64
    
    if measurements and ipd_result["status"] == "valid":
        color = (0, 200, 150) # Teal/Green (BGR)
        thickness = 2
        font = cv2.FONT_HERSHEY_SIMPLEX
        
        def draw_measure(pt1_idx, pt2_idx, label_text):
            p1 = tuple(landmarks[pt1_idx].astype(int))
            p2 = tuple(landmarks[pt2_idx].astype(int))
            cv2.line(annotated_img, p1, p2, color, thickness)
            
            # Draw text near the middle
            mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2 - 10)
            cv2.putText(annotated_img, label_text, mid, font, 0.5, color, 1, cv2.LINE_AA)
            
        draw_measure(468, 473, f"IPD: {ipd_result['ipd_mm']:.1f} mm")
        draw_measure(234, 454, f"Cheek: {measurements['cheekbone_width_mm']:.1f} mm")
        draw_measure(71, 301, f"Forehead: {measurements['forehead_width_mm']:.1f} mm")
        draw_measure(132, 361, f"Jaw: {measurements['jaw_width_mm']:.1f} mm")
        draw_measure(10, 152, f"Length: {measurements['face_length_mm']:.1f} mm")
        
    _, buffer = cv2.imencode('.jpg', annotated_img)
    annotated_base64 = base64.b64encode(buffer).decode('utf-8')
    
    return {
        "quality": face_data["quality"],
        "ipd": ipd_result,
        "skin_tone": skin_result,
        "measurements": measurements,
        "annotated_image": f"data:image/jpeg;base64,{annotated_base64}"
    }
