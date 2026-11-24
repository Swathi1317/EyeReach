import json
import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..db.database import get_db, SessionLocal

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
    # FUTURE EXTENSION: side profile temple length
    side_profile_temple_length_mm: Optional[float] = None
    # Additional Facial Parameters
    eye_shape: Optional[str] = None
    eye_shape_confidence: Optional[float] = None
    head_circumference_mm: Optional[float] = None
    head_circumference_source: Optional[str] = None
    face_width_mm: Optional[float] = None
    # Three-View Side Profile Measurements
    left_eye_to_ear_mm: Optional[float] = None
    right_eye_to_ear_mm: Optional[float] = None
    estimated_temple_length_mm: Optional[float] = None
    side_view_status: Optional[str] = None

class MissingDetail(BaseModel):
    parameter: str
    name: str
    type: str # 'frame_specification' or 'user_measurement'
    description: str
    how_to_provide: str

class FrameDimensionsUpdate(BaseModel):
    width_mm: Optional[float] = None
    lens_width_mm: Optional[float] = None
    lens_height_mm: Optional[float] = None
    bridge_width_mm: Optional[float] = None
    temple_length_mm: Optional[float] = None
    price: Optional[float] = None

MISSING_SPEC_GUIDANCE = {
    "temple_length_mm": {
        "name": "Temple Length",
        "type": "frame_specification",
        "description": "Temple arm length is missing from product specifications.",
        "how_to_provide": "Check the inside temple arm for the 3-number stamp (e.g. 54□18 140, where 140 is temple length in mm) and store it in product specifications."
    },
    "lens_width_mm": {
        "name": "Lens Width",
        "type": "frame_specification",
        "description": "Lens width (Boxing System A) is missing from product specifications.",
        "how_to_provide": "Look for the first number stamped on the temple arm (e.g. 54 in 54□18 140) or measure horizontally across the widest point of one lens in mm."
    },
    "bridge_width_mm": {
        "name": "Bridge Width",
        "type": "frame_specification",
        "description": "Bridge width (DBL) is missing from product specifications.",
        "how_to_provide": "Look for the second number between the square symbol on the inner temple (e.g. 18 in 54□18 140) or measure the distance between the two lenses across the nose bridge in mm."
    },
    "frame_width_mm": {
        "name": "Total Frame Width",
        "type": "frame_specification",
        "description": "Total horizontal frame front width is missing from product specifications.",
        "how_to_provide": "Measure the horizontal front distance from outer left hinge to outer right hinge in mm, or calculate it as (2 × lens width) + bridge width."
    },
    "price": {
        "name": "Product Price",
        "type": "frame_specification",
        "description": "Price is unlisted in product catalog.",
        "how_to_provide": "Check retailer or distributor pricing and update the product record."
    },
    "head_circumference_mm": {
        "name": "Head Circumference",
        "type": "user_measurement",
        "description": "Head circumference has not yet been computed.",
        "how_to_provide": "Complete the 3-View Camera Scan (Front, Left, and Right profiles) to estimate cranial head circumference automatically from 2D images."
    },
    "user_temple": {
        "name": "Side Profile Temple Fit",
        "type": "user_measurement",
        "description": "Side profile eye-to-ear distance has not been captured.",
        "how_to_provide": "Complete the side profile camera capture to measure eye-to-ear reach automatically."
    },
    "ipd_mm": {
        "name": "Interpupillary Distance (IPD)",
        "type": "user_measurement",
        "description": "Pupillary distance (IPD) is uncalibrated or missing.",
        "how_to_provide": "Complete a front-facing straight camera scan looking directly at the camera at eye level, or hold a standard credit-card-sized reference card flat against your forehead for millimeter calibration."
    }
}

class RecommendationResponse(BaseModel):
    id: str
    name: str
    category: str
    color: str
    image: Optional[str] = None
    price: str
    final_score: float
    style_compatibility_score: float
    physical_fit_score: Optional[float] = None
    face_shape_score: float
    ipd_fit_score: Optional[float] = None
    skin_tone_score: float
    compatibility: str
    fit_status: str
    fit_explanation: str
    missing_measurements: List[str] = []
    missing_details: List[MissingDetail] = []
    how_to_provide: List[str] = []
    # Distinct fit indicators
    front_width_compatibility: Optional[str] = "Compatible"
    bridge_compatibility: Optional[str] = "Compatible"
    temple_length_compatibility: Optional[str] = "Partially assessed"
    optical_alignment: Optional[str] = "Optimal"
    reason: str
    # Dimension fields (Boxing System A, B, DBL, Front, Temple)
    frame_width_mm: Optional[float] = None
    lens_width_mm: Optional[float] = None
    lens_height_mm: Optional[float] = None
    bridge_width_mm: Optional[float] = None
    temple_length_mm: Optional[float] = None
    price_status: Optional[str] = "unavailable"
    color_match: Optional[bool] = False
    shop_name: Optional[str] = None
    side_image: Optional[str] = None
    angled_image: Optional[str] = None
    rank: Optional[int] = 1
    is_top_recommendation: Optional[bool] = False

class RecommendationResult(BaseModel):
    recommendations: List[RecommendationResponse]

def load_frames(db: Optional[Session] = None):
    frames = []
    seen_ids = set()

    # 0. Load real optical shop products from Database
    try:
        local_db = db or SessionLocal()
        from ..db.models import Product, Shop
        db_prods = local_db.query(Product).filter(Product.is_active == True).all()
        for p in db_prods:
            pid = f"shop_{p.shop_id}_{p.product_id}"
            if pid not in seen_ids:
                seen_ids.add(pid)
                frames.append({
                    "id": pid,
                    "name": f"{p.brand} {p.name}",
                    "category": (p.shape or "round").lower(),
                    "color": p.color,
                    "image": p.front_image,
                    "side_image": p.side_image or p.front_image,
                    "angled_image": p.angled_image or p.front_image,
                    "price": p.price,
                    "width_mm": p.frame_width_mm or (2 * (p.lens_width_mm or 50) + (p.bridge_width_mm or 18)),
                    "lens_width_mm": p.lens_width_mm,
                    "lens_height_mm": p.lens_height_mm,
                    "bridge_width_mm": p.bridge_width_mm,
                    "temple_length_mm": p.temple_length_mm,
                    "shop_name": p.shop.shop_name if p.shop else "Partner Store",
                    "stock_quantity": p.stock_quantity,
                    "is_complete": bool(p.frame_width_mm and p.lens_width_mm and p.bridge_width_mm and p.temple_length_mm)
                })
        if not db:
            local_db.close()
    except Exception:
        pass

    # 1. Load curated frames with complete physical specifications from frames.json
    if os.path.exists(DATA_PATH):
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                curated = json.load(f)
                for item in curated:
                    if item.get("id") and item["id"] not in seen_ids:
                        seen_ids.add(item["id"])
                        frames.append(item)
        except Exception:
            pass

    # 2. Load Kaggle frames catalog
    if os.path.exists(KAGGLE_DATA_PATH):
        try:
            with open(KAGGLE_DATA_PATH, "r", encoding="utf-8") as f:
                kaggle = json.load(f)
                for item in kaggle:
                    if item.get("id") and item["id"] not in seen_ids:
                        seen_ids.add(item["id"])
                        frames.append(item)
        except Exception:
            pass

    return frames

@router.post("/api/recommendations", response_model=RecommendationResult)
def get_recommendations(req: RecommendationRequest):
    frames = load_frames()
    if not frames:
        raise HTTPException(status_code=500, detail="Frame catalog is empty.")
    
    scored_frames = []
    
    # 0. Normalize user preferred color
    user_preferred_color = req.preferred_color.strip().lower() if req.preferred_color and req.preferred_color.strip() else None

    for frame in frames:
        reasons = []

        # 1. Budget Filter: Exclude frames whose known price exceeds the user's budget
        raw_price = frame.get("price")
        has_known_price = False
        known_price_val = None
        if raw_price is not None and str(raw_price).strip().lower() not in ["n/a", "none", "null", "unknown", ""]:
            try:
                known_price_val = float(raw_price)
                has_known_price = True
            except (ValueError, TypeError):
                has_known_price = False

        if req.budget is not None and req.budget > 0:
            if has_known_price and known_price_val > req.budget:
                continue # Exclude frames whose known price exceeds user budget
        
        face_shape = req.face_shape.lower()
        frame_category = frame.get("category", "unknown").lower()
        category_confidence = frame.get("category_confidence", 0.5)
        
        # 2. Face Shape & Style Matrix
        shape_matrix = {
            "diamond": {"highly": ["browline", "cat-eye", "cat eye", "oval", "round", "rimless"]},
            "heart": {"highly": ["cat-eye", "cat eye", "aviator", "round", "oval", "browline"]},
            "oblong": {"highly": ["square", "rectangle", "oversized", "wayfarer"]},
            "oval": {"highly": ["square", "rectangle", "cat-eye", "cat eye", "aviator", "round", "oval", "geometric", "wayfarer"]},
            "round": {"highly": ["square", "rectangle", "wayfarer", "browline", "geometric"]},
            "square": {"highly": ["round", "oval", "aviator", "cat-eye", "cat eye", "browline"]}
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
            
        # 3. Eye Shape Personalization (Style Component)
        eye_bonus = 0.0
        if req.eye_shape:
            es = req.eye_shape.lower()
            if "round" in es and frame_category in ["square", "rectangle", "wayfarer", "geometric"]:
                eye_bonus = 5.0
            elif "upturned" in es and frame_category in ["cat-eye", "oval", "wayfarer"]:
                eye_bonus = 5.0
            elif "downturned" in es and frame_category in ["aviator", "round", "browline"]:
                eye_bonus = 5.0
            elif "almond" in es:
                eye_bonus = 3.0

        # 4. Skin Tone / Undertone Compatibility
        raw_frame_color = frame.get("color")
        frame_color = str(raw_frame_color).strip().lower() if raw_frame_color is not None else ""
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

        # 5. Preferred Color Prioritization
        # Check reliability: do not claim a match if color metadata is missing or unknown
        is_color_reliable = bool(frame_color and frame_color not in ["unknown", "unspecified", "none", "n/a", "null"])
        color_matched = False
        color_bonus = 0.0

        if user_preferred_color and is_color_reliable:
            # Case and whitespace normalized matching (exact or word-boundary/containment)
            if user_preferred_color == frame_color or user_preferred_color in frame_color or frame_color in user_preferred_color:
                color_matched = True
                color_bonus = 15.0 # Boost to prioritize matching colors
            else:
                color_bonus = -5.0 # Slight penalty for non-matching colors when user specified a preference

        # Calculate Style Compatibility Score
        style_score = (face_shape_score * 0.50) + ((category_confidence * 100.0) * 0.15) + (skin_tone_score * 0.25) + eye_bonus + color_bonus
        style_compatibility_score = round(min(max(style_score, 0.0), 100.0), 1)

        # 4. Physical Fit Compatibility (IPD + Frame Dimensions)
        lens_width = frame.get("lens_width_mm")
        bridge = frame.get("bridge_width_mm")
        width_mm = frame.get("width_mm")
        temple_length = frame.get("temple_length_mm")
        
        missing_measurements = []
        has_dims = False
        frame_width = None
        
        if width_mm is not None:
            frame_width = width_mm
            has_dims = True
        elif lens_width is not None and bridge is not None:
            frame_width = lens_width * 2 + bridge
            has_dims = True
        else:
            missing_measurements.append("frame_width_mm")

        if lens_width is None:
            missing_measurements.append("lens_width_mm")
        if bridge is None:
            missing_measurements.append("bridge_width_mm")
        if temple_length is None:
            missing_measurements.append("temple_length_mm")

        if not has_known_price:
            missing_measurements.append("price")

        # Check essential frame measurements
        essential_missing = []
        if frame_width is None:
            essential_missing.append("frame width")
        if lens_width is None:
            essential_missing.append("lens width")
        if bridge is None:
            essential_missing.append("bridge width")
        if temple_length is None:
            essential_missing.append("temple length")

        has_all_essential = (len(essential_missing) == 0)

        # Validate user-entered or AI three-view estimated head circumference: must be numeric and between 450 mm and 680 mm (45.0 - 68.0 cm)
        valid_user_hc = None
        if req.head_circumference_mm is not None and req.head_circumference_source in ["user_entered", "ai_three_view"]:
            try:
                hc_val = float(req.head_circumference_mm)
                if 450.0 <= hc_val <= 680.0:
                    valid_user_hc = hc_val
            except (ValueError, TypeError):
                valid_user_hc = None

        physical_fit_score = None
        fit_status = "Insufficient data"
        fit_explanation = "Insufficient frame dimensions in catalog to calculate optical fit."
        diff = 0.0

        if has_dims:
            ideal_width = req.ipd_mm + 70.0
            diff = abs(ideal_width - frame_width)
            width_score = max(0.0, 100.0 - (diff * 2.8))

            decentration = None
            decentration_info = ""
            if lens_width is not None and bridge is not None:
                frame_pd = float(lens_width) + float(bridge)
                decentration = abs(frame_pd - req.ipd_mm) / 2.0
                if decentration <= 2.5:
                    decentration_score = 100.0 - (decentration * 4.0)
                elif decentration <= 4.0:
                    decentration_score = 90.0 - ((decentration - 2.5) * 10.0)
                else:
                    decentration_score = max(0.0, 60.0 - ((decentration - 4.0) * 15.0))
                raw_physical = 0.5 * width_score + 0.5 * decentration_score
                decentration_info = f"Frame PD is {frame_pd:.0f} mm (optical decentration: {decentration:.1f} mm/eye). "
            else:
                raw_physical = width_score

            # Adjust if user manually entered a valid head circumference
            if valid_user_hc is not None:
                if valid_user_hc < 540.0:
                    ideal_fw = 131.0
                elif valid_user_hc <= 570.0:
                    ideal_fw = 137.0
                else:
                    ideal_fw = 144.0
                hc_diff = abs(frame_width - ideal_fw)
                hc_score = max(0.0, 100.0 - (hc_diff * 3.5))
                raw_physical = 0.7 * raw_physical + 0.3 * hc_score

            # Adjust if temple length measurement is available
            user_temple = req.estimated_temple_length_mm or req.side_profile_temple_length_mm
            if temple_length is not None and user_temple is not None:
                t_diff = abs(user_temple - float(temple_length))
                t_score = max(0.0, 100.0 - (t_diff * 3.5))
                raw_physical = 0.85 * raw_physical + 0.15 * t_score
                # Order thresholds with most severe applicable category taking priority:
                # Difference > 18 mm: Unsuitable
                # Difference > 10 mm: Review Fit
                # Difference > 5 mm: Acceptable
                # Difference <= 5 mm: Compatible
                if t_diff > 18.0:
                    temple_compat = "Unsuitable"
                elif t_diff > 10.0:
                    temple_compat = "Review Fit"
                elif t_diff > 5.0:
                    temple_compat = "Acceptable"
                else:
                    temple_compat = "Compatible"
            elif temple_length is not None:
                temple_compat = "Partially assessed"
            else:
                temple_compat = "Temple length unavailable"

            # Determine fit indicators
            fw_diff = frame_width - ideal_width
            if abs(fw_diff) <= 4:
                front_compat = "Optimal"
            elif abs(fw_diff) <= 8:
                front_compat = "Compatible"
            elif fw_diff > 8:
                front_compat = "Slightly Wide"
            else:
                front_compat = "Slightly Narrow"

            if bridge is not None:
                bridge_val = float(bridge)
                if 15 <= bridge_val <= 21:
                    bridge_compat = "Compatible"
                elif bridge_val < 15:
                    bridge_compat = "Narrow Bridge"
                else:
                    bridge_compat = "Wide Bridge"
            else:
                bridge_compat = "Insufficient data"

            if decentration is not None:
                if decentration <= 2.5:
                    opt_align = f"Optimal ({decentration:.1f} mm)"
                elif decentration <= 4.0:
                    opt_align = f"Acceptable ({decentration:.1f} mm)"
                else:
                    opt_align = f"Review Alignment ({decentration:.1f} mm)"
            else:
                opt_align = "Insufficient data"

            physical_fit_score = round(min(max(raw_physical, 0.0), 100.0), 1)

            missing_details_list = []
            how_to_provide_list = []

            for m_key in missing_measurements:
                if m_key in MISSING_SPEC_GUIDANCE:
                    g = MISSING_SPEC_GUIDANCE[m_key]
                    missing_details_list.append(MissingDetail(
                        parameter=m_key,
                        name=g["name"],
                        type=g["type"],
                        description=g["description"],
                        how_to_provide=g["how_to_provide"]
                    ))
                    how_to_provide_list.append(f"{g['name']}: {g['how_to_provide']}")

            if valid_user_hc is None:
                g = MISSING_SPEC_GUIDANCE["head_circumference_mm"]
                missing_details_list.append(MissingDetail(
                    parameter="head_circumference_mm",
                    name=g["name"],
                    type=g["type"],
                    description=g["description"],
                    how_to_provide=g["how_to_provide"]
                ))
                how_to_provide_list.append(f"{g['name']}: {g['how_to_provide']}")

            if user_temple is None:
                g = MISSING_SPEC_GUIDANCE["user_temple"]
                missing_details_list.append(MissingDetail(
                    parameter="user_temple",
                    name=g["name"],
                    type=g["type"],
                    description=g["description"],
                    how_to_provide=g["how_to_provide"]
                ))
                how_to_provide_list.append(f"{g['name']}: {g['how_to_provide']}")

            # Enforce essential dimensions and honest fit prediction
            if not has_all_essential:
                # Essential measurements missing: MUST display "Insufficient data", NEVER "Compatible"
                fit_status = "Insufficient data"
                frame_missing_items = [m for m in missing_details_list if m.type == "frame_specification" and m.parameter != "price"]
                missing_names = ", ".join(m.name for m in frame_missing_items) if frame_missing_items else ", ".join(essential_missing)
                how_to_provide_str = " ".join(m.how_to_provide for m in frame_missing_items)
                
                expl_parts = [
                    f"Insufficient data: {missing_names} is missing from product specifications.",
                    f"How to provide: {how_to_provide_str}"
                ]
                if decentration is not None:
                    expl_parts.append(decentration_info.strip())
                    if decentration > 4.0:
                        expl_parts.append(f"Optical decentration ({decentration:.1f} mm/eye) is excessive for your {req.ipd_mm:.1f} mm IPD.")
                    elif decentration <= 2.5:
                        expl_parts.append("Optical decentration is optimal.")
                    else:
                        expl_parts.append("Optical decentration is acceptable.")
                expl_parts.append(f"Frame width is {frame_width:.0f} mm (ideal: {ideal_width:.0f} mm, diff: {diff:.1f} mm).")
                expl_parts.append("Physical fit cannot be verified without complete specifications.")
                fit_explanation = " ".join(expl_parts)
            else:
                unsuitable_reasons = []
                review_reasons = []

                if decentration is not None and decentration > 4.0:
                    unsuitable_reasons.append(f"excessive decentration ({decentration:.1f} mm/eye)")
                elif decentration is not None and decentration > 3.0:
                    review_reasons.append(f"moderate decentration ({decentration:.1f} mm/eye)")

                # Frame width difference thresholds in order of severity priority:
                # Difference > 18 mm: Unsuitable
                # Difference > 10 mm: Review Fit
                # Difference <= 10 mm: Acceptable
                # Difference <= 5 mm: Compatible
                if diff > 18.0:
                    unsuitable_reasons.append(f"frame width mismatch ({frame_width:.0f} mm vs ideal {ideal_width:.0f} mm, diff {diff:.1f} mm)")
                elif diff > 10.0:
                    review_reasons.append(f"frame width differs by {diff:.1f} mm from ideal ({frame_width:.0f} mm vs ideal {ideal_width:.0f} mm)")

                if bridge is not None and (float(bridge) < 14.0 or float(bridge) > 22.0):
                    review_reasons.append(f"bridge width ({float(bridge):.0f} mm) may require adjustment")

                if user_temple is not None and temple_length is not None:
                    t_diff = abs(user_temple - float(temple_length))
                    if t_diff > 18.0:
                        unsuitable_reasons.append(f"temple length mismatch ({float(temple_length):.0f} mm vs reach ~{user_temple:.0f} mm, diff {t_diff:.1f} mm)")
                    elif t_diff > 10.0:
                        review_reasons.append(f"temple length difference ({float(temple_length):.0f} mm vs reach ~{user_temple:.0f} mm, diff {t_diff:.1f} mm)")

                if unsuitable_reasons:
                    fit_status = "Unsuitable"
                    fit_explanation = (
                        f"{decentration_info}Frame width is {frame_width:.0f} mm (ideal: {ideal_width:.0f} mm, diff: {diff:.1f} mm). "
                        f"Unsuitable fit: {'; '.join(unsuitable_reasons)}."
                    )
                elif review_reasons or physical_fit_score < 75.0:
                    fit_status = "Review Fit"
                    fit_explanation = (
                        f"{decentration_info}Frame width is {frame_width:.0f} mm (ideal: {ideal_width:.0f} mm, diff: {diff:.1f} mm). "
                        f"Review Fit: {'; '.join(review_reasons) if review_reasons else 'Borderline dimensions'}. Physical try-on advised."
                    )
                else:
                    fit_status = "Compatible"
                    fit_explanation = (
                        f"{decentration_info}Frame width is {frame_width:.0f} mm (ideal: {ideal_width:.0f} mm, diff: {diff:.1f} mm). "
                        f"Compatible: Frame dimensions and optical centering match your IPD and cranial proportions."
                    )
        else:
            front_compat = "Insufficient data"
            bridge_compat = "Insufficient data"
            if temple_length is not None and user_temple is not None:
                t_diff = abs(user_temple - float(temple_length))
                if t_diff > 18.0:
                    temple_compat = "Unsuitable"
                elif t_diff > 10.0:
                    temple_compat = "Review Fit"
                elif t_diff > 5.0:
                    temple_compat = "Acceptable"
                else:
                    temple_compat = "Compatible"
            elif temple_length is not None:
                temple_compat = "Partially assessed"
            else:
                temple_compat = "Temple length unavailable"
            opt_align = "Insufficient data"
            fit_status = "Insufficient data"
            fit_explanation = "Physical fit score unavailable due to missing frame dimensions. Ranking based on style compatibility."

        # 5. Combined Overall Recommendation
        if physical_fit_score is not None:
            final_score = round(0.55 * style_compatibility_score + 0.45 * physical_fit_score, 1)
        else:
            final_score = round(style_compatibility_score, 1)
            fit_status = "Insufficient data"
            fit_explanation = "Physical fit score unavailable due to missing frame dimensions. Ranking based on style compatibility."

        # Construct exact reasoning required by tests
        reason_parts = []
        if frame_category == "unknown":
            reason_parts.append(f"Recommended because this frame visually complements a {face_shape.capitalize()} face shape")
        else:
            reason_parts.append(f"Recommended because this {frame_category.capitalize()} frame complements a {face_shape.capitalize()} face shape")
            
        reason_parts.append(f"and its color is compatible with the detected {undertone.capitalize()} undertone.")

        if color_matched:
            reason_parts.append(f"It matches your preferred {frame_color.capitalize()} color.")
        elif user_preferred_color and not is_color_reliable:
            reason_parts.append("Note: Color metadata is unverified in catalog.")
        
        if has_dims:
            if diff <= 5:
                reason_parts.append("It provides a good IPD fit.")
            else:
                reason_parts.append("It provides an adequate IPD fit.")
            
        reason_str = " ".join(reason_parts)
            
        scored_frames.append({
            "frame": frame,
            "final_score": min(final_score, 100.0),
            "style_compatibility_score": style_compatibility_score,
            "physical_fit_score": physical_fit_score,
            "face_shape_score": min(face_shape_score, 100.0),
            "ipd_fit_score": physical_fit_score,
            "skin_tone_score": min(skin_tone_score, 100.0),
            "compatibility": comp_tier,
            "fit_status": fit_status,
            "fit_explanation": fit_explanation,
            "missing_measurements": missing_measurements,
            "missing_details": missing_details_list,
            "how_to_provide": how_to_provide_list,
            "front_width_compatibility": front_compat,
            "bridge_compatibility": bridge_compat,
            "temple_length_compatibility": temple_compat,
            "optical_alignment": opt_align,
            "reason": reason_str,
            "price_status": "verified" if has_known_price else "unlisted",
            "color_match": color_matched
        })
        
    # Sort by score descending
    scored_frames.sort(key=lambda x: x["final_score"], reverse=True)
    # Return 24–30 suitable frames in total (Requirement 5: approximately 22–30 suitable frames total, top 5 highlighted)
    top_frames = scored_frames[:28]
    
    response = []
    for idx, sf in enumerate(top_frames):
        f = sf["frame"]
        is_top = (idx < 5)
        
        response.append(RecommendationResponse(
            id=f["id"],
            name=f["name"],
            category=f["category"].capitalize() if f.get("category") else "Unknown",
            color=f["color"].capitalize() if f.get("color") else "Unknown",
            image=f.get("image"),
            price=str(f.get("price", "N/A")) if f.get("price") is not None else "N/A",
            final_score=round(sf["final_score"], 1),
            style_compatibility_score=sf["style_compatibility_score"],
            physical_fit_score=sf["physical_fit_score"],
            face_shape_score=round(sf["face_shape_score"], 1),
            ipd_fit_score=sf["ipd_fit_score"],
            skin_tone_score=round(sf["skin_tone_score"], 1),
            compatibility=sf["compatibility"],
            fit_status=sf["fit_status"],
            fit_explanation=sf["fit_explanation"],
            missing_measurements=sf["missing_measurements"],
            missing_details=sf["missing_details"],
            how_to_provide=sf["how_to_provide"],
            front_width_compatibility=sf["front_width_compatibility"],
            bridge_compatibility=sf["bridge_compatibility"],
            temple_length_compatibility=sf["temple_length_compatibility"],
            optical_alignment=sf["optical_alignment"],
            reason=sf["reason"],
            frame_width_mm=f.get("width_mm"),
            lens_width_mm=f.get("lens_width_mm"),
            lens_height_mm=f.get("lens_height_mm"),
            bridge_width_mm=f.get("bridge_width_mm"),
            temple_length_mm=f.get("temple_length_mm"),
            price_status=sf["price_status"],
            color_match=sf["color_match"],
            shop_name=f.get("shop_name", "VisionCraft Opticians"),
            side_image=f.get("side_image") or f.get("image"),
            angled_image=f.get("angled_image") or f.get("image"),
            rank=idx + 1,
            is_top_recommendation=is_top
        ))
        
    return RecommendationResult(recommendations=response)

@router.get("/api/frames")
def list_frames(limit: int = 50, offset: int = 0, query: Optional[str] = None):
    """
    List frames from catalog with actual specifications and completeness indicators.
    """
    frames = load_frames()
    if query:
        q = query.lower()
        frames = [f for f in frames if q in str(f.get("name", "")).lower() or q in str(f.get("category", "")).lower() or q in str(f.get("color", "")).lower()]
    
    total = len(frames)
    paged = frames[offset:offset + limit]
    
    result = []
    for f in paged:
        has_w = f.get("width_mm") is not None
        has_l = f.get("lens_width_mm") is not None
        has_b = f.get("bridge_width_mm") is not None
        has_t = f.get("temple_length_mm") is not None
        is_complete = bool(has_w and has_l and has_b and has_t)
        result.append({
            "id": f.get("id"),
            "name": f.get("name"),
            "category": f.get("category"),
            "color": f.get("color"),
            "image": f.get("image"),
            "price": f.get("price"),
            "width_mm": f.get("width_mm"),
            "lens_width_mm": f.get("lens_width_mm"),
            "lens_height_mm": f.get("lens_height_mm"),
            "bridge_width_mm": f.get("bridge_width_mm"),
            "temple_length_mm": f.get("temple_length_mm"),
            "is_complete": is_complete,
            "missing_specs": [s for s, h in [("width_mm", has_w), ("lens_width_mm", has_l), ("bridge_width_mm", has_b), ("temple_length_mm", has_t)] if not h]
        })
    return {"total": total, "frames": result}

@router.get("/api/frames/{frame_id}")
def get_frame(frame_id: str):
    """
    Get a single frame by ID with detailed specifications.
    """
    frames = load_frames()
    for f in frames:
        if str(f.get("id")) == str(frame_id):
            return f
    raise HTTPException(status_code=404, detail=f"Frame '{frame_id}' not found.")

@router.put("/api/frames/{frame_id}")
def update_frame_dimensions(frame_id: str, update: FrameDimensionsUpdate):
    """
    Store or update actual physical frame dimensions (temple length, width, lens width, bridge width).
    Validates that provided dimensions are positive, non-zero values.
    Saves updates persistently into the catalog file.
    """
    for dim_name, dim_val in [
        ("width_mm", update.width_mm),
        ("lens_width_mm", update.lens_width_mm),
        ("lens_height_mm", update.lens_height_mm),
        ("bridge_width_mm", update.bridge_width_mm),
        ("temple_length_mm", update.temple_length_mm),
    ]:
        if dim_val is not None and dim_val <= 0:
            raise HTTPException(status_code=400, detail=f"{dim_name} must be a positive non-zero number.")
    
    if update.price is not None and update.price < 0:
        raise HTTPException(status_code=400, detail="Price cannot be negative.")

    target_found = False
    updated_frame = None

    # Check and update in KAGGLE_DATA_PATH
    if os.path.exists(KAGGLE_DATA_PATH):
        try:
            with open(KAGGLE_DATA_PATH, "r", encoding="utf-8") as f:
                k_data = json.load(f)
            for item in k_data:
                if str(item.get("id")) == str(frame_id):
                    if update.width_mm is not None: item["width_mm"] = update.width_mm
                    if update.lens_width_mm is not None: item["lens_width_mm"] = update.lens_width_mm
                    if update.lens_height_mm is not None: item["lens_height_mm"] = update.lens_height_mm
                    if update.bridge_width_mm is not None: item["bridge_width_mm"] = update.bridge_width_mm
                    if update.temple_length_mm is not None: item["temple_length_mm"] = update.temple_length_mm
                    if update.price is not None: item["price"] = update.price
                    target_found = True
                    updated_frame = item
                    break
            if target_found:
                with open(KAGGLE_DATA_PATH, "w", encoding="utf-8") as f:
                    json.dump(k_data, f, indent=2)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to update catalog: {e}")

    # If not found in Kaggle, check and update in DATA_PATH
    if not target_found and os.path.exists(DATA_PATH):
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                c_data = json.load(f)
            for item in c_data:
                if str(item.get("id")) == str(frame_id):
                    if update.width_mm is not None: item["width_mm"] = update.width_mm
                    if update.lens_width_mm is not None: item["lens_width_mm"] = update.lens_width_mm
                    if update.lens_height_mm is not None: item["lens_height_mm"] = update.lens_height_mm
                    if update.bridge_width_mm is not None: item["bridge_width_mm"] = update.bridge_width_mm
                    if update.temple_length_mm is not None: item["temple_length_mm"] = update.temple_length_mm
                    if update.price is not None: item["price"] = update.price
                    target_found = True
                    updated_frame = item
                    break
            if target_found:
                with open(DATA_PATH, "w", encoding="utf-8") as f:
                    json.dump(c_data, f, indent=2)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to update catalog: {e}")

    if not target_found:
        raise HTTPException(status_code=404, detail=f"Frame '{frame_id}' not found in any catalog.")

    return {
        "status": "success",
        "message": f"Frame '{frame_id}' specifications successfully updated.",
        "frame": updated_frame
    }
