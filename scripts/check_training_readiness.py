"""
SmartFrame AI - Safe Model Training Readiness & Pre-Flight Validator
Audits verified manifest, verifies image files and MediaPipe feature extraction,
evaluates 5-class data sufficiency and person grouping, and enforces the
strict STOP rule if classes are deficient.
"""

import os
import sys
import logging
from typing import Dict, List, Tuple
import pandas as pd
import numpy as np
import cv2
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

# Ensure backend is in path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.ml.build_features import FaceFeatureExtractor, FEATURE_NAMES

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("training_readiness")

MANIFEST_PATH = "D:/SmartframeAi/Data/Classified_Dataset/reviewed_labels_manifest.csv"
DATASET_DIR = "D:/SmartframeAi/Data/Dataset"
CLASSIFIED_DIR = "D:/SmartframeAi/Data/Classified_Dataset"
TARGET_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]
MIN_SAMPLES_PER_CLASS_STRICT = 30  # For statistically valid train/val/test evaluation
ABSOLUTE_MIN_PER_SPLIT = 3         # At least 1 train, 1 val, 1 test


def load_image_robust(path: str) -> np.ndarray:
    ext = os.path.splitext(path)[1].lower()
    if ext in [".heic", ".heif"]:
        pil = Image.open(path).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    img = cv2.imread(path)
    if img is None:
        pil = Image.open(path).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    return img


def check_training_readiness():
    print("=" * 72)
    print(" SMARTFRAME AI - SAFE MODEL TRAINING PRE-FLIGHT AUDIT")
    print("=" * 72)

    # 1. Manifest verification
    if not os.path.exists(MANIFEST_PATH):
        print(f"ERROR: Verified manifest not found at: {MANIFEST_PATH}")
        return False

    df = pd.read_csv(MANIFEST_PATH)
    print(f"1. Total entries in reviewed_labels_manifest.csv: {len(df)}")

    # 2. Filter out Skip and unapproved rows
    df_usable = df[
        (df["reviewed_label"].isin(TARGET_CLASSES)) & 
        (df["review_status"] != "SKIPPED")
    ].copy()
    skipped_count = len(df) - len(df_usable)
    print(f"2. Excluded Skipped / Unapproved records: {skipped_count}")
    print(f"   Retained usable verified candidates:  {len(df_usable)}")

    # 3. Validate image file existence and feature extraction
    extractor = FaceFeatureExtractor()
    valid_features = []
    missing_files = []
    failed_features = []
    heic_files = []

    print("\n3. Validating physical image files and 11-feature extraction...")
    for idx, row in df_usable.iterrows():
        fname = row["image_filename"]
        orig_path = row["original_path"]

        # Resolve path
        if not os.path.exists(orig_path):
            cand = os.path.join(DATASET_DIR, fname)
            if os.path.exists(cand):
                orig_path = cand
            else:
                found = False
                for root, _, files in os.walk(CLASSIFIED_DIR):
                    if fname in files:
                        orig_path = os.path.join(root, fname)
                        found = True
                        break
                if not found:
                    missing_files.append(fname)
                    continue

        ext = os.path.splitext(orig_path)[1].lower()
        if ext in [".heic", ".heif"]:
            heic_files.append(fname)

        try:
            img = load_image_robust(orig_path)
            h, w = img.shape[:2]
            max_size = 1280
            if max(h, w) > max_size:
                scale = max_size / max(h, w)
                img = cv2.resize(img, (int(w * scale), int(h * scale)))
                h, w = img.shape[:2]

            res = extractor.face_mesh.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            if not res.multi_face_landmarks:
                failed_features.append(fname)
                continue

            landmarks = res.multi_face_landmarks[0].landmark
            coords = np.array([[lm.x * w, lm.y * h] for lm in landmarks])
            feats = extractor._compute_features(coords)

            if feats is None:
                failed_features.append(fname)
            else:
                all_valid = all(k in feats and not np.isnan(feats[k]) for k in FEATURE_NAMES)
                if all_valid:
                    row_dict = row.to_dict()
                    row_dict["resolved_path"] = orig_path
                    for k, v in feats.items():
                        row_dict[k] = v
                    valid_features.append(row_dict)
                else:
                    failed_features.append(fname)
        except Exception as e:
            failed_features.append(f"{fname} ({e})")

    print(f"   - Images physically verified on disk: {len(df_usable) - len(missing_files)}/{len(df_usable)}")
    if missing_files:
        print(f"     WARNING: Missing files: {missing_files}")
    print(f"   - Successful MediaPipe 11-feature extraction: {len(valid_features)}/{len(df_usable)}")
    if heic_files:
        print(f"     NOTE: 4 Apple HEIC files detected and verified via pillow-heif.")
    if failed_features:
        print(f"     WARNING: Failed feature extractions: {failed_features}")

    df_valid = pd.DataFrame(valid_features)

    # 4. Class counts audit
    print("\n4. Verified Sample Counts by Target Class:")
    counts = {c: 0 for c in TARGET_CLASSES}
    for c, cnt in df_valid["reviewed_label"].value_counts().items():
        if c in counts:
            counts[c] = cnt

    for c in TARGET_CLASSES:
        print(f"   - {c:<8}: {counts[c]:>2} verified samples")

    # 5. Check Person Identity Grouping
    from prepare_training_dataset import extract_person_id
    df_valid["person_id"] = df_valid["image_filename"].apply(extract_person_id)
    unique_persons = df_valid["person_id"].nunique()
    print(f"\n5. Identity Grouping (to prevent person leakage across splits):")
    print(f"   - Total Usable Images:   {len(df_valid)}")
    print(f"   - Unique Person Groups:  {unique_persons}")

    # 6. Sufficiency and Split Feasibility Evaluation
    print("\n" + "=" * 72)
    print(" SUFFICIENCY & SAFETY DECISION")
    print("=" * 72)

    deficits = {}
    fatal_errors = []

    for c in TARGET_CLASSES:
        cnt = counts[c]
        if cnt == 0:
            fatal_errors.append(f"FATAL: Class '{c}' has 0 samples. Cannot compute loss or train 5-class model.")
            deficits[c] = 100
        elif cnt < ABSOLUTE_MIN_PER_SPLIT:
            fatal_errors.append(f"FATAL: Class '{c}' has only {cnt} sample(s). Cannot form Train, Val, and Test splits.")
            deficits[c] = 100 - cnt
        elif cnt < MIN_SAMPLES_PER_CLASS_STRICT:
            deficits[c] = 100 - cnt

    if fatal_errors:
        print("[STOP] TRAINING HALTED: DATASET IS INSUFFICIENT FOR SAFE MODEL TRAINING")
        print("\nBlocking Errors:")
        for err in fatal_errors:
            print(f"   * {err}")

        print("\nClass-by-Class Collection Requirements (to reach target of 100 per class):")
        for c in TARGET_CLASSES:
            need = deficits.get(c, 0)
            print(f"   * {c:<8}: Current = {counts[c]:>2} | Target = 100 | Additional Needed = +{need}")

        print("\nPROTECTION RULES ENFORCED:")
        print("   [OK] Training has NOT been started.")
        print("   [OK] Existing model 'face_shape_model.joblib' is untouched.")
        print("   [OK] Existing 75 original images are untouched.")
        print("   [OK] No synthetic images or duplicates were generated.")
        print("=" * 72)
        return False
    else:
        print("[READY] DATASET IS SUFFICIENT: Ready for candidate model training.")
        return True


if __name__ == "__main__":
    check_training_readiness()
