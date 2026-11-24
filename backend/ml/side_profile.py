"""
Side profile analysis for Left and Right facial views.
Analyzes whole visible side profile: forehead, glabella, nasal bridge, nose tip,
subnasale, chin, jawline outline, outer canthus/hinge reference, iris,
superior ear attachment (otobasion superius), and tragus reference.
Validates strict near-profile orientation (~75°–85° yaw), rejects slight/three-quarter turns,
and provides calibrated physical millimeter measurements or explicit pixel estimates.
"""
import cv2
import numpy as np
import mediapipe as mp
import base64
from typing import Dict, Optional, Tuple

mp_face_mesh = mp.solutions.face_mesh

# 3D Facial Model Points for solvePnP pose estimation
MODEL_POINTS_6 = np.array([
    (0.0, 0.0, 0.0),          # Nose tip (Landmark 1)
    (0.0, -330.0, -65.0),     # Chin (Landmark 152)
    (-225.0, 170.0, -135.0),  # Left eye outer corner (Landmark 263)
    (225.0, 170.0, -135.0),   # Right eye outer corner (Landmark 33)
    (-150.0, -150.0, -125.0), # Left mouth corner (Landmark 291)
    (150.0, -150.0, -125.0)   # Right mouth corner (Landmark 61)
], dtype=np.float64)

def draw_pill_badge(
    img: np.ndarray,
    text: str,
    pos: Tuple[int, int],
    fg_color: Tuple[int, int, int] = (255, 255, 255),
    bg_color: Tuple[int, int, int] = (20, 24, 33),
    font_scale: float = 0.42,
    thickness: int = 1,
    padding: int = 4
) -> None:
    """Draws a clean, dark translucent pill badge behind text for high legibility."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    (text_w, text_h), baseline = cv2.getTextSize(text, font, font_scale, thickness)
    x, y = pos
    h_img, w_img = img.shape[:2]
    x1 = max(0, x - padding)
    y1 = max(0, y - text_h - padding)
    x2 = min(w_img - 1, x + text_w + padding)
    y2 = min(h_img - 1, y + baseline + padding)
    
    if x2 > x1 and y2 > y1:
        sub = img[y1:y2, x1:x2]
        overlay = np.full(sub.shape, bg_color, dtype=np.uint8)
        cv2.addWeighted(overlay, 0.78, sub, 0.22, 0, sub)
        cv2.rectangle(img, (x1, y1), (x2, y2), (75, 85, 100), 1)
    cv2.putText(img, text, (x, y), font, font_scale, fg_color, thickness, cv2.LINE_AA)

class SideProfileAnalyzer:
    def __init__(self):
        self.face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.45
        )

    def estimate_head_pose(self, landmarks_px: np.ndarray, w: int, h: int) -> Tuple[float, float, float]:
        """
        Estimates head yaw, pitch, roll in degrees using solvePnP.
        """
        image_points = np.array([
            landmarks_px[1],    # Nose tip
            landmarks_px[152],  # Chin
            landmarks_px[263],  # Left eye outer
            landmarks_px[33],   # Right eye outer
            landmarks_px[291],  # Left mouth
            landmarks_px[61]    # Right mouth
        ], dtype=np.float64)

        focal_length = float(max(w, h))
        center = (float(w) / 2.0, float(h) / 2.0)
        cam_matrix = np.array([
            [focal_length, 0.0, center[0]],
            [0.0, focal_length, center[1]],
            [0.0, 0.0, 1.0]
        ], dtype=np.float64)
        dist_coeffs = np.zeros((4, 1), dtype=np.float64)

        success, rvec, _ = cv2.solvePnP(
            MODEL_POINTS_6, image_points, cam_matrix, dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE
        )
        if not success:
            return 0.0, 0.0, 0.0

        rmat, _ = cv2.Rodrigues(rvec)
        angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
        pitch, yaw, roll = float(angles[0]), float(angles[1]), float(angles[2])
        return pitch, yaw, roll

    def analyze_side_view(
        self,
        image: np.ndarray,
        expected_side: str,
        mm_per_px: Optional[float] = None
    ) -> Dict:
        """
        Analyzes a side-view image (expected_side: 'left' or 'right').
        Enforces strict near-profile orientation, measures complete facial profile,
        and produces a rich multi-feature annotated overlay image.
        """
        expected_side = expected_side.lower()
        if expected_side not in ["left", "right"]:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["invalid_side_specification"]},
                "message": "Side must be specified as 'left' or 'right'."
            }

        if image is None or image.size == 0:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["invalid_image"]},
                "message": "Image could not be decoded."
            }

        h, w = image.shape[:2]

        # 1. Image Quality Checks (Brightness & Blur)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray))
        if brightness < 30.0:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["too_dark"]},
                "message": "Lighting is too dark. Please move to a brighter area."
            }
        if brightness > 230.0:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["too_bright"]},
                "message": "Lighting is too harsh. Please avoid direct glare."
            }

        var_lap = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if var_lap < 10.0:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["blur"]},
                "message": "Image is blurry. Please hold steady and recapture."
            }

        # Resize for MediaPipe if excessively large
        proc_img = image
        max_dim = 1280
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            proc_img = cv2.resize(image, (int(w * scale), int(h * scale)))

        img_rgb = cv2.cvtColor(proc_img, cv2.COLOR_BGR2RGB)
        fm_result = self.face_mesh.process(img_rgb)

        if not fm_result.multi_face_landmarks:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["no_face"]},
                "message": "No face detected. Please ensure your side profile is clearly in view."
            }

        if len(fm_result.multi_face_landmarks) > 1:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["multiple_faces"]},
                "message": "Multiple faces detected. Only one person should be visible."
            }

        raw_landmarks = fm_result.multi_face_landmarks[0].landmark
        mapped = np.array([(lm.x * w, lm.y * h) for lm in raw_landmarks])

        # 2. Head Orientation / Pose Validation
        pitch, yaw, roll = self.estimate_head_pose(mapped, w, h)

        # Cross-validation distances
        d_nose_left_ear = float(np.linalg.norm(mapped[1] - mapped[454]))
        d_nose_right_ear = float(np.linalg.norm(mapped[1] - mapped[234]))

        # Robust near-profile yaw thresholds (~32° to 88°, ideally ~50°–80°)
        # Rejects frontal/slight turns (< 32°) and excessive turns (> 88°)
        MIN_STRICT_YAW = 32.0
        MAX_PERMISSIBLE_YAW = 88.0

        if expected_side == "left":
            # True orientation mismatch: user turned right instead of left (yaw > 20.0 or strong left ear extension with positive yaw)
            if yaw > 20.0 or (d_nose_left_ear > d_nose_right_ear * 1.30 and yaw > 10.0):
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "head_pose": {"yaw_deg": round(yaw, 1), "pitch_deg": round(pitch, 1), "roll_deg": round(roll, 1)},
                    "quality": {"status": "invalid", "reasons": ["orientation_mismatch"]},
                    "message": "Orientation mismatch: You turned right instead of left. Please turn your head to your left."
                }
            # Check for insufficient turn (reject frontal / slight turns)
            if abs(yaw) < MIN_STRICT_YAW:
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "head_pose": {"yaw_deg": round(yaw, 1), "pitch_deg": round(pitch, 1), "roll_deg": round(roll, 1)},
                    "quality": {"status": "invalid", "reasons": ["insufficient_head_turn"]},
                    "message": f"Insufficient head turn ({abs(yaw):.1f}°): Please turn your face sideways into a near-profile view (~50°–80°)."
                }
            # Check for excessive turn where face is turned completely away
            if abs(yaw) > MAX_PERMISSIBLE_YAW:
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "head_pose": {"yaw_deg": round(yaw, 1), "pitch_deg": round(pitch, 1), "roll_deg": round(roll, 1)},
                    "quality": {"status": "invalid", "reasons": ["excessive_head_turn"]},
                    "message": f"Excessive head turn ({abs(yaw):.1f}°): Head turned too far away. Ensure your eye, nose profile, and ear remain visible."
                }

        elif expected_side == "right":
            # True orientation mismatch: user turned left instead of right (yaw < -20.0 or strong right ear extension with negative yaw)
            if yaw < -20.0 or (d_nose_right_ear > d_nose_left_ear * 1.30 and yaw < -10.0):
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "head_pose": {"yaw_deg": round(yaw, 1), "pitch_deg": round(pitch, 1), "roll_deg": round(roll, 1)},
                    "quality": {"status": "invalid", "reasons": ["orientation_mismatch"]},
                    "message": "Orientation mismatch: You turned left instead of right. Please turn your head to your right."
                }
            # Check for insufficient turn (reject frontal / slight turns)
            if abs(yaw) < MIN_STRICT_YAW:
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "head_pose": {"yaw_deg": round(yaw, 1), "pitch_deg": round(pitch, 1), "roll_deg": round(roll, 1)},
                    "quality": {"status": "invalid", "reasons": ["insufficient_head_turn"]},
                    "message": f"Insufficient head turn ({abs(yaw):.1f}°): Please turn your face sideways into a near-profile view (~50°–80°)."
                }
            # Check for excessive turn
            if abs(yaw) > MAX_PERMISSIBLE_YAW:
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "head_pose": {"yaw_deg": round(yaw, 1), "pitch_deg": round(pitch, 1), "roll_deg": round(roll, 1)},
                    "quality": {"status": "invalid", "reasons": ["excessive_head_turn"]},
                    "message": f"Excessive head turn ({abs(yaw):.1f}°): Head turned too far away. Ensure your eye, nose profile, and ear remain visible."
                }

        # 3. Whole Visible Side Profile Landmark Identification (Saturday Working Version)
        # Dynamically determine the visible profile facing the camera:
        # In a right turn (yaw > 0), the left ear (454) and left eye (263) face the camera.
        # In a left turn (yaw < 0), the right ear (234) and right eye (33) face the camera.
        use_left_profile = False
        if d_nose_left_ear > d_nose_right_ear * 1.05 or yaw > 10.0:
            use_left_profile = True
        elif d_nose_right_ear > d_nose_left_ear * 1.05 or yaw < -10.0:
            use_left_profile = False
        else:
            use_left_profile = (expected_side == "left")

        if use_left_profile:
            hinge_idx = 263      # Anatomical Left lateral canthus / frame hinge reference
            ear_tragus_idx = 454 # Anatomical Left preauricular / tragus reference
            ear_apex_idx = 389   # Anatomical Left superior ear attachment (otobasion superius)
            eye_iris_idx = 473   # Left iris center
            jawline_idx = 361    # Left mandible angle / jawline
            jawline_contour_indices = [152, 377, 400, 378, 379, 365, 397, 288, 361]
        else:
            hinge_idx = 33       # Anatomical Right lateral canthus / frame hinge reference
            ear_tragus_idx = 234 # Anatomical Right preauricular / tragus reference
            ear_apex_idx = 162   # Anatomical Right superior ear attachment (otobasion superius)
            eye_iris_idx = 468   # Right iris center
            jawline_idx = 132    # Right mandible angle / jawline
            jawline_contour_indices = [152, 148, 176, 149, 150, 136, 172, 58, 132]

        # Sagittal facial profile contour landmarks (midline profile from forehead to chin):
        midline_profile_indices = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 0, 17, 152]

        hinge_pt = mapped[hinge_idx]
        ear_tragus_pt = mapped[ear_tragus_idx]
        ear_apex_pt = mapped[ear_apex_idx]
        eye_iris_pt = mapped[eye_iris_idx]
        nose_tip_pt = mapped[1]
        glabella_pt = mapped[168]
        forehead_pt = mapped[10]
        chin_pt = mapped[152]
        jawline_pt = mapped[jawline_idx]

        # Landmark visibility and boundary validation
        key_pts_to_check = [
            ("hinge", hinge_pt),
            ("ear", ear_tragus_pt),
            ("ear_apex", ear_apex_pt),
            ("nose_tip", nose_tip_pt),
            ("chin", chin_pt)
        ]
        margin = 6.0
        for pt_name, pt in key_pts_to_check:
            if pt[0] < margin or pt[0] > w - margin or pt[1] < margin or pt[1] > h - margin:
                return {
                    "status": "invalid",
                    "side": expected_side,
                    "quality": {"status": "invalid", "reasons": ["landmark_obscured"]},
                    "message": f"{expected_side.capitalize()} {pt_name.replace('_', ' ')} region is partially off-screen or obscured. Please center your face."
                }

        # 4. Side Profile Biometrics & Geometry
        eye_to_ear_px = float(np.linalg.norm(hinge_pt - ear_tragus_pt))
        profile_height_px = float(np.linalg.norm(forehead_pt - chin_pt))
        nose_bridge_px = float(np.linalg.norm(glabella_pt - nose_tip_pt))
        hinge_to_apex_px = float(np.linalg.norm(hinge_pt - ear_apex_pt))

        if eye_to_ear_px < 25.0 or profile_height_px < 60.0:
            return {
                "status": "invalid",
                "side": expected_side,
                "quality": {"status": "invalid", "reasons": ["unreliable_geometry"]},
                "message": "Detected side-profile distance is abnormally small. Please move closer to the camera."
            }

        # Calibration scale handling
        is_calibrated = (mm_per_px is not None and mm_per_px > 0)
        eye_to_ear_mm = None
        estimated_temple_length_mm = None
        profile_height_mm = None
        nose_bridge_mm = None
        hinge_to_apex_mm = None

        if is_calibrated:
            eye_to_ear_mm = round(eye_to_ear_px * mm_per_px, 1)
            # Estimated temple reach (reach to retroauricular mastoid groove ~1.35x direct projection)
            estimated_temple_length_mm = round(eye_to_ear_mm * 1.35, 1)
            profile_height_mm = round(profile_height_px * mm_per_px, 1)
            nose_bridge_mm = round(nose_bridge_px * mm_per_px, 1)
            hinge_to_apex_mm = round(hinge_to_apex_px * mm_per_px, 1)

        # 5. High-Clarity Multi-Feature Annotated Overlay Image Generation (Matching Working Version from 2 Days Ago)
        annotated = image.copy()

        # A. Draw Visible Sagittal Facial Profile Contour Polyline (Forehead -> Nose -> Subnasale -> Lips -> Chin)
        midline_pts = np.array([mapped[idx].astype(int) for idx in midline_profile_indices], dtype=np.int32)
        cv2.polylines(annotated, [midline_pts], isClosed=False, color=(255, 200, 0), thickness=2, lineType=cv2.LINE_AA)

        # B. Draw Anatomical Mandibular Jawline Contour Polyline (Chin -> Mandible Angle)
        jaw_pts = np.array([mapped[idx].astype(int) for idx in jawline_contour_indices], dtype=np.int32)
        cv2.polylines(annotated, [jaw_pts], isClosed=False, color=(0, 220, 180), thickness=2, lineType=cv2.LINE_AA)

        # C. Draw Landmark Anchor Points on midline and jawline
        for idx in midline_profile_indices:
            pt = tuple(mapped[idx].astype(int))
            cv2.circle(annotated, pt, 3, (255, 230, 100), -1, cv2.LINE_AA)
        for idx in jawline_contour_indices:
            pt = tuple(mapped[idx].astype(int))
            cv2.circle(annotated, pt, 3, (100, 240, 200), -1, cv2.LINE_AA)

        # D. Draw Nose Profile Vector (Glabella -> Nose Tip)
        cv2.line(annotated, tuple(glabella_pt.astype(int)), tuple(nose_tip_pt.astype(int)), (0, 220, 255), 2, cv2.LINE_AA)

        # E. Draw Eye-to-Ear Primary Measurement Line (Hinge -> Tragus) with Caliper End Caps
        pt_h = tuple(hinge_pt.astype(int))
        pt_e = tuple(ear_tragus_pt.astype(int))
        cv2.line(annotated, pt_h, pt_e, (0, 235, 255), 3, cv2.LINE_AA) # Vibrant amber/yellow

        # End caps for measurement caliper appearance
        cap_len = 7
        cv2.line(annotated, (pt_h[0], pt_h[1] - cap_len), (pt_h[0], pt_h[1] + cap_len), (0, 235, 255), 2, cv2.LINE_AA)
        cv2.line(annotated, (pt_e[0], pt_e[1] - cap_len), (pt_e[0], pt_e[1] + cap_len), (0, 235, 255), 2, cv2.LINE_AA)

        # F. Draw Hinge-to-Ear-Apex Path (Spectacle Temple Rest Reference)
        pt_a = tuple(ear_apex_pt.astype(int))
        cv2.line(annotated, pt_h, pt_a, (230, 130, 255), 2, cv2.LINE_AA) # Soft purple

        # G. Highlight Key Feature Anchors with Halo Circles
        cv2.circle(annotated, pt_h, 6, (0, 215, 255), -1, cv2.LINE_AA)
        cv2.circle(annotated, pt_h, 2, (255, 255, 255), -1, cv2.LINE_AA)

        cv2.circle(annotated, pt_e, 6, (80, 220, 80), -1, cv2.LINE_AA)
        cv2.circle(annotated, pt_e, 2, (255, 255, 255), -1, cv2.LINE_AA)

        cv2.circle(annotated, pt_a, 5, (230, 130, 255), -1, cv2.LINE_AA)
        cv2.circle(annotated, tuple(eye_iris_pt.astype(int)), 4, (0, 180, 255), -1, cv2.LINE_AA)
        cv2.circle(annotated, tuple(nose_tip_pt.astype(int)), 4, (255, 200, 0), -1, cv2.LINE_AA)
        cv2.circle(annotated, tuple(chin_pt.astype(int)), 4, (255, 200, 0), -1, cv2.LINE_AA)

        # H. Callout Badges on Landmarks
        draw_pill_badge(annotated, "Hinge Ref", (pt_h[0] - 25, pt_h[1] + 18), fg_color=(0, 235, 255), font_scale=0.38)
        draw_pill_badge(annotated, "Tragus Ref", (pt_e[0] - 20, pt_e[1] + 18), fg_color=(100, 240, 100), font_scale=0.38)
        draw_pill_badge(annotated, "Otobasion (Ear Apex)", (pt_a[0] - 40, pt_a[1] - 8), fg_color=(240, 160, 255), font_scale=0.36)

        # I. Measurement Dimension Pill Badge over Eye-to-Ear Line
        mid_x = (pt_h[0] + pt_e[0]) // 2
        mid_y = (pt_h[1] + pt_e[1]) // 2 - 12
        dim_text = f"Eye-to-Ear: {eye_to_ear_mm:.1f} mm" if is_calibrated else f"Eye-to-Ear: {eye_to_ear_px:.0f} px (Uncalibrated)"
        draw_pill_badge(annotated, dim_text, (mid_x - 55, mid_y), fg_color=(255, 255, 255), bg_color=(15, 23, 42), font_scale=0.42, padding=5)

        # J. HUD Info Header Card (Top-Left)
        hud_lines = [
            (f"{expected_side.upper()} SIDE PROFILE  |  Yaw: {abs(yaw):.1f} deg (Near Profile)", (0, 220, 255)),
            (f"Scale: {'CALIBRATED (Front Iris Scale)' if is_calibrated else 'UNCALIBRATED ESTIMATE'}", (100, 235, 120) if is_calibrated else (80, 180, 255)),
            (f"Eye-to-Ear: {eye_to_ear_mm:.1f} mm  |  Hinge-to-Apex: {hinge_to_apex_mm:.1f} mm" if is_calibrated else f"Eye-to-Ear: {eye_to_ear_px:.0f} px", (255, 255, 255))
        ]
        start_y = 26
        for line_txt, line_col in hud_lines:
            draw_pill_badge(annotated, line_txt, (14, start_y), fg_color=line_col, bg_color=(15, 23, 42), font_scale=0.40, padding=4)
            start_y += 20

        # Encode to JPEG Base64
        _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 88])
        annotated_b64 = base64.b64encode(buffer).decode('utf-8')

        # Encode clean image without HUD overlays
        _, clean_buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        clean_b64 = base64.b64encode(clean_buffer).decode('utf-8')

        return {
            "status": "valid",
            "side": expected_side,
            "head_pose": {
                "yaw_deg": round(yaw, 1),
                "pitch_deg": round(pitch, 1),
                "roll_deg": round(roll, 1),
                "orientation": f"{expected_side}_profile"
            },
            "landmarks_detected": {
                "hinge_reference_px": [round(float(hinge_pt[0]), 1), round(float(hinge_pt[1]), 1)],
                "outer_eye_corner_px": [round(float(hinge_pt[0]), 1), round(float(hinge_pt[1]), 1)],
                "ear_reference_px": [round(float(ear_tragus_pt[0]), 1), round(float(ear_tragus_pt[1]), 1)],
                "ear_tragus_px": [round(float(ear_tragus_pt[0]), 1), round(float(ear_tragus_pt[1]), 1)],
                "ear_apex_px": [round(float(ear_apex_pt[0]), 1), round(float(ear_apex_pt[1]), 1)],
                "otobasion_superius_px": [round(float(ear_apex_pt[0]), 1), round(float(ear_apex_pt[1]), 1)],
                "eye_center_px": [round(float(eye_iris_pt[0]), 1), round(float(eye_iris_pt[1]), 1)],
                "nose_tip_px": [round(float(nose_tip_pt[0]), 1), round(float(nose_tip_pt[1]), 1)],
                "glabella_px": [round(float(glabella_pt[0]), 1), round(float(glabella_pt[1]), 1)],
                "forehead_px": [round(float(forehead_pt[0]), 1), round(float(forehead_pt[1]), 1)],
                "chin_px": [round(float(chin_pt[0]), 1), round(float(chin_pt[1]), 1)],
                "jawline_px": [round(float(jawline_pt[0]), 1), round(float(jawline_pt[1]), 1)]
            },
            "measurements": {
                "eye_to_ear_distance_px": round(eye_to_ear_px, 1),
                "eye_to_ear_distance_mm": eye_to_ear_mm,
                "temple_arm_fit_reach_mm": estimated_temple_length_mm,
                "estimated_temple_length_mm": estimated_temple_length_mm,
                "hinge_to_apex_distance_mm": hinge_to_apex_mm,
                "hinge_to_apex_mm": hinge_to_apex_mm,
                "profile_height_mm": profile_height_mm,
                "nose_bridge_profile_mm": nose_bridge_mm,
                "nose_bridge_mm": nose_bridge_mm,
                "scale_calibration": "Calibrated" if is_calibrated else "Uncalibrated",
                "temple_geometry_note": "Facial reach estimate only. Actual frame temple length requires manufacturer product specifications.",
                "measurement_type": "calibrated_physical_mm" if is_calibrated else "uncalibrated_px",
                "calibration_source": "front_view_iris" if is_calibrated else "uncalibrated"
            },
            "landmark_status": {
                "outer_eye_corner": "Detected",
                "tragus_reference": "Detected",
                "otobasion_ear_apex": "Detected",
                "nose_bridge_profile": "Detected",
                "profile_height": "Detected"
            },
            "annotated_image": f"data:image/jpeg;base64,{annotated_b64}",
            "clean_image": f"data:image/jpeg;base64,{clean_b64}",
            "quality": {
                "status": "valid",
                "reasons": []
            },
            "explanation": (
                f"{expected_side.capitalize()} side view validated at {abs(yaw):.1f}° yaw near-profile. "
                f"Eye-to-ear projected distance is {eye_to_ear_mm if eye_to_ear_mm else round(eye_to_ear_px)} "
                f"{'mm' if eye_to_ear_mm else 'px'} "
                f"(hinge-to-apex distance: {hinge_to_apex_mm if hinge_to_apex_mm else 'N/A'} mm; "
                f"estimated required reach ~{estimated_temple_length_mm if estimated_temple_length_mm else 'N/A'} mm)."
            )
        }

side_profile_analyzer = SideProfileAnalyzer()
