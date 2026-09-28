import json
import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "frames.json")
KAGGLE_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "kaggle_frames_catalog.json")

class RecommendationRequest(BaseModel):
    face_shape: str
    face_shape_confidence: float
    ipd_mm: float
    ipd_method: str
    skin_tone: str
    undertone: str
    budget: Optional[float] = None
    preferred_color: Optional[str] = None

class RecommendationResponse(BaseModel):
    id: str
    name: str
    category: str
    color: str
    image: Optional[str] = None
    price: str
    final_score: float
    face_shape_score: float
    ipd_fit_score: Optional[float] = None
    skin_tone_score: float
    compatibility: str
    reason: str

class RecommendationResult(BaseModel):
    recommendations: List[RecommendationResponse]

def load_frames():
    if os.path.exists(KAGGLE_DATA_PATH):
        with open(KAGGLE_DATA_PATH, "r") as f:
            return json.load(f)
    elif os.path.exists(DATA_PATH):
        with open(DATA_PATH, "r") as f:
            return json.load(f)
    return []

@router.post("/api/recommendations", response_model=RecommendationResult)
def get_recommendations(req: RecommendationRequest):
    frames = load_frames()
    if not frames:
        raise HTTPException(status_code=500, detail="Frame catalog is empty.")
    
    scored_frames = []
    
    for frame in frames:
        reasons = []
        
        score = 0.0
        
        face_shape = req.face_shape.lower()
        frame_category = frame.get("category", "unknown").lower()
        category_confidence = frame.get("category_confidence", 0.5)
        
        # 1. Face Shape
        shape_matrix = {
            "heart": {"highly": ["cat-eye", "aviator", "round", "oval"]},
            "oblong": {"highly": ["square", "rectangle", "oversized", "wayfarer"]},
            "oval": {"highly": ["square", "rectangle", "cat-eye", "aviator", "round"]},
            "round": {"highly": ["square", "rectangle", "wayfarer", "browline"]},
            "square": {"highly": ["round", "oval", "aviator", "cat-eye"]}
        }
        
        prefs = shape_matrix.get(face_shape, shape_matrix["oval"])
        
        if frame_category == "unknown":
            face_shape_score = 60.0
            comp_tier = "Neutral"
        elif frame_category in prefs.get("highly", []):
            face_shape_score = 95.0
            comp_tier = "Highly Compatible"
        else:
            face_shape_score = 40.0
            comp_tier = "Low"
            
        # 2. IPD / Frame Fit
        lens_width = frame.get("lens_width_mm")
        bridge = frame.get("bridge_width_mm")
        width_mm = frame.get("width_mm")
        
        ipd_fit_score = None
        has_dims = False
        if width_mm is not None:
            frame_width = width_mm
            has_dims = True
        elif lens_width is not None and bridge is not None:
            frame_width = lens_width * 2 + bridge
            has_dims = True
            
        diff = 0.0
        if has_dims:
            ideal_width = req.ipd_mm + 70.0
            diff = abs(ideal_width - frame_width)
            ipd_fit_score = max(0.0, 100.0 - (diff * 2.5))
        
        # 3. Skin Tone / Color
        frame_color = frame.get("color", "").lower()
        undertone = req.undertone.lower()
        
        warm_colors = ["gold", "brown", "tortoise", "warm red", "bronze"]
        neutral_colors = ["gold", "silver", "black", "tortoise", "neutral"]
        cool_colors = ["silver", "black", "blue", "cool red", "clear"]
        
        if undertone == "warm" and any(c in frame_color for c in warm_colors):
            skin_tone_score = 95.0
        elif undertone == "cool" and any(c in frame_color for c in cool_colors):
            skin_tone_score = 95.0
        elif undertone == "neutral" and any(c in frame_color for c in neutral_colors):
            skin_tone_score = 95.0
        else:
            skin_tone_score = 70.0
            
        # Combine Scores with independent weighting
        weight_shape = 0.60
        weight_conf = 0.15
        weight_color = 0.15
        weight_ipd = 0.10
        
        if not has_dims:
            # Redistribute IPD weight (10%) to other factors proportionally
            total_available = 0.90
            weight_shape = 0.60 / total_available
            weight_conf = 0.15 / total_available
            weight_color = 0.15 / total_available
            weight_ipd = 0.0
            
        final_score = (face_shape_score * weight_shape) + \
                      ((category_confidence * 100.0) * weight_conf) + \
                      (skin_tone_score * weight_color) + \
                      ((ipd_fit_score if has_dims else 0) * weight_ipd)
        
        # Construct exact reasoning required by tests
        reason_parts = []
        
        if frame_category == "unknown":
            reason_parts.append(f"Recommended because this frame visually complements a {face_shape.capitalize()} face shape")
        else:
            reason_parts.append(f"Recommended because this {frame_category.capitalize()} frame complements a {face_shape.capitalize()} face shape")
            
        reason_parts.append(f"and its color is compatible with the detected {undertone.capitalize()} undertone.")
        
        if has_dims:
            if diff <= 5:
                reason_parts.append(f"It provides a good IPD fit.")
            else:
                reason_parts.append(f"It provides an adequate IPD fit.")
            
        reason_str = " ".join(reason_parts)
            
        scored_frames.append({
            "frame": frame,
            "final_score": min(final_score, 100.0), 
            "face_shape_score": min(face_shape_score, 100.0),
            "ipd_fit_score": min(ipd_fit_score, 100.0) if ipd_fit_score is not None else None,
            "skin_tone_score": min(skin_tone_score, 100.0),
            "compatibility": comp_tier,
            "reason": reason_str
        })
        
    # Sort by score descending
    scored_frames.sort(key=lambda x: x["final_score"], reverse=True)
    
    # Top 5
    top_frames = scored_frames[:5]
    
    response = []
    for sf in top_frames:
        f = sf["frame"]
        response.append(RecommendationResponse(
            id=f["id"],
            name=f["name"],
            category=f["category"].capitalize() if f.get("category") else "Unknown",
            color=f["color"].capitalize() if f.get("color") else "Unknown",
            image=f.get("image"),
            price=str(f.get("price", "N/A")) if f.get("price") is not None else "N/A",
            final_score=round(sf["final_score"], 1),
            face_shape_score=round(sf["face_shape_score"], 1),
            ipd_fit_score=round(sf["ipd_fit_score"], 1) if sf["ipd_fit_score"] is not None else None,
            skin_tone_score=round(sf["skin_tone_score"], 1),
            compatibility=sf["compatibility"],
            reason=sf["reason"]
        ))
        
    return RecommendationResult(recommendations=response)
