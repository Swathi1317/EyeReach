import os
import cv2
import math
import joblib
import numpy as np
import pandas as pd
import tempfile
import logging
from typing import List, Dict, Any, Optional, Tuple

from backend.ml.build_features import FaceFeatureExtractor, FEATURE_NAMES
from backend.ml.face_utils import shared_face_analyzer, get_capture_guidance_message

logger = logging.getLogger(__name__)

class AnthropometricFaceShapeScorer:
    """
    Computes anthropometric prior compatibility for the 5 standardized face shapes:
    Heart, Oblong, Oval, Round, Square.
    
    Based on Farkas Craniofacial Anthropometry & Clinical Eyewear Fitting Standards:
    - Oblong: Significant vertical elongation (L/W >= 1.25).
    - Square: Short vertical axis (L/W <= 1.20) with wide jaw (Jaw/Cheek >= 0.94) and angular jaw corners.
    - Round: Short vertical axis (L/W <= 1.18) with softly curved jaw (Jaw/Cheek < 0.94, jaw angle > 140 deg, wide chin).
    - Heart: Inverted triangle: wide forehead/cheekbone tapering down to a narrow pointed chin (chin angle <= 87 deg, high taper).
    - Oval: Balanced classical proportions (1.17 <= L/W <= 1.26), softly tapered jaw, harmonious chin.
    """
    CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]

    @classmethod
    def compute_scores(cls, features: Dict[str, float]) -> Dict[str, float]:
        lw = features.get("face_length_to_cheekbone_width", 1.19)
        jw = features.get("jaw_width_to_cheekbone_width", 0.94)
        fw = features.get("forehead_width_to_cheekbone_width", 0.86)
        jw_fw = features.get("jaw_width_to_forehead_width", 1.08)
        chin_w = features.get("chin_width_to_jaw_width", 0.43)
        jaw_ang = features.get("avg_jaw_angle", 142.0)
        chin_ang = features.get("chin_angle", 88.0)
        taper = features.get("cheekbone_to_jaw_taper", 0.055)
        curvature = features.get("contour_curvature", 0.088)

        scores = {c: 1.0 for c in cls.CLASSES}

        # 1. Aspect Ratio (Face Length to Cheekbone Width)
        if lw >= 1.26:
            scores["Oblong"] *= 2.4
            scores["Round"] *= 0.2
            scores["Square"] *= 0.3
            scores["Oval"] *= 0.8
        elif lw >= 1.23:
            scores["Oblong"] *= 1.8
            scores["Round"] *= 0.4
            scores["Square"] *= 0.5
            scores["Oval"] *= 1.1
        elif lw <= 1.14:
            scores["Round"] *= 1.8
            scores["Square"] *= 1.6
            scores["Oblong"] *= 0.15
            scores["Oval"] *= 0.6
        elif lw <= 1.17:
            scores["Round"] *= 1.4
            scores["Square"] *= 1.3
            scores["Oblong"] *= 0.35
            scores["Oval"] *= 0.9
        else: # 1.17 < lw < 1.23
            scores["Oval"] *= 1.5
            scores["Heart"] *= 1.2
            scores["Oblong"] *= 0.7

        # 2. Jaw Width to Cheekbone Width & Jaw Angularity
        if jw >= 0.95:
            scores["Square"] *= 1.6
            scores["Round"] *= 0.8
            scores["Heart"] *= 0.5
        elif jw <= 0.925:
            scores["Square"] *= 0.6
            scores["Heart"] *= 1.4
            scores["Oval"] *= 1.2

        if jaw_ang >= 142.0:
            scores["Round"] *= 1.35
            scores["Oval"] *= 1.15
            scores["Square"] *= 0.75
        elif jaw_ang <= 139.0:
            scores["Square"] *= 1.4
            scores["Round"] *= 0.7

        # 3. Chin Angularity and Taper (Heart vs Others)
        if chin_ang <= 86.0:
            scores["Heart"] *= 1.9
            scores["Round"] *= 0.4
            scores["Square"] *= 0.45
            scores["Oval"] *= 1.05
        elif chin_ang <= 88.0:
            scores["Heart"] *= 1.4
            scores["Round"] *= 0.7
            scores["Square"] *= 0.75
        elif chin_ang >= 91.0:
            scores["Round"] *= 1.3
            scores["Square"] *= 1.25
            scores["Heart"] *= 0.5

        if taper >= 0.058:
            scores["Heart"] *= 1.4
            scores["Oval"] *= 1.1
            scores["Square"] *= 0.65
        elif taper <= 0.045:
            scores["Square"] *= 1.3
            scores["Heart"] *= 0.6

        # 4. Oval Harmonic Harmony
        if 1.17 <= lw <= 1.25 and 86.0 <= chin_ang <= 91.0 and 0.91 <= jw <= 0.95:
            scores["Oval"] *= 1.5

        # Normalize to probability distribution
        total = sum(scores.values()) + 1e-9
        return {c: scores[c] / total for c in cls.CLASSES}


class FaceShapeClassifier:
    """
    Production-grade stabilized Face Shape Classifier combining:
    1. Pre-trained supervised ML pipeline (XGBoost / PowerSVC)
    2. Multi-frame quality extraction and temporal MAD feature stabilization
    3. Anthropometric geometric priors (Farkas craniofacial standard)
    4. Boundary case disambiguation and transparency
    """
    CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]

    def __init__(self, model_path: Optional[str] = None):
        if model_path is None:
            model_path = os.path.join(os.path.dirname(__file__), "models", "face_shape_model.joblib")
        self.model_path = model_path
        self._model_artifact = None
        self._extractor = None

    @property
    def model_artifact(self):
        if self._model_artifact is None:
            self._model_artifact = joblib.load(self.model_path)
        return self._model_artifact

    @property
    def extractor(self):
        if self._extractor is None:
            self._extractor = FaceFeatureExtractor()
        return self._extractor

    def extract_features_from_image(self, img_bgr: np.ndarray) -> Optional[Dict[str, float]]:
        """Extract facial landmark features from a BGR image array."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            cv2.imwrite(tmp.name, img_bgr)
            tmp_path = tmp.name
        try:
            return self.extractor.process_image(tmp_path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def calculate_pose_weight(self, face_data: Dict[str, Any]) -> float:
        """
        Calculates a confidence weight (0.1 to 1.0) for a frame based on frontal pose quality.
        Frames closer to pure frontal orientation (low yaw, neutral pitch, low roll) receive higher weights.
        """
        landmarks = face_data.get("landmarks")
        if landmarks is None or len(landmarks) < 454:
            return 0.5
        
        w = face_data.get("width", 640)
        h = face_data.get("height", 480)
        
        nose = landmarks[1]
        right_eye = landmarks[33]
        left_eye = landmarks[263]
        chin = landmarks[152]
        
        # Yaw weight (eye-to-nose symmetry)
        dL = math.hypot(nose[0] - left_eye[0], nose[1] - left_eye[1])
        dR = math.hypot(nose[0] - right_eye[0], nose[1] - right_eye[1])
        yaw_err = abs(dL - dR) / (dL + dR + 1e-6)
        yaw_weight = max(0.2, 1.0 - (yaw_err / 0.14))

        # Roll weight (eye tilt)
        dy = left_eye[1] - right_eye[1]
        dx = left_eye[0] - right_eye[0]
        roll_deg = abs(math.degrees(math.atan2(dy, dx)))
        roll_weight = max(0.2, 1.0 - (roll_deg / 8.0))

        # Pitch weight (eye-nose vs nose-chin ratio; nominal ~ 0.72)
        eye_y = (left_eye[1] + right_eye[1]) / 2.0
        dist_en = max(1.0, nose[1] - eye_y)
        dist_nc = max(1.0, chin[1] - nose[1])
        pitch_ratio = dist_en / dist_nc
        pitch_weight = max(0.2, 1.0 - (abs(pitch_ratio - 0.72) / 0.25))

        return float(np.clip(yaw_weight * roll_weight * pitch_weight, 0.1, 1.0))

    def stabilize_features_mad(
        self,
        features_list: List[Dict[str, float]],
        weights_list: Optional[List[float]] = None
    ) -> Dict[str, float]:
        """
        Performs Median Absolute Deviation (MAD) outlier pruning and quality-weighted
        averaging across multiple frames to eliminate single-frame temporal jitter.
        """
        if not features_list:
            return {}
        if len(features_list) == 1:
            return features_list[0]

        df = pd.DataFrame(features_list)[FEATURE_NAMES]
        if weights_list is None or len(weights_list) != len(features_list):
            weights_arr = np.ones(len(features_list), dtype=float)
        else:
            weights_arr = np.array(weights_list, dtype=float)
            if np.sum(weights_arr) <= 0:
                weights_arr = np.ones(len(features_list), dtype=float)

        stabilized = {}
        for col in FEATURE_NAMES:
            series = df[col].values
            med = float(np.median(series))
            dev = np.abs(series - med)
            mad = float(np.median(dev))
            # 2.5 * MAD threshold for outlier rejection
            thresh = max(mad * 2.5, 1e-4)
            inliers = dev <= thresh
            
            if np.any(inliers):
                w_inliers = weights_arr[inliers]
                val_inliers = series[inliers]
                if np.sum(w_inliers) > 0:
                    stabilized[col] = float(np.average(val_inliers, weights=w_inliers))
                else:
                    stabilized[col] = float(np.mean(val_inliers))
            else:
                stabilized[col] = med

        return stabilized

    def predict_hybrid(
        self,
        features: Dict[str, float],
        frame_ml_probs_list: Optional[List[np.ndarray]] = None,
        frames_evaluated: int = 1
    ) -> Dict[str, Any]:
        """
        Combines ML probabilities with anthropometric geometric priors,
        resolves boundary cases, and provides stability and explanation metrics.
        """
        mod = self.model_artifact
        pipeline = mod["pipeline"]
        le = mod["label_encoder"]
        feature_cols = mod["feature_cols"]
        classes = list(le.classes_)

        # 1. Direct ML prediction on stabilized features
        df_feat = pd.DataFrame([features])[feature_cols]
        p_ml_stab = pipeline.predict_proba(df_feat.values)[0]

        # 2. Frame-level soft-voting average (if multi-frame)
        if frame_ml_probs_list and len(frame_ml_probs_list) > 1:
            p_soft_vote = np.mean(frame_ml_probs_list, axis=0)
            p_ml = 0.65 * p_ml_stab + 0.35 * p_soft_vote
        else:
            p_ml = p_ml_stab

        # 3. Anthropometric geometric prior
        g_scores = AnthropometricFaceShapeScorer.compute_scores(features)
        g_vec = np.array([g_scores[c] for c in classes], dtype=float)

        # 4. Hybrid combination: 70% ML probability + 30% Geometric prior
        # Ensures statistical model drives classification while geometric constraints prevent unphysical shapes
        p_hybrid = (0.70 * p_ml) + (0.30 * g_vec)
        p_hybrid = p_hybrid / np.sum(p_hybrid)

        # Map to class probabilities
        prob_dict = {classes[i]: float(p_hybrid[i]) for i in range(len(classes))}
        sorted_preds = sorted(prob_dict.items(), key=lambda x: x[1], reverse=True)

        top1_shape, top1_prob = sorted_preds[0]
        top2_shape, top2_prob = sorted_preds[1]

        # 5. Boundary Disambiguation
        is_boundary = False
        secondary_shape = None
        prob_diff = top1_prob - top2_prob

        # If top predictions are closely contested (margin < 0.08 or confidence < 0.42)
        if prob_diff < 0.08 or top1_prob < 0.40:
            is_boundary = True
            secondary_shape = top2_shape
            
            # Apply clinical tie-breaking criteria based on physical landmarks
            lw = features.get("face_length_to_cheekbone_width", 1.19)
            jw = features.get("jaw_width_to_cheekbone_width", 0.94)
            jaw_ang = features.get("avg_jaw_angle", 142.0)
            chin_ang = features.get("chin_angle", 88.0)
            taper = features.get("cheekbone_to_jaw_taper", 0.055)

            pair = {top1_shape, top2_shape}

            # Boundary 1: Round vs Square (both short L/W; separated by jaw angularity & jaw width)
            if pair == {"Round", "Square"}:
                if jw >= 0.948 and jaw_ang <= 140.5:
                    top1_shape, top2_shape = "Square", "Round"
                elif jaw_ang >= 141.0 and jw < 0.945:
                    top1_shape, top2_shape = "Round", "Square"

            # Boundary 2: Oval vs Round (Oval is longer, Round has wider chin angle & softer jaw)
            elif pair == {"Oval", "Round"}:
                if lw >= 1.185:
                    top1_shape, top2_shape = "Oval", "Round"
                elif lw <= 1.155 and chin_ang >= 90.0:
                    top1_shape, top2_shape = "Round", "Oval"

            # Boundary 3: Oval vs Heart (Heart has sharp chin angle <= 86.5 and high taper >= 0.056)
            elif pair == {"Oval", "Heart"}:
                if chin_ang <= 86.5 and taper >= 0.056:
                    top1_shape, top2_shape = "Heart", "Oval"
                elif chin_ang >= 88.0 or taper < 0.052:
                    top1_shape, top2_shape = "Oval", "Heart"

            # Boundary 4: Oblong vs Oval (Oblong has high vertical length >= 1.25)
            elif pair == {"Oblong", "Oval"}:
                if lw >= 1.245:
                    top1_shape, top2_shape = "Oblong", "Oval"
                elif lw <= 1.22:
                    top1_shape, top2_shape = "Oval", "Oblong"

            # Re-rank sorted_preds if tie-breaker adjusted the leader
            if top1_shape != sorted_preds[0][0]:
                new_dict = dict(prob_dict)
                # Boost leader slightly above runner-up to reflect resolution
                boost = 0.02
                new_dict[top1_shape] = max(new_dict[top1_shape], new_dict[top2_shape] + boost)
                tot = sum(new_dict.values())
                sorted_preds = sorted([(k, v/tot) for k, v in new_dict.items()], key=lambda x: x[1], reverse=True)
                top1_shape, top1_prob = sorted_preds[0]

        # 6. Stability Assessment
        if frames_evaluated >= 4 and not is_boundary and top1_prob >= 0.45:
            stability = "high"
        elif frames_evaluated >= 2 or top1_prob >= 0.38:
            stability = "moderate"
        else:
            stability = "low"

        # 7. Physical Explanation
        explanation = self._generate_explanation(top1_shape, is_boundary, secondary_shape, features)

        top_predictions = [{"shape": shape, "probability": float(prob)} for shape, prob in sorted_preds]

        return {
            "face_shape": top1_shape,
            "confidence": float(round(top1_prob, 4)),
            "top_predictions": top_predictions,
            "features": {k: round(float(v), 4) for k, v in features.items()},
            "frames_evaluated": frames_evaluated,
            "stability": stability,
            "is_boundary_case": is_boundary,
            "secondary_shape": secondary_shape,
            "explanation": explanation
        }

    def _generate_explanation(
        self,
        shape: str,
        is_boundary: bool,
        secondary: Optional[str],
        features: Dict[str, float]
    ) -> str:
        lw = features.get("face_length_to_cheekbone_width", 1.20)
        jw = features.get("jaw_width_to_cheekbone_width", 0.94)
        chin_ang = features.get("chin_angle", 88.0)

        explanations = {
            "Oval": f"Harmonic length-to-width ratio ({lw:.2f}) with gently rounded cheekbones and balanced jawline.",
            "Round": f"Softly curved contour with compact length-to-width ratio ({lw:.2f}) and a gently rounded jawline.",
            "Square": f"Strong angular jawline (jaw/cheek {jw:.2f}) with balanced, symmetrical facial width.",
            "Heart": f"Broad forehead tapering elegantly to a delicately pointed chin (chin angle {chin_ang:.1f}°).",
            "Oblong": f"Elongated vertical face profile ({lw:.2f} length-to-width ratio) with uniform width throughout."
        }
        base_desc = explanations.get(shape, "Standard facial proportions detected.")
        if is_boundary and secondary:
            base_desc += f" Balanced features also exhibit subtle {secondary} characteristics."
        return base_desc


# Global singleton instance
face_shape_classifier = FaceShapeClassifier()
