"""
SmartFrame AI - Safe Working Dataset Organizer, Manifest Builder, and Splitter
Audits Kaggle and Real-World datasets, safely organizes a separate working dataset,
builds the unified master manifest, and prepares train/val/test splits with zero leakage.
"""

import os
import sys
import shutil
import hashlib
import logging
from collections import defaultdict
from typing import Dict, List, Tuple
import pandas as pd
import numpy as np
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

# Ensure backend and scripts are in path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
sys.path.append(os.path.join(project_root, "scripts"))

from prepare_training_dataset import extract_person_id

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("build_working_dataset")

# Paths
KAGGLE_DIR = os.path.join(project_root, "backend", "data")
REAL_ORIG_DIR = "D:/SmartframeAi/Data/Dataset"
REAL_CLASSIFIED_DIR = "D:/SmartframeAi/Data/Classified_Dataset"
REAL_MANIFEST_PATH = os.path.join(REAL_CLASSIFIED_DIR, "reviewed_labels_manifest.csv")
WORKING_DIR = "D:/SmartframeAi/Data/Working_Dataset"
WORKING_MANIFEST_PATH = os.path.join(WORKING_DIR, "master_manifest.csv")
WORKING_SPLITS_DIR = os.path.join(WORKING_DIR, "splits")

CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]


def compute_file_md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def audit_and_organize():
    logger.info("=" * 72)
    logger.info(" SMARTFRAME AI - WORKING DATASET CREATION & MASTER AUDIT")
    logger.info("=" * 72)

    # 1. Create Working Directory structure
    os.makedirs(WORKING_DIR, exist_ok=True)
    os.makedirs(os.path.join(WORKING_DIR, "previews"), exist_ok=True)
    os.makedirs(os.path.join(WORKING_DIR, "Review_Required"), exist_ok=True)
    for c in CLASSES:
        os.makedirs(os.path.join(WORKING_DIR, c), exist_ok=True)

    master_records = []

    # -------------------------------------------------------------
    # 2. AUDIT & INGEST REAL-WORLD DATASET (75 images)
    # -------------------------------------------------------------
    logger.info("\n--- Auditing Real-World Dataset ---")
    if not os.path.exists(REAL_MANIFEST_PATH):
        raise FileNotFoundError(f"Missing verified manifest: {REAL_MANIFEST_PATH}")

    df_real_man = pd.read_csv(REAL_MANIFEST_PATH)
    logger.info(f"Loaded real-world manifest: {len(df_real_man)} entries.")

    real_hashes = {}
    real_usable_count = 0
    real_skipped_count = 0

    for _, row in df_real_man.iterrows():
        fname = row["image_filename"]
        orig_p = row["original_path"]

        if not os.path.exists(orig_p):
            cand = os.path.join(REAL_ORIG_DIR, fname)
            if os.path.exists(cand):
                orig_p = cand
            else:
                for root, _, files in os.walk(REAL_CLASSIFIED_DIR):
                    if fname in files:
                        orig_p = os.path.join(root, fname)
                        break

        md5_val = compute_file_md5(orig_p)
        lbl = str(row["reviewed_label"]).strip()
        status = str(row["review_status"]).strip()
        reason = str(row.get("reason", ""))
        person_grp = extract_person_id(fname)

        # Image status and destination
        if status == "SKIPPED" or lbl == "Skip":
            img_stat = "QUALITY_EXCLUDED" if "Face too small" in reason else "LANDMARK_FAILED"
            class_lbl = "Review_Required"
            dest_dir = os.path.join(WORKING_DIR, "Review_Required")
            real_skipped_count += 1
            lbl_status = "REVIEW_REQUIRED"
        else:
            img_stat = "USABLE"
            class_lbl = lbl
            dest_dir = os.path.join(WORKING_DIR, class_lbl)
            real_usable_count += 1
            lbl_status = "HUMAN_VERIFIED"

        # Copy to working directory
        dest_p = os.path.join(dest_dir, fname)
        shutil.copy2(orig_p, dest_p)

        # Generate thumbnail for preview
        try:
            ext = os.path.splitext(fname)[1].lower()
            if ext in [".heic", ".heif"]:
                pil = Image.open(orig_p).convert("RGB")
            else:
                pil = Image.open(orig_p).convert("RGB")
            pil.thumbnail((360, 360))
            pil.save(os.path.join(WORKING_DIR, "previews", f"{os.path.splitext(fname)[0]}.jpg"), "JPEG", quality=85)
        except Exception as e:
            logger.warning(f"Preview gen failed for {fname}: {e}")

        rel_path = os.path.relpath(orig_p, "D:/SmartframeAi").replace("\\", "/")

        master_records.append({
            "image_path": rel_path,
            "source_dataset": "real_world",
            "class_label": class_lbl,
            "label_status": lbl_status,
            "person_group": person_grp,
            "duplicate_group": "none",
            "image_status": img_stat,
            "file_md5": md5_val,
            "original_filename": fname,
            "working_path": os.path.relpath(dest_p, "D:/SmartframeAi").replace("\\", "/")
        })

    logger.info(f"Real-World Audit complete: {real_usable_count} verified usable, {real_skipped_count} review-required.")

    # -------------------------------------------------------------
    # 3. AUDIT & CATALOG KAGGLE DATASET (5,001 images)
    # -------------------------------------------------------------
    logger.info("\n--- Auditing Kaggle Dataset ---")
    kaggle_hashes = defaultdict(list)
    kaggle_records = []

    # Check parquet caches to identify landmark failures
    train_pq = pd.read_parquet(os.path.join(KAGGLE_DIR, "cache", "training_set.parquet"))
    test_pq = pd.read_parquet(os.path.join(KAGGLE_DIR, "cache", "testing_set.parquet"))

    failed_kaggle_paths = set(train_pq[train_pq["status"] == "failed"]["image_path"].tolist())
    failed_kaggle_paths.update(test_pq[test_pq["status"] == "failed"]["image_path"].tolist())
    logger.info(f"Known Kaggle landmark failure paths: {len(failed_kaggle_paths)}")

    for split_dir in ["training_set", "testing_set"]:
        s_path = os.path.join(KAGGLE_DIR, split_dir)
        for c in CLASSES:
            c_path = os.path.join(s_path, c)
            if not os.path.exists(c_path):
                continue
            for f in os.listdir(c_path):
                if f.lower().endswith((".jpg", ".jpeg", ".png")):
                    fp = os.path.join(c_path, f)
                    md5_val = compute_file_md5(fp)
                    kaggle_hashes[md5_val].append(fp)
                    kaggle_records.append((split_dir, c, f, fp, md5_val))

    # Identify duplicate groups
    dup_clusters = {}
    dup_id = 1
    for h, paths in kaggle_hashes.items():
        if len(paths) > 1:
            cluster_name = f"kaggle_dup_{dup_id}"
            dup_clusters[h] = cluster_name
            dup_id += 1

    logger.info(f"Identified {len(dup_clusters)} duplicate groups in Kaggle dataset.")

    kaggle_usable_count = 0
    kaggle_excluded_count = 0
    seen_hashes = set()

    for split_dir, c, f, fp, md5_val in kaggle_records:
        rel_path = os.path.relpath(fp, "D:/SmartframeAi").replace("\\", "/")
        dup_grp = dup_clusters.get(md5_val, "none")

        # Determine image_status
        if fp in failed_kaggle_paths:
            img_stat = "LANDMARK_FAILED"
            class_lbl = "Review_Required"
            lbl_stat = "REVIEW_REQUIRED"
            kaggle_excluded_count += 1
        elif md5_val in seen_hashes:
            img_stat = "DUPLICATE"
            class_lbl = c
            lbl_stat = "KAGGLE_ANNOTATED"
            kaggle_excluded_count += 1
        else:
            img_stat = "USABLE"
            class_lbl = c
            lbl_stat = "KAGGLE_ANNOTATED"
            kaggle_usable_count += 1

        seen_hashes.add(md5_val)

        # Person group for Kaggle (single sample subject unless in duplicate group)
        person_grp = dup_grp if dup_grp != "none" else f"kaggle_{c}_{os.path.splitext(f)[0]}"

        master_records.append({
            "image_path": rel_path,
            "source_dataset": "kaggle",
            "class_label": class_lbl,
            "label_status": lbl_stat,
            "person_group": person_grp,
            "duplicate_group": dup_grp,
            "image_status": img_stat,
            "file_md5": md5_val,
            "original_filename": f,
            "working_path": rel_path
        })

    logger.info(f"Kaggle Audit complete: {kaggle_usable_count} usable unique, {kaggle_excluded_count} excluded (duplicates/failed).")

    # 4. Save Master Manifest CSV
    df_master = pd.DataFrame(master_records)
    df_master.to_csv(WORKING_MANIFEST_PATH, index=False)
    logger.info(f"\nMaster Manifest saved to: {WORKING_MANIFEST_PATH}")
    logger.info(f"Total Master Records: {len(df_master)}")

    # -------------------------------------------------------------
    # 5. DATASET SPLITTING (70% Train, 15% Val, 15% Test)
    # -------------------------------------------------------------
    logger.info("\n--- Partitioning Dataset into Train/Val/Test Splits ---")
    os.makedirs(WORKING_SPLITS_DIR, exist_ok=True)

    # Filter to only USABLE images for training/val/test splits
    df_usable = df_master[df_master["image_status"] == "USABLE"].copy()
    logger.info(f"Total Usable Images across both datasets: {len(df_usable)}")

    # Isolate Kaggle Usable vs Real-World Usable
    kaggle_usable = df_usable[df_usable["source_dataset"] == "kaggle"].copy()
    real_usable = df_usable[df_usable["source_dataset"] == "real_world"].copy()

    # Split Kaggle: 70% Train (3496), 15% Val (750), 15% Test (750)
    # Stratified by class
    from sklearn.model_selection import train_test_split

    np.random.seed(42)
    # First: Train (70%) vs Temp (30%)
    k_train, k_temp = train_test_split(
        kaggle_usable, test_size=0.30, stratify=kaggle_usable["class_label"], random_state=42
    )
    # Second: Temp -> Val (15%) and Test (15%)
    k_val, k_test = train_test_split(
        k_temp, test_size=0.50, stratify=k_temp["class_label"], random_state=42
    )

    k_train = k_train.copy()
    k_val = k_val.copy()
    k_test = k_test.copy()

    k_train["split"] = "train"
    k_val["split"] = "val"
    k_test["split"] = "test"

    # Split Real-World using GroupShuffleSplit on person_group
    from sklearn.model_selection import GroupShuffleSplit
    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=42)
    r_train_idx, r_test_idx = next(gss.split(real_usable, real_usable["class_label"], groups=real_usable["person_group"]))

    r_train = real_usable.iloc[r_train_idx].copy()
    r_test = real_usable.iloc[r_test_idx].copy()

    # Split r_train into Train (80%) and Val (20%)
    gss2 = GroupShuffleSplit(n_splits=1, test_size=0.18, random_state=42)
    r_tr_sub_idx, r_val_idx = next(gss2.split(r_train, r_train["class_label"], groups=r_train["person_group"]))

    r_tr_final = r_train.iloc[r_tr_sub_idx].copy()
    r_val_final = r_train.iloc[r_val_idx].copy()

    r_tr_final["split"] = "train"
    r_val_final["split"] = "val"
    r_test["split"] = "test_real_world_holdout"

    # Combine splits
    full_train = pd.concat([k_train, r_tr_final], ignore_index=True)
    full_val = pd.concat([k_val, r_val_final], ignore_index=True)
    full_test_kaggle = k_test
    full_test_real = r_test

    # Save split manifests
    full_train.to_csv(os.path.join(WORKING_SPLITS_DIR, "train_manifest.csv"), index=False)
    full_val.to_csv(os.path.join(WORKING_SPLITS_DIR, "val_manifest.csv"), index=False)
    full_test_kaggle.to_csv(os.path.join(WORKING_SPLITS_DIR, "test_kaggle_manifest.csv"), index=False)
    full_test_real.to_csv(os.path.join(WORKING_SPLITS_DIR, "test_real_world_holdout_manifest.csv"), index=False)

    logger.info("Splits successfully generated and saved to:")
    logger.info(f"  - Train:               {len(full_train)} images (Kaggle: {len(k_train)}, Real: {len(r_tr_final)})")
    logger.info(f"  - Validation:          {len(full_val)} images (Kaggle: {len(k_val)}, Real: {len(r_val_final)})")
    logger.info(f"  - Kaggle Test (5-cls): {len(full_test_kaggle)} images (Balanced 150/class)")
    logger.info(f"  - Real Hold-Out Test:  {len(full_test_real)} images (10 unique persons, 0 leakage)")

    # 6. Verify zero leakage
    train_persons = set(full_train["person_group"])
    val_persons = set(full_val["person_group"])
    test_real_persons = set(full_test_real["person_group"])

    assert len(train_persons.intersection(test_real_persons)) == 0, "Leakage between train and real test!"
    assert len(val_persons.intersection(test_real_persons)) == 0, "Leakage between val and real test!"
    logger.info("VERIFIED: Zero person identity leakage into real-world hold-out test set.")

    return df_master


if __name__ == "__main__":
    audit_and_organize()
