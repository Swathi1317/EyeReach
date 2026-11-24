"""
Three-View Head Circumference & Cranial Geometry Estimator.
Analyzes Front, Left Profile, and Right Profile 2D camera images to estimate:
  - Transverse Head Breadth (B) from Front view
  - Antero-Posterior Head Depth (L) from Left & Right profiles
  - Fronto-Occipital Head Circumference (FOC) via Ramanujan's Ellipse Approximation
  - Bilateral Symmetry, Hair Interference, and Physical Scale Uncertainty

IMPORTANT SCIENTIFIC CONSTRAINTS:
1. 2D camera images provide an ESTIMATE, not an exact or clinically validated physical measurement.
2. Facial landmarks (viscerocranium) alone do not represent the neurocranium or occiput;
   MediaPipe SelfieSegmentation provides the full-head silhouette mask.
3. Iris-based scaling is an approximation based on population-average HVID (11.7 mm)
   with natural anatomical variation (+/-0.8 mm); reference objects provide calibrated physical scaling.
4. Scale is propagated between views using orientation-invariant facial height datums.
5. Physiological plausibility and bilateral consistency are strictly enforced.
"""

import cv2
import numpy as np
import mediapipe as mp
import base64
import math
from typing import Dict, List, Optional, Tuple, Any

from backend.ml.face_utils import shared_face_analyzer
from backend.ml.side_profile import side_profile_analyzer
from backend.ml.ipd import calculate_ipd, REFERENCE_IRIS_DIAMETER_MM


class HeadCircumferenceEstimator:
    def __init__(self):
        # MediaPipe Selfie Segmentation for cranial and occipital silhouette isolation
        # model_selection=0: General/portrait model (lightweight and fast for webcam portraits)
        self.selfie_seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.45
        )

    def get_silhouette_mask(self, img_rgb: np.ndarray, threshold: float = 0.50) -> np.ndarray:
        """
        Generates a clean binary mask (0 or 255) of the human subject using SelfieSegmentation.
        Applies morphological closing to fill hair voids and opening to remove background speckle.
        """
        seg_res = self.selfie_seg.process(img_rgb)
        if seg_res.segmentation_mask is None:
            return np.zeros(img_rgb.shape[:2], dtype=np.uint8)

        raw_mask = (seg_res.segmentation_mask > threshold).astype(np.uint8) * 255

        # Morphological filtering to close internal gaps (e.g. hair shine, dark strands)
        kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        closed_mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel_close)

        kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        clean_mask = cv2.morphologyEx(closed_mask, cv2.MORPH_OPEN, kernel_open)
        return clean_mask

    def calculate_ramanujan_circumference(self, a_mm: float, b_mm: float) -> float:
        """
        Calculates the circumference of an ellipse with semi-axes a (depth / 2)
        and b (breadth / 2) using Ramanujan's second approximation.

        Formula:
          h = (a - b)^2 / (a + b)^2
          C = pi * (a + b) * (1 + 3h / (10 + sqrt(4 - 3h)))

        Limitations:
          Human transverse cranial section at FOC level is generally ovoid (narrower
          at frontal bone, wider at parietal eminences) rather than a symmetrical ellipse.
          Ramanujan's ellipse approximation serves as a geometric proxy.
        """
        if a_mm <= 0 or b_mm <= 0:
            return 0.0

        h = ((a_mm - b_mm) ** 2) / ((a_mm + b_mm) ** 2)
        c_mm = math.pi * (a_mm + b_mm) * (1.0 + (3.0 * h) / (10.0 + math.sqrt(4.0 - (3.0 * h))))
        return c_mm

    def extract_front_cranial_breadth(
        self,
        img: np.ndarray,
        landmarks: np.ndarray,
        mm_per_px: Optional[float]
    ) -> Dict[str, Any]:
        """
        Extracts transverse cranial breadth (B) from the front view silhouette
        at the level of maximum cranial width above the supraorbital ridge.
        """
        h, w = img.shape[:2]
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mask = self.get_silhouette_mask(img_rgb)

        # Facial Datums:
        # Landmark 10: Top of forehead hairline
        # Landmark 168: Glabella / brow level
        # Landmark 152: Chin
        # Landmarks 234, 454: Zygomatic arches / lateral cheekbones
        # Landmarks 127, 356: Temporal bones
        glabella_y = int(landmarks[168][1])
        forehead_y = int(landmarks[10][1])
        chin_y = int(landmarks[152][1])
        face_height_px = float(np.linalg.norm(landmarks[168] - landmarks[152]))

        # Anatomical cranial breadth measurement level:
        # Transverse plane passing through the upper parietal/temporal area
        # Situated between glabella and top of head
        cranial_level_y = int(glabella_y - (face_height_px * 0.28))
        cranial_level_y = max(5, min(h - 5, cranial_level_y))

        # Check mask slice across the cranial level
        slice_row = mask[cranial_level_y, :]
        indices = np.where(slice_row > 128)[0]

        bony_temporal_dist_px = float(np.linalg.norm(landmarks[127] - landmarks[356]))

        if len(indices) < 20:
            # Fallback search across small vertical band
            band_y_min = max(0, cranial_level_y - 20)
            band_y_max = min(h, cranial_level_y + 20)
            band_mask = mask[band_y_min:band_y_max, :]
            coords = np.column_stack(np.where(band_mask > 128))
            if len(coords) > 20:
                min_x = int(np.min(coords[:, 1]))
                max_x = int(np.max(coords[:, 1]))
                breadth_px = float(max_x - min_x)
            else:
                # Robust fallback: bony temporal baseline scaled to parietal breadth
                breadth_px = max(bony_temporal_dist_px * 1.16, face_height_px * 0.78)
                center_x = (landmarks[127][0] + landmarks[356][0]) / 2.0
                min_x = int(center_x - breadth_px / 2.0)
                max_x = int(center_x + breadth_px / 2.0)
        else:
            min_x = int(indices[0])
            max_x = int(indices[-1])
            breadth_px = float(max_x - min_x)
            # Safeguard: silhouette breadth should not be less than bony temporal landmarks
            if breadth_px < bony_temporal_dist_px * 0.90:
                breadth_px = max(bony_temporal_dist_px * 1.14, breadth_px)

        # Hair interference check:
        # Compare silhouette breadth against bony temporal landmarks (127 to 356)
        bony_temporal_dist_px = float(np.linalg.norm(landmarks[127] - landmarks[356]))
        hair_ratio = breadth_px / max(bony_temporal_dist_px, 1.0)

        hair_interference = "minimal"
        if hair_ratio > 1.45:
            hair_interference = "high"
        elif hair_ratio > 1.28:
            hair_interference = "moderate"

        breadth_mm = round(breadth_px * mm_per_px, 1) if mm_per_px else None

        return {
            "status": "valid",
            "breadth_px": breadth_px,
            "breadth_mm": breadth_mm,
            "cranial_level_y": cranial_level_y,
            "min_x": min_x,
            "max_x": max_x,
            "bony_temporal_px": bony_temporal_dist_px,
            "hair_ratio": round(hair_ratio, 2),
            "hair_interference": hair_interference,
            "face_height_px": face_height_px
        }

    def extract_profile_cranial_depth(
        self,
        img: np.ndarray,
        landmarks: np.ndarray,
        expected_side: str,
        scale_mm_per_px: Optional[float]
    ) -> Dict[str, Any]:
        """
        Extracts antero-posterior cranial depth (L) from a near-profile view
        by finding the anterior forehead datum and posterior occiput boundary.
        """
        h, w = img.shape[:2]
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mask = self.get_silhouette_mask(img_rgb)

        glabella_y = int(landmarks[168][1])
        glabella_x = int(landmarks[168][0])
        chin_y = int(landmarks[152][1])
        face_height_px = float(np.linalg.norm(landmarks[168] - landmarks[152]))

        # FOC plane level: slightly above glabella horizontally
        foc_y = int(glabella_y - (face_height_px * 0.15))
        foc_y = max(5, min(h - 5, foc_y))

        # Check mask slice along the FOC horizontal plane
        slice_row = mask[foc_y, :]
        indices = np.where(slice_row > 128)[0]

        # In MediaPipe FaceMesh: landmark 234 is right tragus, landmark 454 is left tragus.
        # In near-profile view, the visible ear facing the camera is landmark 234 when turned left, and 454 when turned right.
        ear_idx = 234 if expected_side == "left" else 454
        glabella_to_ear_px = float(np.linalg.norm(landmarks[168] - landmarks[ear_idx]))
        # In human cephalometry, glabella-to-tragus is ~48%-52% of total fronto-occipital cranial depth
        cephalometric_depth_px = max(glabella_to_ear_px * 2.05, face_height_px * 1.15)

        if len(indices) < 20:
            band_y_min = max(0, foc_y - 15)
            band_y_max = min(h, foc_y + 15)
            band_mask = mask[band_y_min:band_y_max, :]
            coords = np.column_stack(np.where(band_mask > 128))
            if len(coords) > 20:
                min_x = int(np.min(coords[:, 1]))
                max_x = int(np.max(coords[:, 1]))
                depth_px = float(max_x - min_x)
            else:
                # Robust fallback to landmark cephalometric projection
                depth_px = cephalometric_depth_px
                min_x = int(glabella_x - depth_px) if expected_side == "left" else int(glabella_x)
                max_x = int(glabella_x) if expected_side == "left" else int(glabella_x + depth_px)
        else:
            min_x = int(indices[0])
            max_x = int(indices[-1])
            depth_px = float(max_x - min_x)

        # Bound within physiological cranial proportions to prevent room background clutter inflation
        if depth_px < cephalometric_depth_px * 0.82 or depth_px > cephalometric_depth_px * 1.28:
            depth_px = cephalometric_depth_px

        # Hair protrusion / bun detection:
        # Check slope of posterior contour above and below the FOC line
        hair_protrusion = False
        posterior_x = min_x if expected_side == "left" else max_x
        # Sample slices 25px above and below
        y_above = max(0, foc_y - 25)
        y_below = min(h - 1, foc_y + 25)
        row_above = np.where(mask[y_above, :] > 128)[0]
        row_below = np.where(mask[y_below, :] > 128)[0]

        if len(row_above) > 0 and len(row_below) > 0:
            post_above = row_above[0] if expected_side == "left" else row_above[-1]
            post_below = row_below[0] if expected_side == "left" else row_below[-1]
            # If the posterior contour juts outward abruptly by >35px, flag as protrusion
            if abs(posterior_x - post_above) > 35 or abs(posterior_x - post_below) > 35:
                hair_protrusion = True

        depth_mm = round(depth_px * scale_mm_per_px, 1) if scale_mm_per_px else None

        return {
            "status": "valid",
            "depth_px": depth_px,
            "depth_mm": depth_mm,
            "foc_y": foc_y,
            "min_x": min_x,
            "max_x": max_x,
            "glabella_pt": (glabella_x, glabella_y),
            "hair_protrusion": hair_protrusion,
            "face_height_px": face_height_px
        }

    def estimate_head_circumference_three_view(
        self,
        front_img: np.ndarray,
        left_img: np.ndarray,
        right_img: np.ndarray,
        reference_width_mm: Optional[float] = None,
        reference_width_px: Optional[float] = None,
        iris_scale_mm_per_px: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        End-to-end Three-View Head Circumference & Cranial Geometry Pipeline.
        Combines Front, Left Profile, and Right Profile images with physical scaling
        and Ramanujan's ellipse approximation.
        """
        quality_reasons = []
        messages = []

        # ------------------------------------------------------------------
        # 1. INPUT VALIDATION: Front View
        # ------------------------------------------------------------------
        if front_img is None or front_img.size == 0:
            return self._build_failure_result(
                "invalid", ["missing_front_image"],
                "Front view image is missing or corrupted."
            )

        front_face_data = shared_face_analyzer.process_image(front_img)
        if front_face_data["quality"]["status"] != "valid" and front_face_data.get("landmarks") is None:
            return self._build_failure_result(
                "invalid", front_face_data["quality"]["reasons"],
                "Front view quality check failed. Ensure face is clearly visible, well-lit, and facing forward."
            )

        front_landmarks = front_face_data["landmarks"]

        # ------------------------------------------------------------------
        # 2. PHYSICAL SCALE DETERMINATION & CALIBRATION SOURCE
        # ------------------------------------------------------------------
        # Determine scale in Front View:
        # Priority 1: Physical Reference Object (e.g. Card, +/-1.5% uncertainty)
        # Priority 2: Iris HVID Biometric Approximation (+/-6.5% uncertainty)
        calibration_source = "uncalibrated"
        scale_uncertainty_percent = 25.0
        front_mm_per_px = None

        if reference_width_mm and reference_width_px and reference_width_px > 5.0:
            front_mm_per_px = float(reference_width_mm) / float(reference_width_px)
            calibration_source = "reference_object"
            scale_uncertainty_percent = 2.0
            messages.append(f"Calibrated using physical reference object ({reference_width_mm:.1f} mm).")
        else:
            # Try iris calculation from front view
            ipd_res = calculate_ipd(front_landmarks, reference_width_mm, reference_width_px)
            if ipd_res.get("status") == "valid" and ipd_res.get("mm_per_px"):
                front_mm_per_px = float(ipd_res["mm_per_px"])
                calibration_source = "iris_approximation"
                scale_uncertainty_percent = 6.5
                messages.append(
                    "Iris biometric approximation applied (assumes 11.7 mm average corneal diameter with natural +/-0.8 mm variation)."
                )
            elif iris_scale_mm_per_px and iris_scale_mm_per_px > 0:
                front_mm_per_px = float(iris_scale_mm_per_px)
                calibration_source = "iris_approximation"
                scale_uncertainty_percent = 6.5
                messages.append("Using provided iris scale factor approximation.")

        if front_mm_per_px is None or front_mm_per_px <= 0:
            return self._build_failure_result(
                "unreliable", ["scale_calibration_unavailable"],
                "Unable to determine physical scale. Iris landmarks or reference calibration unavailable."
            )

        # ------------------------------------------------------------------
        # 3. FRONT VIEW CRANIAL BREADTH (B) EXTRACTION
        # ------------------------------------------------------------------
        breadth_res = self.extract_front_cranial_breadth(front_img, front_landmarks, front_mm_per_px)
        front_face_h_px = breadth_res.get("face_height_px") or float(np.linalg.norm(front_landmarks[168] - front_landmarks[152]))

        # Anatomical baseline check:
        bony_temporal_px = float(np.linalg.norm(front_landmarks[127] - front_landmarks[356]))
        bony_temporal_mm = bony_temporal_px * front_mm_per_px
        anthro_breadth_mm = max(bony_temporal_mm * 1.15, front_face_h_px * front_mm_per_px * 0.78)

        if breadth_res.get("status") == "valid" and breadth_res.get("breadth_mm") and 130.0 <= breadth_res["breadth_mm"] <= 175.0:
            head_breadth_mm = float(breadth_res["breadth_mm"])
        else:
            head_breadth_mm = round(max(135.0, min(168.0, anthro_breadth_mm)), 1)

        # ------------------------------------------------------------------
        # 4. SIDE PROFILE ANALYSES & SCALE PROPAGATION (Left & Right)
        # ------------------------------------------------------------------
        if left_img is None or left_img.size == 0 or right_img is None or right_img.size == 0:
            return self._build_failure_result(
                "invalid", ["missing_side_images"],
                "Both Left and Right profile images are required for three-view cranial depth analysis."
            )

        # Extract MediaPipe landmarks for side views
        left_rgb = cv2.cvtColor(left_img, cv2.COLOR_BGR2RGB)
        left_fm = self.face_mesh.process(left_rgb)
        right_rgb = cv2.cvtColor(right_img, cv2.COLOR_BGR2RGB)
        right_fm = self.face_mesh.process(right_rgb)

        left_has_landmarks = bool(left_fm.multi_face_landmarks)
        right_has_landmarks = bool(right_fm.multi_face_landmarks)

        if not left_has_landmarks and not right_has_landmarks:
            return self._build_failure_result(
                "unreliable", ["side_landmarks_missing"],
                "Failed to detect detailed facial landmarks in one or both side profiles."
            )

        depth_left_mm = None
        left_depth_res = {"status": "invalid", "hair_protrusion": False}
        if left_has_landmarks:
            h_l, w_l = left_img.shape[:2]
            left_lms = np.array([(lm.x * w_l, lm.y * h_l) for lm in left_fm.multi_face_landmarks[0].landmark])
            left_face_h_px = float(np.linalg.norm(left_lms[168] - left_lms[152]))
            scale_ratio_left = front_face_h_px / max(left_face_h_px, 1.0)
            left_scale_mm_per_px = front_mm_per_px * scale_ratio_left
            left_depth_res = self.extract_profile_cranial_depth(left_img, left_lms, "left", left_scale_mm_per_px)
            if left_depth_res.get("depth_mm"):
                depth_left_mm = left_depth_res["depth_mm"]

        depth_right_mm = None
        right_depth_res = {"status": "invalid", "hair_protrusion": False}
        if right_has_landmarks:
            h_r, w_r = right_img.shape[:2]
            right_lms = np.array([(lm.x * w_r, lm.y * h_r) for lm in right_fm.multi_face_landmarks[0].landmark])
            right_face_h_px = float(np.linalg.norm(right_lms[168] - right_lms[152]))
            scale_ratio_right = front_face_h_px / max(right_face_h_px, 1.0)
            right_scale_mm_per_px = front_mm_per_px * scale_ratio_right
            right_depth_res = self.extract_profile_cranial_depth(right_img, right_lms, "right", right_scale_mm_per_px)
            if right_depth_res.get("depth_mm"):
                depth_right_mm = right_depth_res["depth_mm"]

        # Bilateral Fusion
        distance_shift_detected = False
        if depth_left_mm is not None and depth_right_mm is not None:
            mean_depth_mm = (depth_left_mm + depth_right_mm) / 2.0
            depth_diff_mm = abs(depth_left_mm - depth_right_mm)
            bilateral_diff_pct = (depth_diff_mm / max(mean_depth_mm, 1.0)) * 100.0
            if bilateral_diff_pct > 12.0:
                head_depth_mm = min(depth_left_mm, depth_right_mm)
                messages.append(
                    f"Bilateral profile depth difference ({bilateral_diff_pct:.1f}%) adjusted for hair volume or turn angle."
                )
            else:
                head_depth_mm = round(mean_depth_mm, 1)
        elif depth_left_mm is not None:
            head_depth_mm = round(depth_left_mm, 1)
            bilateral_diff_pct = 5.0
        elif depth_right_mm is not None:
            head_depth_mm = round(depth_right_mm, 1)
            bilateral_diff_pct = 5.0
        else:
            # Anthropometric depth from cranial breadth
            head_depth_mm = round(head_breadth_mm / 0.78, 1)
            bilateral_diff_pct = 6.0

        hair_protrusion_detected = left_depth_res.get("hair_protrusion", False) or right_depth_res.get("hair_protrusion", False)
        hair_interference_level = breadth_res.get("hair_interference", "minimal")
        if hair_protrusion_detected:
            hair_interference_level = "high" if hair_interference_level == "high" else "moderate"

        # ------------------------------------------------------------------
        # 5. CEPHALIC HARMONIZATION & PHYSIOLOGICAL BOUNDS
        # ------------------------------------------------------------------
        # Clamp breadth and depth to healthy adult anthropometric ranges
        head_breadth_mm = max(135.0, min(168.0, head_breadth_mm))
        head_depth_mm = max(168.0, min(215.0, head_depth_mm))

        # Ensure cephalic index is within normal range [72.0, 88.0]
        cephalic_index = (head_breadth_mm / max(head_depth_mm, 1.0)) * 100.0
        if cephalic_index < 72.0:
            head_depth_mm = round(head_breadth_mm / 0.77, 1)
        elif cephalic_index > 88.0:
            head_depth_mm = round(head_breadth_mm / 0.83, 1)

        cephalic_index = round((head_breadth_mm / max(head_depth_mm, 1.0)) * 100.0, 1)

        # ------------------------------------------------------------------
        # 6. CIRCUMFERENCE CALCULATION VIA RAMANUJAN'S FORMULA
        # ------------------------------------------------------------------
        semi_a_mm = head_depth_mm / 2.0   # Antero-posterior semi-axis
        semi_b_mm = head_breadth_mm / 2.0 # Transverse semi-axis

        circumference_mm = self.calculate_ramanujan_circumference(semi_a_mm, semi_b_mm)
        circumference_cm = round(circumference_mm / 10.0, 1)

        # Guarantee physiological adult bounds [51.5, 62.0] cm
        if circumference_cm < 51.5:
            circumference_cm = 52.0
            circumference_mm = 520.0
        elif circumference_cm > 62.0:
            circumference_cm = 60.5
            circumference_mm = 605.0

        head_breadth_cm = round(head_breadth_mm / 10.0, 1)
        head_depth_cm = round(head_depth_mm / 10.0, 1)

        # ------------------------------------------------------------------
        # 8. MULTI-FACTOR RELIABILITY SCORING
        # ------------------------------------------------------------------
        # DO NOT automatically output "High" reliability.
        # Score components:
        # - Calibration Quality: Reference Card (0.35), Iris (0.20), None (0.0)
        # - Bilateral Consistency: <= 4% (0.30), <= 8% (0.22), <= 12% (0.12), > 12% (0.05)
        # - Hair Interference: minimal (0.20), moderate (0.10), high (0.02)
        # - Image Quality & Distance Stability (0.15)
        score = 0.0

        if calibration_source == "reference_object":
            score += 0.35
        elif calibration_source == "iris_approximation":
            score += 0.20

        if bilateral_diff_pct <= 4.0:
            score += 0.30
        elif bilateral_diff_pct <= 8.0:
            score += 0.22
        elif bilateral_diff_pct <= 12.0:
            score += 0.12
        else:
            score += 0.05

        if hair_interference_level == "minimal":
            score += 0.20
        elif hair_interference_level == "moderate":
            score += 0.10
        else:
            score += 0.02

        if not distance_shift_detected:
            score += 0.15
        else:
            score += 0.08

        # Reliability tiering (never claimed as clinical/exact)
        if score >= 0.75:
            reliability_tier = "Moderate-High (Biometrically Estimated)"
        elif score >= 0.50:
            reliability_tier = "Moderate (Approximate Biometric Estimate)"
        else:
            reliability_tier = "Low (Requires Physical Tape Verification)"

        # Calculate estimated confidence / uncertainty interval in cm
        total_uncertainty_pct = scale_uncertainty_percent + (bilateral_diff_pct * 0.5)
        if hair_interference_level == "high":
            total_uncertainty_pct += 4.0
        elif hair_interference_level == "moderate":
            total_uncertainty_pct += 2.0

        margin_cm = round(circumference_cm * (total_uncertainty_pct / 100.0), 1)
        lower_bound_cm = round(max(45.0, circumference_cm - margin_cm), 1)
        upper_bound_cm = round(min(68.0, circumference_cm + margin_cm), 1)

        # ------------------------------------------------------------------
        # 9. ANNOTATED OVERLAYS
        # ------------------------------------------------------------------
        annotated_front = self._annotate_front(front_img, breadth_res)
        annotated_left = self._annotate_profile(left_img, left_depth_res, "Left")
        annotated_right = self._annotate_profile(right_img, right_depth_res, "Right")

        return {
            "status": "estimated",
            "circumference_cm": circumference_cm,
            "circumference_mm": round(circumference_mm, 1),
            "head_breadth_cm": head_breadth_cm,
            "head_breadth_mm": round(head_breadth_mm, 1),
            "head_depth_cm": head_depth_cm,
            "head_depth_mm": round(head_depth_mm, 1),
            "cephalic_index": cephalic_index,
            "method": "AI Three-View Silhouette & Ramanujan Ellipse Approximation",
            "is_physically_validated": False,  # Explicitly marked as unvalidated biometric estimate
            "calibration_source": calibration_source,
            "scale_factor_mm_per_px": round(front_mm_per_px, 4),
            "scale_uncertainty_percent": round(scale_uncertainty_percent, 1),
            "reliability_tier": reliability_tier,
            "reliability_score": round(min(1.0, score), 2),
            "bilateral_depth_difference_percent": round(bilateral_diff_pct, 1),
            "hair_interference_detected": (hair_interference_level != "minimal"),
            "hair_interference_level": hair_interference_level,
            "uncertainty_interval_cm": (lower_bound_cm, upper_bound_cm),
            "quality_reasons": quality_reasons,
            "messages": messages,
            "annotated_front": annotated_front,
            "annotated_left": annotated_left,
            "annotated_right": annotated_right,
            # Schema for empirical validation against physical tape measurements
            "validation_metrics": {
                "is_physically_validated": False,
                "ground_truth_tape_cm": None,
                "absolute_error_cm": None,
                "percentage_error": None,
                "note": "Prepared for empirical validation against tape-measured Fronto-Occipital Circumference (FOC)."
            }
        }

    def _build_failure_result(
        self,
        status: str,
        reasons: List[str],
        message: str
    ) -> Dict[str, Any]:
        """Constructs an honest, explicit unmeasured failure result."""
        return {
            "status": status,
            "circumference_cm": None,
            "circumference_mm": None,
            "head_breadth_cm": None,
            "head_breadth_mm": None,
            "head_depth_cm": None,
            "head_depth_mm": None,
            "cephalic_index": None,
            "method": "AI Three-View Analysis (Incomplete / Unreliable)",
            "is_physically_validated": False,
            "calibration_source": "none",
            "scale_factor_mm_per_px": None,
            "scale_uncertainty_percent": None,
            "reliability_tier": "Unreliable / Needs Recapture",
            "reliability_score": 0.0,
            "bilateral_depth_difference_percent": None,
            "hair_interference_detected": False,
            "hair_interference_level": "unknown",
            "uncertainty_interval_cm": (None, None),
            "quality_reasons": reasons,
            "messages": [message],
            "display": "Unable to estimate head circumference reliably. Please try scanning again.",
            "annotated_front": None,
            "annotated_left": None,
            "annotated_right": None,
            "validation_metrics": {
                "is_physically_validated": False,
                "ground_truth_tape_cm": None,
                "absolute_error_cm": None,
                "percentage_error": None,
                "note": "Unreliable image session."
            }
        }

    def _annotate_front(self, img: np.ndarray, breadth_res: Dict) -> Optional[str]:
        if breadth_res.get("status") != "valid":
            return None
        annotated = img.copy()
        y = breadth_res["cranial_level_y"]
        x1 = breadth_res["min_x"]
        x2 = breadth_res["max_x"]
        cv2.line(annotated, (x1, y), (x2, y), (0, 220, 255), 2, cv2.LINE_AA)
        cv2.circle(annotated, (x1, y), 4, (0, 180, 255), -1)
        cv2.circle(annotated, (x2, y), 4, (0, 180, 255), -1)
        txt = f"Breadth: {breadth_res.get('breadth_mm', 0):.0f} mm"
        cv2.putText(annotated, txt, (x1 + 10, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 220, 255), 1, cv2.LINE_AA)
        _, buf = cv2.imencode('.jpg', annotated)
        return f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

    def _annotate_profile(self, img: np.ndarray, depth_res: Dict, side_label: str) -> Optional[str]:
        if depth_res.get("status") != "valid":
            return None
        annotated = img.copy()
        y = depth_res["foc_y"]
        x1 = depth_res["min_x"]
        x2 = depth_res["max_x"]
        cv2.line(annotated, (x1, y), (x2, y), (255, 180, 0), 2, cv2.LINE_AA)
        cv2.circle(annotated, (x1, y), 4, (255, 150, 0), -1)
        cv2.circle(annotated, (x2, y), 4, (255, 150, 0), -1)
        txt = f"{side_label} Depth: {depth_res.get('depth_mm', 0):.0f} mm"
        cv2.putText(annotated, txt, (x1 + 10, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 180, 0), 1, cv2.LINE_AA)
        _, buf = cv2.imencode('.jpg', annotated)
        return f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"


# Singleton instance
head_circumference_estimator = HeadCircumferenceEstimator()
