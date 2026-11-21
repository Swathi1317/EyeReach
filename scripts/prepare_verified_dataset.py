"""
SmartFrame AI - Verified Dataset Preparation Script
Takes verified_labels.csv (exported from review_tool.html or manually edited)
and organizes verified images into stratified train/val/test splits:

Classified_Dataset/
    verified_splits/
        train/ (70%)
            Heart/ Oblong/ Oval/ Round/ Square/
        val/ (15%)
            Heart/ Oblong/ Oval/ Round/ Square/
        test/ (15%)
            Heart/ Oblong/ Oval/ Round/ Square/
"""

import os
import sys
import shutil
import argparse
import logging
import pandas as pd
from sklearn.model_selection import StratifiedShuffleSplit

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("prepare_splits")

VALID_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]

def prepare_splits(
    verified_csv_path: str,
    source_classified_dir: str,
    output_splits_dir: str,
    train_ratio: float = 0.70,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    random_state: int = 42
):
    if not os.path.exists(verified_csv_path):
        logger.error(f"Verified labels CSV not found: {verified_csv_path}")
        logger.info("Please use review_tool.html to review and export verified_labels.csv first.")
        return

    df = pd.read_csv(verified_csv_path)
    logger.info(f"Loaded {len(df)} rows from {verified_csv_path}")

    # Determine target label column
    col = "verified_face_shape" if "verified_face_shape" in df.columns else "predicted_face_shape"

    # Filter out DISCARD or invalid entries
    df_valid = df[df[col].isin(VALID_CLASSES)].copy()
    logger.info(f"Retained {len(df_valid)} usable images classified into: {VALID_CLASSES}")
    logger.info(f"Filtered out {len(df) - len(df_valid)} discarded/unusable entries.")

    if len(df_valid) < 10:
        logger.error("Not enough valid samples to construct train/val/test splits.")
        return

    # Check class distribution
    class_counts = df_valid[col].value_counts()
    logger.info("Class distribution for training preparation:")
    for c, cnt in class_counts.items():
        logger.info(f"  {c}: {cnt}")

    # Two-step stratified split: Train (70%) vs Temp (30%), then Temp -> Val (15%) / Test (15%)
    sss1 = StratifiedShuffleSplit(n_splits=1, test_size=(1.0 - train_ratio), random_state=random_state)
    train_idx, temp_idx = next(sss1.split(df_valid, df_valid[col]))

    df_train = df_valid.iloc[train_idx].copy()
    df_temp = df_valid.iloc[temp_idx].copy()

    val_test_ratio = test_ratio / (val_ratio + test_ratio)
    sss2 = StratifiedShuffleSplit(n_splits=1, test_size=val_test_ratio, random_state=random_state)
    val_idx, test_idx = next(sss2.split(df_temp, df_temp[col]))

    df_val = df_temp.iloc[val_idx].copy()
    df_test = df_temp.iloc[test_idx].copy()

    logger.info(f"Split sizes: Train={len(df_train)}, Val={len(df_val)}, Test={len(df_test)}")

    splits = {
        "train": df_train,
        "val": df_val,
        "test": df_test
    }

    # Helper to find image file in Classified_Dataset subfolders
    def find_image_path(fname):
        for root, _, files in os.walk(source_classified_dir):
            if fname in files:
                return os.path.join(root, fname)
        # Fallback to Dataset root
        orig = os.path.join("D:/SmartframeAi/Data/Dataset", fname)
        if os.path.exists(orig):
            return orig
        return None

    # Create directory structure and copy files
    for split_name, split_df in splits.items():
        for c in VALID_CLASSES:
            os.makedirs(os.path.join(output_splits_dir, split_name, c), exist_ok=True)

        copied = 0
        for _, row in split_df.iterrows():
            fname = row["image_filename"]
            cls = row[col]
            src = find_image_path(fname)
            if src and os.path.exists(src):
                dst = os.path.join(output_splits_dir, split_name, cls, fname)
                shutil.copy2(src, dst)
                copied += 1
            else:
                logger.warning(f"Could not locate image file for copying: {fname}")

        logger.info(f"Organized {copied} images into split: {split_name}")

    logger.info(f"Verified dataset successfully prepared at: {output_splits_dir}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare verified dataset splits for training")
    parser.add_argument("--verified_csv", default="D:/SmartframeAi/Data/Classified_Dataset/verified_labels.csv")
    parser.add_argument("--source_dir", default="D:/SmartframeAi/Data/Classified_Dataset")
    parser.add_argument("--output_dir", default="D:/SmartframeAi/Data/Classified_Dataset/verified_splits")

    args = parser.parse_args()
    prepare_splits(args.verified_csv, args.source_dir, args.output_dir)
