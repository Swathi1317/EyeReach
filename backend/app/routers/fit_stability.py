import json
import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional, Dict, Any

from backend.ml.fit_stability import fit_stability_analyzer

router = APIRouter()

@router.post("/api/analyze/fit-stability")
async def analyze_fit_stability(
    front_image: Optional[UploadFile] = File(None),
    right_image: Optional[UploadFile] = File(None),
    left_image: Optional[UploadFile] = File(None),
    down_image: Optional[UploadFile] = File(None),
    return_image: Optional[UploadFile] = File(None),
    frame_json: str = Form(...),
    user_ipd_mm: Optional[float] = Form(None),
    calibrated_mm_per_px: Optional[float] = Form(None),
    motion_displacement_px: Optional[float] = Form(0.0),
    tilt_change_deg: Optional[float] = Form(0.0)
):
    """
    Analyzes visual fit and stability for a selected eyewear frame across
    Front, Right-Side, Left-Side, and Head-Down head poses.
    """
    try:
        frame_data = json.loads(frame_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid frame_json format.")

    async def decode_file(file_obj: Optional[UploadFile]) -> Optional[np.ndarray]:
        if file_obj is None:
            return None
        try:
            contents = await file_obj.read()
            if not contents:
                return None
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return img
        except Exception:
            return None

    front_img = await decode_file(front_image)
    right_img = await decode_file(right_image)
    left_img = await decode_file(left_image)
    down_img = await decode_file(down_image)
    return_img = await decode_file(return_image)

    result = fit_stability_analyzer.run_full_analysis(
        front_img=front_img,
        right_img=right_img,
        left_img=left_img,
        down_img=down_img,
        return_img=return_img,
        frame_data=frame_data,
        user_ipd_mm=user_ipd_mm,
        calibrated_mm_per_px=calibrated_mm_per_px,
        motion_displacement_px=motion_displacement_px or 0.0,
        tilt_change_deg=tilt_change_deg or 0.0
    )

    return result
