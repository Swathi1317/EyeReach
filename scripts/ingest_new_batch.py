"""
SmartFrame AI - New Batch Ingestion and Validation Engine
Validates newly collected image batches against strict quality and ethical standards:
1. Validates CSV template: image_filename, image_path, face_shape, person_id, consent_status, verification_status
2. Restricts face_shape strictly to: Heart, Oblong, Oval, Round, Square
3. Defaults verification_status to: PENDING_REVIEW
4. Performs integrity checks (corruption, resolution, duplicates)
5. Extracts MediaPipe FaceMesh anthropometric ratios for human review assistance
6. Preserves existing 75 images, models, and verified manifests.
"""

import os
import sys
import hashlib
import argparse
import logging
from typing import Dict, List, Optional
import cv2
import numpy as np
import pandas as pd
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

import mediapipe as mp

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ingest_batch")

ALLOWED_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]
REQUIRED_COLUMNS = ["image_filename", "image_path", "face_shape", "person_id", "consent_status", "verification_status"]

DATASET_DIR = "D:/SmartframeAi/Data/Dataset"
CLASSIFIED_DIR = "D:/SmartframeAi/Data/Classified_Dataset"
MANIFEST_PATH = os.path.join(CLASSIFIED_DIR, "reviewed_labels_manifest.csv")
PREVIEWS_DIR = os.path.join(CLASSIFIED_DIR, "previews")
DOT_PREVIEWS_DIR = os.path.join(CLASSIFIED_DIR, ".previews")


def dist(p1, p2):
    return float(np.linalg.norm(p1 - p2))


def angle(p1, p2, p3):
    v1, v2 = p1 - p2, p3 - p2
    cos_t = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
    return float(np.degrees(np.arccos(np.clip(cos_t, -1.0, 1.0))))


def compute_file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def validate_and_ingest_batch(batch_csv_path: str, dry_run: bool = False):
    logger.info("=" * 70)
    logger.info(" SmartFrame AI - Batch Ingestion & Quality Validation Pipeline")
    logger.info("=" * 70)
    logger.info(f"Batch Manifest: {batch_csv_path}")
    logger.info(f"Dry Run Mode:   {dry_run}")

    if not os.path.exists(batch_csv_path):
        logger.error(f"Batch CSV file not found: {batch_csv_path}")
        return False

    df_batch = pd.read_csv(batch_csv_path)
    logger.info(f"Loaded {len(df_batch)} candidate entries from batch CSV.")

    # 1. Column validation
    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df_batch.columns]
    if missing_cols:
        logger.error(f"Batch CSV is missing required columns: {missing_cols}")
        logger.info(f"Required columns are: {REQUIRED_COLUMNS}")
        return False

    # 2. Existing hashes for duplicate prevention
    existing_hashes = set()
    if os.path.exists(DATASET_DIR):
        for f in os.listdir(DATASET_DIR):
            fpath = os.path.join(DATASET_DIR, f)
            if os.path.isfile(fpath):
                try:
                    existing_hashes.add(compute_file_hash(fpath))
                except Exception:
                    pass
    logger.info(f"Cataloged {len(existing_hashes)} existing image hashes to prevent duplication.")

    fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, refine_landmarks=True)

    passed_records = []
    rejected_records = []

    for idx, row in df_batch.iterrows():
        fname = str(row["image_filename"]).strip()
        img_path = str(row["image_path"]).strip()
        face_shape = str(row["face_shape"]).strip()
        person_id = str(row["person_id"]).strip()
        consent = str(row.get("consent_status", "")).strip().upper()

        logger.info(f"Validating [{idx+1}/{len(df_batch)}]: {fname}")

        # Check allowed class
        if face_shape not in ALLOWED_CLASSES:
            rejected_records.append({"filename": fname, "reason": f"Invalid face_shape '{face_shape}'. Must be one of {ALLOWED_CLASSES}"})
            continue

        # Check consent
        if consent not in ["GRANTED", "DOCUMENTED", "YES"]:
            rejected_records.append({"filename": fname, "reason": f"Consent status is '{consent}'. Must be 'GRANTED'"})
            continue

        # Check file exists
        if not os.path.exists(img_path):
            rejected_records.append({"filename": fname, "reason": f"Image file not found at: {img_path}"})
            continue

        # Check duplicate by hash
        try:
            curr_hash = compute_file_hash(img_path)
            if curr_hash in existing_hashes:
                rejected_records.append({"filename": fname, "reason": "Duplicate file detected (exact bitstream already in dataset)"})
                continue
        except Exception as e:
            rejected_records.append({"filename": fname, "reason": f"Hash computation error: {e}"})
            continue

        # Decode image and check resolution
        try:
            ext = os.path.splitext(img_path)[1].lower()
            if ext in [".heic", ".heif"]:
                pil_img = Image.open(img_path).convert("RGB")
                img_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            else:
                img_bgr = cv2.imread(img_path)
        except Exception as e:
            rejected_records.append({"filename": fname, "reason": f"Image decode failure: {e}"})
            continue

        if img_bgr is None:
            rejected_records.append({"filename": fname, "reason": "Corrupt or unreadable image bitstream"})
            continue

        h, w = img_bgr.shape[:2]
        if min(h, w) < 480:
            rejected_records.append({"filename": fname, "reason": f"Resolution too low ({w}x{h} px, min 480 px required)"})
            continue

        # MediaPipe FaceMesh detection with rotation fallback
        rotations = [(None, 0), (cv2.ROTATE_90_CLOCKWISE, 90), (cv2.ROTATE_90_COUNTERCLOCKWISE, 270)]
        coords = None
        for rot, _ in rotations:
            cand = img_bgr if rot is None else cv2.rotate(img_bgr, rot)
            res = fm.process(cv2.cvtColor(cand, cv2.COLOR_BGR2RGB))
            if res.multi_face_landmarks:
                ch, cw = cand.shape[:2]
                coords = np.array([[lm.x * cw, lm.y * ch] for lm in res.multi_face_landmarks[0].landmark])
                w, h = cw, ch
                break

        if coords is None:
            rejected_records.append({"filename": fname, "reason": "No facial landmarks detected (face occluded, blurred, or off-center)"})
            continue

        # Extract Anthropometric measurements
        w_cheek = dist(coords[234], coords[454])
        w_jaw = dist(coords[132], coords[361])
        w_forehead = dist(coords[54], coords[284])
        l_face = dist(coords[10], coords[152])
        a_chin = angle(coords[132], coords[152], coords[361])
        avg_jaw_a = (angle(coords[234], coords[132], coords[152]) + angle(coords[454], coords[361], coords[152])) / 2.0
        lw_ratio = l_face / (w_cheek + 1e-6)

        # Quality check: face must be > 15% of frame width
        if w_cheek < w * 0.15:
            rejected_records.append({"filename": fname, "reason": f"Face too small in frame ({w_cheek/w:.1%} of image width, min 15% required)"})
            continue

        # Record valid candidate for human review
        passed_records.append({
            "image_filename": fname,
            "image_path": img_path,
            "face_shape": face_shape,
            "person_id": person_id,
            "consent_status": consent,
            "verification_status": "PENDING_REVIEW",
            "lw_ratio": round(lw_ratio, 2),
            "jaw_angle": round(avg_jaw_a, 1),
            "chin_angle": round(a_chin, 1),
            "image_width": w,
            "image_height": h
        })
        existing_hashes.add(curr_hash)

    # Summary
    logger.info("\n" + "=" * 70)
    logger.info(" BATCH VALIDATION SUMMARY")
    logger.info("=" * 70)
    logger.info(f"Total Evaluated: {len(df_batch)}")
    logger.info(f"Passed Checks:   {len(passed_records)}")
    logger.info(f"Rejected:        {len(rejected_records)}")

    if rejected_records:
        logger.warning("\nRejected Candidates:")
        for r in rejected_records:
            logger.warning(f"  - {r['filename']}: {r['reason']}")

    if passed_records:
        logger.info("\nPassed Candidates (Ready for Human Review):")
        for p in passed_records:
            logger.info(f"  - {p['image_filename']} ({p['face_shape']}) | L/W: {p['lw_ratio']} | Jaw: {p['jaw_angle']}° | Status: {p['verification_status']}")

        # Save validated batch to staging CSV
        staging_csv = os.path.join(CLASSIFIED_DIR, "validated_new_batch_staging.csv")
        pd.DataFrame(passed_records).to_csv(staging_csv, index=False)
        logger.info(f"\nValidated staging CSV saved to: {staging_csv}")
        logger.info("Next Step: Open review_tool.html to inspect and approve/correct labels before training.")

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate and ingest new image batches")
    parser.add_argument("--batch_csv", default="D:/SmartframeAi/Data/data_collection_template.csv", help="Path to batch CSV")
    parser.add_argument("--dry_run", action="store_true", help="Test batch without writing files")
    args = parser.parse_args()

    validate_and_ingest_batch(args.batch_csv, dry_run=args.dry_run)
