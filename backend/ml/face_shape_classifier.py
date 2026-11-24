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
    Computes anthropometric prior compatibility for all 6 standardized face shapes:
    Diamond, Heart, Oblong, Oval, Round, Square.
    
    Based on Farkas Craniofacial Anthropometry, The Face Report Reference & Optical Sizing Standards:
    - Oval: Face length roughly 1.4-1.55x width. Forehead and jaw are gently tapered from cheekbones. Balanced harmony.
    - Round: Face length and width are relatively similar (~1.0-1.15 : 1). Soft curved jawline with no sharp angles. Full mid-face.
    - Square: Face length and width are relatively similar (~1.0-1.20 : 1). Forehead, cheekbones, and jaw have similar widths with a strong angular jawline.
    - Heart: Forehead is relatively wider (or wider than jaw). Jawline tapers sharply to a narrow pointed chin.
    - Diamond: Cheekbones are clearly the widest point. Forehead AND jaw are significantly narrower than cheekbones. Pointed chin.
    - Oblong: Face noticeably elongated (L/W >= 1.25 / ~1.6 : 1+). Width uniform from forehead to jaw with comparatively straight sides.
    """
    CLASSES = ["Diamond", "Heart", "Oblong", "Oval", "Round", "Square"]

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
            scores["Oblong"] *= 3.0
            scores["Oval"] *= 0.9
            scores["Diamond"] *= 0.7
            scores["Heart"] *= 0.6
            scores["Round"] *= 0.15
            scores["Square"] *= 0.2
        elif lw >= 1.22:
            scores["Oblong"] *= 2.0
            scores["Oval"] *= 1.3
            scores["Diamond"] *= 1.1
            scores["Heart"] *= 0.9
            scores["Round"] *= 0.35
            scores["Square"] *= 0.45
        elif lw <= 1.13:
            scores["Round"] *= 2.2
            scores["Square"] *= 2.0
            scores["Oval"] *= 0.5
            scores["Heart"] *= 0.6
            scores["Diamond"] *= 0.4
            scores["Oblong"] *= 0.1
        elif lw <= 1.16:
            scores["Round"] *= 1.6
            scores["Square"] *= 1.5
            scores["Oval"] *= 0.85
            scores["Heart"] *= 0.8
            scores["Diamond"] *= 0.6
            scores["Oblong"] *= 0.25
        else: # Balanced 1.16 < lw < 1.22
            scores["Oval"] *= 1.6
            scores["Heart"] *= 1.3
            scores["Diamond"] *= 1.3
            scores["Round"] *= 0.8
            scores["Square"] *= 0.8
            scores["Oblong"] *= 0.6

        # 2. Forehead vs Cheekbone (Heart vs Diamond vs Square vs Oval)
        if fw >= 0.89:
            scores["Heart"] *= 1.8
            scores["Square"] *= 1.3
            scores["Oblong"] *= 1.2
            scores["Diamond"] *= 0.3
            scores["Oval"] *= 0.9
        elif fw <= 0.84:
            scores["Diamond"] *= 2.0
            scores["Round"] *= 1.2
            scores["Oval"] *= 1.1
            scores["Heart"] *= 0.35
            scores["Square"] *= 0.6
        else:
            scores["Oval"] *= 1.2
            scores["Diamond"] *= 1.1
            scores["Heart"] *= 1.0

        # 3. Jaw Width to Cheekbone Width & Jaw Angularity
        if jw >= 0.95:
            scores["Square"] *= 1.8
            scores["Oblong"] *= 1.4
            scores["Round"] *= 0.75
            scores["Heart"] *= 0.35
            scores["Diamond"] *= 0.3
            scores["Oval"] *= 0.8
        elif jw <= 0.91:
            scores["Diamond"] *= 1.6
            scores["Heart"] *= 1.6
            scores["Oval"] *= 1.2
            scores["Square"] *= 0.4
            scores["Round"] *= 0.8

        if jaw_ang <= 139.0:
            scores["Square"] *= 1.6
            scores["Oblong"] *= 1.2
            scores["Round"] *= 0.55
            scores["Oval"] *= 0.85
        elif jaw_ang >= 142.5:
            scores["Round"] *= 1.5
            scores["Oval"] *= 1.2
            scores["Square"] *= 0.65

        # 4. Chin Angularity and Taper (Pointed Chin in Heart & Diamond vs Rounded/Square)
        if chin_ang <= 86.0:
            scores["Heart"] *= 1.7
            scores["Diamond"] *= 1.8
            scores["Round"] *= 0.35
            scores["Square"] *= 0.4
            scores["Oval"] *= 1.0
        elif chin_ang >= 91.0:
            scores["Round"] *= 1.4
            scores["Square"] *= 1.35
            scores["Oblong"] *= 1.2
            scores["Heart"] *= 0.4
            scores["Diamond"] *= 0.35

        if taper >= 0.058:
            scores["Heart"] *= 1.4
            scores["Diamond"] *= 1.5
            scores["Oval"] *= 1.1
            scores["Square"] *= 0.5
            scores["Oblong"] *= 0.6
        elif taper <= 0.042:
            scores["Square"] *= 1.4
            scores["Oblong"] *= 1.3
            scores["Diamond"] *= 0.4
            scores["Heart"] *= 0.5

        # 5. Dedicated Signature Enforcers:
        # Diamond Signature: Cheekbones widest (fw < 0.88 AND jw < 0.92) with pointed chin (chin_ang <= 88)
        if fw < 0.88 and jw < 0.92 and chin_ang <= 88.0 and taper >= 0.052:
            scores["Diamond"] *= 1.7

        # Heart Signature: Broad forehead (fw >= 0.88) with narrow pointed chin
        if fw >= 0.88 and jw < 0.92 and chin_ang <= 88.0 and taper >= 0.052:
            scores["Heart"] *= 1.7

        # Square Signature: Equal proportions (fw >= 0.86, jw >= 0.94) with angular jaw (jaw_ang <= 140.5)
        if jw >= 0.945 and jaw_ang <= 140.5 and lw <= 1.20:
            scores["Square"] *= 1.7

        # Round Signature: Short face (lw <= 1.15) with soft curved jaw (jaw_ang >= 141.5, chin_ang >= 89)
        if lw <= 1.16 and jaw_ang >= 141.5 and chin_ang >= 89.0:
            scores["Round"] *= 1.7

        # Oblong Signature: Long face (lw >= 1.25) with straight sides
        if lw >= 1.25 and jw >= 0.90:
            scores["Oblong"] *= 1.8

        # Oval Signature: Harmonic balance (1.17 <= lw <= 1.25, 0.85 <= fw <= 0.92, 0.90 <= jw <= 0.94, chin_ang 86-91)
        if 1.17 <= lw <= 1.25 and 0.85 <= fw <= 0.92 and 0.90 <= jw <= 0.945 and 86.0 <= chin_ang <= 91.0:
            scores["Oval"] *= 1.6

        # Normalize to probability distribution
        total = sum(scores.values()) + 1e-9
        return {c: scores[c] / total for c in cls.CLASSES}


class FaceShapeClassifier:
    """
    Production-grade stabilized Face Shape Classifier combining:
    1. Pre-trained supervised ML pipeline (XGBoost / PowerSVC)
    2. Multi-frame quality extraction and temporal MAD feature stabilization
    3. Anthropometric geometric priors (Farkas craniofacial standard)
    4. Six standard face shapes: Oval, Round, Square, Heart, Diamond, Oblong
    5. Boundary case disambiguation and transparency
    """
    CLASSES = ["Diamond", "Heart", "Oblong", "Oval", "Round", "Square"]

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
        supports all 6 standard face shapes (Diamond, Heart, Oblong, Oval, Round, Square),
        resolves boundary cases, and provides stability and explanation metrics.
        """
        mod = self.model_artifact
        pipeline = mod["pipeline"]
        le = mod["label_encoder"]
        feature_cols = mod["feature_cols"]
        model_classes = list(le.classes_) # ["Heart", "Oblong", "Oval", "Round", "Square"]

        # 1. Direct ML prediction on stabilized features
        feat_dict = {col: features.get(col, 0.0) for col in feature_cols}
        df_feat = pd.DataFrame([feat_dict])[feature_cols]
        p_ml_stab = pipeline.predict_proba(df_feat.values)[0]

        # 2. Frame-level soft-voting average (if multi-frame)
        if frame_ml_probs_list and len(frame_ml_probs_list) > 1:
            p_soft_vote = np.mean(frame_ml_probs_list, axis=0)
            p_ml_5 = 0.65 * p_ml_stab + 0.35 * p_soft_vote
        else:
            p_ml_5 = p_ml_stab

        p_ml_dict = {model_classes[i]: float(p_ml_5[i]) for i in range(len(model_classes))}

        # 3. Project 5-class ML probabilities into 6-class space (incorporating Diamond)
        # In 5-class training data, Diamond faces (narrow forehead, prominent cheekbones, pointed chin)
        # map into Heart (pointed chin) or Oval (cheekbones widest).
        fw = features.get("forehead_width_to_cheekbone_width", 0.86)
        jw = features.get("jaw_width_to_cheekbone_width", 0.94)
        chin_ang = features.get("chin_angle", 88.0)
        taper = features.get("cheekbone_to_jaw_taper", 0.055)

        # Diamond signature affinity: narrow forehead (<0.88), prominent cheekbones, pointed chin (<=88)
        diamond_affinity = float(
            np.clip((0.89 - fw) / 0.08, 0.0, 1.0) *
            np.clip((89.0 - chin_ang) / 7.0, 0.0, 1.0)
        )
        if jw < 0.92 and taper >= 0.050:
            diamond_affinity = float(np.clip(diamond_affinity * 1.25, 0.0, 1.0))
        else:
            diamond_affinity = float(diamond_affinity * 0.45)

        # In 5-class training data, Diamond faces (narrow forehead, prominent cheekbones, pointed chin)
        # map into Heart (pointed chin), Oval (cheekbones widest), or Oblong (if face length > 1.30).
        # An Oblong face strictly requires uniform width (fw >= 0.88, jw >= 0.88, taper < 0.08).
        # When jaw and forehead are narrow with significant cheekbone taper, Oblong mass belongs to Diamond.
        oblong_diamond_transfer = 0.0
        if jw <= 0.88 and taper >= 0.07:
            oblong_diamond_transfer = float(p_ml_dict.get("Oblong", 0.2)) * 0.80 * diamond_affinity

        p_heart_orig = float(p_ml_dict.get("Heart", 0.2))
        p_oval_orig = float(p_ml_dict.get("Oval", 0.2))
        p_oblong_orig = float(p_ml_dict.get("Oblong", 0.2))

        # Split affinity proportionally
        p_diamond_ml = (
            (p_heart_orig * 0.70 * diamond_affinity) +
            (p_oval_orig * 0.30 * diamond_affinity) +
            oblong_diamond_transfer
        )
        p_heart_ml = max(0.01, p_heart_orig - (p_heart_orig * 0.70 * diamond_affinity))
        p_oval_ml = max(0.01, p_oval_orig - (p_oval_orig * 0.30 * diamond_affinity))
        p_oblong_ml = max(0.01, p_oblong_orig - oblong_diamond_transfer)

        p_ml_6 = {
            "Diamond": p_diamond_ml,
            "Heart": p_heart_ml,
            "Oblong": p_oblong_ml,
            "Oval": p_oval_ml,
            "Round": float(p_ml_dict.get("Round", 0.2)),
            "Square": float(p_ml_dict.get("Square", 0.2))
        }
        tot_ml = sum(p_ml_6.values()) + 1e-9
        p_ml_6 = {k: v / tot_ml for k, v in p_ml_6.items()}

        # 4. Anthropometric geometric prior across all 6 classes
        g_scores = AnthropometricFaceShapeScorer.compute_scores(features)

        # 5. Hybrid combination: 65% ML probability + 35% Anthropometric prior
        p_hybrid = {}
        for c in self.CLASSES:
            p_hybrid[c] = (0.65 * p_ml_6[c]) + (0.35 * g_scores[c])
        tot_hyb = sum(p_hybrid.values()) + 1e-9
        prob_dict = {c: float(p_hybrid[c] / tot_hyb) for c in self.CLASSES}

        sorted_preds = sorted(prob_dict.items(), key=lambda x: x[1], reverse=True)
        top1_shape, top1_prob = sorted_preds[0]
        top2_shape, top2_prob = sorted_preds[1]

        # 6. Boundary Disambiguation
        is_boundary = False
        secondary_shape = None
        prob_diff = top1_prob - top2_prob

        # If top predictions are closely contested (margin < 0.08 or confidence < 0.40)
        if prob_diff < 0.08 or top1_prob < 0.40:
            is_boundary = True
            secondary_shape = top2_shape
            
            # Apply clinical tie-breaking criteria based on physical landmarks
            lw = features.get("face_length_to_cheekbone_width", 1.19)
            jaw_ang = features.get("avg_jaw_angle", 142.0)

            pair = {top1_shape, top2_shape}

            # Boundary 1: Round vs Square (both compact L/W; separated by jaw angularity & jaw width)
            if pair == {"Round", "Square"}:
                if jw >= 0.945 and jaw_ang <= 140.5:
                    top1_shape, top2_shape = "Square", "Round"
                elif jaw_ang >= 141.5 and jw < 0.945:
                    top1_shape, top2_shape = "Round", "Square"

            # Boundary 2: Oval vs Round (Oval is longer, Round has wider chin angle & softer jaw)
            elif pair == {"Oval", "Round"}:
                if lw >= 1.185:
                    top1_shape, top2_shape = "Oval", "Round"
                elif lw <= 1.155 and chin_ang >= 89.5:
                    top1_shape, top2_shape = "Round", "Oval"

            # Boundary 3: Heart vs Diamond (Separated by forehead width: Heart has wide forehead, Diamond narrow)
            elif pair == {"Heart", "Diamond"}:
                if fw >= 0.885:
                    top1_shape, top2_shape = "Heart", "Diamond"
                elif fw <= 0.865:
                    top1_shape, top2_shape = "Diamond", "Heart"

            # Boundary 4: Oval vs Heart (Heart has sharp chin angle <= 86.5 and high taper >= 0.056)
            elif pair == {"Oval", "Heart"}:
                if chin_ang <= 86.5 and taper >= 0.056 and fw >= 0.88:
                    top1_shape, top2_shape = "Heart", "Oval"
                elif chin_ang >= 88.0 or taper < 0.052:
                    top1_shape, top2_shape = "Oval", "Heart"

            # Boundary 5: Oval vs Diamond (Diamond has narrow forehead, prominent cheekbones and pointed chin)
            elif pair == {"Oval", "Diamond"}:
                if fw <= 0.865 and chin_ang <= 87.5 and taper >= 0.054:
                    top1_shape, top2_shape = "Diamond", "Oval"
                elif fw >= 0.88 or chin_ang >= 88.5:
                    top1_shape, top2_shape = "Oval", "Diamond"

            # Boundary 6: Oblong vs Oval (Oblong has high vertical length >= 1.25)
            elif pair == {"Oblong", "Oval"}:
                if lw >= 1.245:
                    top1_shape, top2_shape = "Oblong", "Oval"
                elif lw <= 1.22:
                    top1_shape, top2_shape = "Oval", "Oblong"

            # Boundary 7: Oblong vs Diamond (Oblong has uniform width fw/jw >= 0.88, taper < 0.08; Diamond has cheekbone taper)
            elif pair == {"Oblong", "Diamond"}:
                if taper >= 0.08 or jw <= 0.85 or fw <= 0.86:
                    top1_shape, top2_shape = "Diamond", "Oblong"
                else:
                    top1_shape, top2_shape = "Oblong", "Diamond"

            # Re-rank sorted_preds if tie-breaker adjusted the leader
            if top1_shape != sorted_preds[0][0]:
                new_dict = dict(prob_dict)
                boost = 0.02
                new_dict[top1_shape] = max(new_dict[top1_shape], new_dict[top2_shape] + boost)
                tot = sum(new_dict.values())
                sorted_preds = sorted([(k, v/tot) for k, v in new_dict.items()], key=lambda x: x[1], reverse=True)
                top1_shape, top1_prob = sorted_preds[0]

        # 7. Stability Assessment
        if frames_evaluated >= 4 and not is_boundary and top1_prob >= 0.42:
            stability = "high"
        elif frames_evaluated >= 2 or top1_prob >= 0.36:
            stability = "moderate"
        else:
            stability = "low"

        # 8. Physical Explanation
        explanation = self._generate_explanation(top1_shape, is_boundary, secondary_shape, top1_prob, top2_prob, features)

        top_predictions = [{"shape": shape, "probability": float(round(prob, 4))} for shape, prob in sorted_preds]

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
        top1_prob: float,
        top2_prob: float,
        features: Dict[str, float]
    ) -> str:
        lw = features.get("face_length_to_cheekbone_width", 1.20)
        jw = features.get("jaw_width_to_cheekbone_width", 0.94)
        fw = features.get("forehead_width_to_cheekbone_width", 0.86)
        chin_ang = features.get("chin_angle", 88.0)
        jaw_ang = features.get("avg_jaw_angle", 142.0)

        explanations = {
            "Oval": f"Harmonic length-to-width ratio ({lw:.2f}) with gently rounded cheekbones and a balanced, softly tapered jawline.",
            "Round": f"Softly curved contour with compact length-to-width ratio ({lw:.2f}) and a gently rounded jawline without sharp angles.",
            "Square": f"Strong angular jawline (jaw angle {jaw_ang:.1f}°, jaw/cheek {jw:.2f}) with balanced, symmetrical facial width.",
            "Heart": f"Broad forehead ({fw*100:.0f}% of cheekbones) tapering gracefully down to a delicately pointed chin (chin angle {chin_ang:.1f}°).",
            "Diamond": f"Cheekbones are the widest prominent feature with a narrower forehead ({fw*100:.0f}%) and a sharply tapered, pointed chin.",
            "Oblong": f"Noticeably elongated vertical face profile ({lw:.2f} length-to-width ratio) with uniform width and straight side contours."
        }
        base_desc = explanations.get(shape, "Standard facial proportions detected.")
        if is_boundary and secondary:
            base_desc = f"Facial proportions sit between {shape} ({top1_prob*100:.0f}%) and {secondary} ({top2_prob*100:.0f}%). While primary features align with {shape}, subtle {secondary} characteristics are also present."
        return base_desc


# Global singleton instance
face_shape_classifier = FaceShapeClassifier()
