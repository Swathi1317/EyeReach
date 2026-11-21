import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

# Adjust import paths for the project structure
from backend.ml.face_utils import shared_face_analyzer
from backend.ml.ipd import calculate_ipd
from backend.ml.skin_tone import analyze_skin_tone
from backend.ml.eye_shape import analyze_eye_shape
from backend.ml.side_profile import side_profile_analyzer
from backend.ml.head_circumference import head_circumference_estimator

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
    image: UploadFile = File(...),
    reference_width_mm: Optional[float] = Form(None),
    reference_width_px: Optional[float] = Form(None)
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
    
    # 1. IPD Calculation (Iris calibrated or Reference Object)
    ipd_result = calculate_ipd(landmarks, reference_width_mm, reference_width_px)
    
    # 2. Skin Tone Analysis
    skin_result = analyze_skin_tone(image_rgb, landmarks)
    
    # 3. Physical Measurements
    measurements = {}
    mm_per_px = None
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
        
    # 4. Eye Shape Analysis
    eye_shape_result = analyze_eye_shape(landmarks, mm_per_px)

    # 5. Head Circumference Status
    # Single front-facing 2D imagery cannot measure cranial depth or occipital contour.
    # We do NOT infer circumference from face width alone.
    head_circumference_info = {
        "head_circumference_mm": None,
        "status": "not_available",
        "source": "camera_unavailable",
        "display": "Not available with the current camera measurement method",
        "explanation": "A single front-facing 2D image does not provide cranial depth or occipital curvature needed to calculate reliable 3D head circumference."
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
        "eye_shape": eye_shape_result,
        "head_circumference": head_circumference_info,
        "calibrated_mm_per_px": mm_per_px,
        "annotated_image": f"data:image/jpeg;base64,{annotated_base64}"
    }

@router.post("/api/analyze/side-view")
async def analyze_side_view(
    image: UploadFile = File(...),
    side: str = Form("left"),
    calibrated_mm_per_px: Optional[float] = Form(None)
):
    try:
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file.")
        
    if img is None:
        raise HTTPException(status_code=400, detail="Failed to decode image.")
        
    result = side_profile_analyzer.analyze_side_view(
        img,
        expected_side=side,
        mm_per_px=calibrated_mm_per_px
    )
    return result

@router.post("/api/analyze/three-view-head")
async def analyze_three_view_head(
    front_image: UploadFile = File(...),
    left_image: UploadFile = File(...),
    right_image: UploadFile = File(...),
    reference_width_mm: Optional[float] = Form(None),
    reference_width_px: Optional[float] = Form(None),
    calibrated_mm_per_px: Optional[float] = Form(None)
):
    """
    Combines Front View, Left Profile, and Right Profile 2D images
    to estimate cranial breadth, antero-posterior depth, and fronto-occipital head circumference
    using Ramanujan's ellipse approximation with physical scale calibration.
    """
    try:
        f_bytes = await front_image.read()
        l_bytes = await left_image.read()
        r_bytes = await right_image.read()

        f_img = cv2.imdecode(np.frombuffer(f_bytes, np.uint8), cv2.IMREAD_COLOR)
        l_img = cv2.imdecode(np.frombuffer(l_bytes, np.uint8), cv2.IMREAD_COLOR)
        r_img = cv2.imdecode(np.frombuffer(r_bytes, np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to decode three-view images.")

    if f_img is None or l_img is None or r_img is None:
        raise HTTPException(status_code=400, detail="One or more three-view images could not be decoded.")

    result = head_circumference_estimator.estimate_head_circumference_three_view(
        front_img=f_img,
        left_img=l_img,
        right_img=r_img,
        reference_width_mm=reference_width_mm,
        reference_width_px=reference_width_px,
        iris_scale_mm_per_px=calibrated_mm_per_px
    )
    return result

