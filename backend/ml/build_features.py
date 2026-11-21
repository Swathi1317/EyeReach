import os
import glob
import cv2
import math
import pandas as pd
import numpy as np
import mediapipe as mp
import logging
from typing import Optional, Dict, Tuple, List
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils

# MediaPipe landmark indices (based on canonical face mesh)
# These indices are widely used for facial proportions
L_CHEEK = 234  # Leftmost cheekbone point
R_CHEEK = 454  # Rightmost cheekbone point
CHIN = 152     # Lowest chin point
TOP_FOREHEAD = 10  # Top of forehead (hairline approx)
L_JAW = 132    # Left jaw angle
R_JAW = 361    # Right jaw angle
L_FOREHEAD = 54 # Left forehead width marker
R_FOREHEAD = 284 # Right forehead width marker
L_EYE_OUT = 33 # Left eye outer corner
R_EYE_OUT = 263 # Right eye outer corner
BOTTOM_NOSE = 2 # Nose tip/bottom
MOUTH_L = 61   # Left mouth corner
MOUTH_R = 291  # Right mouth corner

FEATURE_NAMES = [
    "face_length_to_cheekbone_width",
    "jaw_width_to_cheekbone_width",
    "forehead_width_to_cheekbone_width",
    "jaw_width_to_forehead_width",
    "chin_width_to_jaw_width",
    "avg_jaw_angle",
    "chin_angle",
    "cheekbone_to_jaw_taper",
    "forehead_height_ratio",
    "lower_face_to_mid_face_ratio",
    "contour_curvature"
]

class FaceFeatureExtractor:
    def __init__(self):
        self.face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
    
    def process_image(self, image_path: str) -> Optional[Dict[str, float]]:
        image = cv2.imread(image_path)
        if image is None:
            try:
                pil_img = Image.open(image_path).convert("RGB")
                image = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            except Exception as e:
                logger.error(f"Failed to read image {image_path}: {e}")
                return None
        
        # Resize if larger than 1280
        h, w = image.shape[:2]
        max_size = 1280
        if max(h, w) > max_size:
            scale = max_size / max(h, w)
            image = cv2.resize(image, (int(w * scale), int(h * scale)))
            h, w = image.shape[:2]
        
        # Convert the BGR image to RGB before processing.
        results = self.face_mesh.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        if not results.multi_face_landmarks:
            return None
        
        landmarks = results.multi_face_landmarks[0].landmark
        
        # Extract pixel coords
        coords = np.array([[lm.x * w, lm.y * h] for lm in landmarks])
        
        return self._compute_features(coords)
    
    def _compute_features(self, coords: np.ndarray) -> Dict[str, float]:
        # Helper for euclidean distance
        def dist(p1, p2):
            return np.linalg.norm(p1 - p2)
            
        def angle_between_3_points(p1, p2, p3):
            # Angle at p2 formed by p1-p2-p3
            v1 = p1 - p2
            v2 = p3 - p2
            cos_theta = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
            cos_theta = np.clip(cos_theta, -1.0, 1.0)
            return math.degrees(math.acos(cos_theta))
        
        # Dimensions
        cheekbone_width = dist(coords[L_CHEEK], coords[R_CHEEK])
        jaw_width = dist(coords[L_JAW], coords[R_JAW])
        forehead_width = dist(coords[L_FOREHEAD], coords[R_FOREHEAD])
        face_length = dist(coords[TOP_FOREHEAD], coords[CHIN])
        chin_width = dist(coords[43], coords[273]) # Approximation of chin width using lower lip/chin landmarks
        
        if cheekbone_width < 1e-6 or jaw_width < 1e-6 or forehead_width < 1e-6:
            # Degenerate case
            return None

        # Features
        face_length_to_cheekbone_width = face_length / cheekbone_width
        jaw_width_to_cheekbone_width = jaw_width / cheekbone_width
        forehead_width_to_cheekbone_width = forehead_width / cheekbone_width
        jaw_width_to_forehead_width = jaw_width / forehead_width
        chin_width_to_jaw_width = chin_width / jaw_width
        
        # Angles
        l_jaw_angle = angle_between_3_points(coords[L_CHEEK], coords[L_JAW], coords[CHIN])
        r_jaw_angle = angle_between_3_points(coords[R_CHEEK], coords[R_JAW], coords[CHIN])
        avg_jaw_angle = (l_jaw_angle + r_jaw_angle) / 2.0
        
        chin_angle = angle_between_3_points(coords[L_JAW], coords[CHIN], coords[R_JAW])
        
        # Taper
        cheekbone_to_jaw_taper = cheekbone_width - jaw_width
        
        # Height Ratios
        mid_face_length = dist(coords[BOTTOM_NOSE], coords[TOP_FOREHEAD])
        lower_face_length = dist(coords[BOTTOM_NOSE], coords[CHIN])
        forehead_height = dist(coords[TOP_FOREHEAD], coords[9]) # Using nose bridge 9 as lower bound of forehead
        
        forehead_height_ratio = forehead_height / face_length
        lower_face_to_mid_face_ratio = lower_face_length / (mid_face_length + 1e-6)
        
        # Contour curvature (approximation using jawline points)
        # We can measure deviation from straight line between L_JAW and CHIN using an intermediate point
        intermediate_jaw_l = coords[150]
        line_dist_l = np.linalg.norm(np.cross(coords[CHIN]-coords[L_JAW], coords[L_JAW]-intermediate_jaw_l)) / np.linalg.norm(coords[CHIN]-coords[L_JAW]+1e-6)
        contour_curvature = line_dist_l / (face_length + 1e-6) # Normalized
        
        return {
            "face_length_to_cheekbone_width": face_length_to_cheekbone_width,
            "jaw_width_to_cheekbone_width": jaw_width_to_cheekbone_width,
            "forehead_width_to_cheekbone_width": forehead_width_to_cheekbone_width,
            "jaw_width_to_forehead_width": jaw_width_to_forehead_width,
            "chin_width_to_jaw_width": chin_width_to_jaw_width,
            "avg_jaw_angle": avg_jaw_angle,
            "chin_angle": chin_angle,
            "cheekbone_to_jaw_taper": cheekbone_to_jaw_taper / cheekbone_width, # Normalize to be dimensionless
            "forehead_height_ratio": forehead_height_ratio,
            "lower_face_to_mid_face_ratio": lower_face_to_mid_face_ratio,
            "contour_curvature": contour_curvature
        }

def process_dataset(data_dir: str, cache_path: str, force: bool = False, benchmark: int = 0):
    if not force and os.path.exists(cache_path):
        logger.info(f"Loading cached features from {cache_path}")
        return pd.read_parquet(cache_path)
    
    logger.info(f"Building features for {data_dir}...")
    extractor = FaceFeatureExtractor()
    records = []
    
    classes = [d for d in os.listdir(data_dir) if os.path.isdir(os.path.join(data_dir, d))]
    
    total = 0
    success = 0
    failures = 0
    class_counts = {c: {"total": 0, "success": 0, "failed": 0} for c in classes}
    
    # Calculate target total for logging
    all_images = []
    for c in classes:
        class_dir = os.path.join(data_dir, c)
        for img_name in os.listdir(class_dir):
            if img_name.lower().endswith(('.png', '.jpg', '.jpeg')):
                all_images.append((c, os.path.join(class_dir, img_name)))
                
    if benchmark > 0:
        all_images = all_images[:benchmark]
    
    target_total = len(all_images)
    
    import time
    start_time = time.time()
    
    for c, img_path in all_images:
        total += 1
        class_counts[c]["total"] += 1
        
        if total % 100 == 0:
            logger.info(f"Processing {total}/{target_total}")
            
        features = extractor.process_image(img_path)
        if features is None:
            failures += 1
            class_counts[c]["failed"] += 1
            records.append({
                "image_path": img_path,
                "label": c,
                "status": "failed",
                "reason": "facemesh_failure",
                **{f: np.nan for f in FEATURE_NAMES}
            })
        else:
            success += 1
            class_counts[c]["success"] += 1
            records.append({
                "image_path": img_path,
                "label": c,
                "status": "success",
                "reason": "",
                **features
            })
            
    end_time = time.time()
    elapsed = end_time - start_time
    
    df = pd.DataFrame(records)
    df.to_parquet(cache_path)
    
    logger.info("--- Dataset Report ---")
    logger.info(f"Total images processed: {total}")
    for c in classes:
        if class_counts[c]['total'] > 0:
            logger.info(f"Class {c}: Discovered: {class_counts[c]['total']} | Success: {class_counts[c]['success']} | Failed: {class_counts[c]['failed']}")
    logger.info(f"Total usable samples: {success}")
    logger.info(f"Feature extraction time: {elapsed:.2f}s (Avg {elapsed/max(1, total)*1000:.1f}ms/img)")
    logger.info(f"Cached to: {cache_path}")
    
    return df

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--benchmark", type=int, default=0, help="Process only N images")
    args = parser.parse_args()
    
    base_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    os.makedirs(os.path.join(base_dir, "cache"), exist_ok=True)
    
    process_dataset(os.path.join(base_dir, "training_set"), os.path.join(base_dir, "cache", "training_set.parquet"), force=args.force, benchmark=args.benchmark)
    
    if args.benchmark == 0:
        process_dataset(os.path.join(base_dir, "testing_set"), os.path.join(base_dir, "cache", "testing_set.parquet"), force=args.force)
        
        val_dir = os.path.join(base_dir, "my_validation")
        if os.path.exists(val_dir):
            process_dataset(val_dir, os.path.join(base_dir, "cache", "my_validation.parquet"), force=args.force)
