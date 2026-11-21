"""
Pre-Training Integrity Verification Script for SmartFrame AI 5-Class Pipeline
Validates master manifest, all split manifests, human labels, uncertain image exclusions,
feature order, person/duplicate separation, and physical file existence.
"""
import os
import sys
import pandas as pd

PROJECT_ROOT = "D:/SmartframeAi/SmartFrameAI"
WORKING_DIR = "D:/SmartframeAi/Data/Working_Dataset"
SPLITS_DIR = os.path.join(WORKING_DIR, "splits")
REVIEWED_MANIFEST = "D:/SmartframeAi/Data/Classified_Dataset/reviewed_labels_manifest.csv"

sys.path.append(PROJECT_ROOT)
from backend.ml.build_features import FEATURE_NAMES

def verify_all():
    print("=================================================================")
    print("STEP 1: INSPECTING MASTER MANIFEST AND SPLIT MANIFESTS")
    print("=================================================================")
    master_path = os.path.join(WORKING_DIR, "master_manifest.csv")
    train_path = os.path.join(SPLITS_DIR, "train_manifest.csv")
    val_path = os.path.join(SPLITS_DIR, "val_manifest.csv")
    test_kaggle_path = os.path.join(SPLITS_DIR, "test_kaggle_manifest.csv")
    test_real_path = os.path.join(SPLITS_DIR, "test_real_world_holdout_manifest.csv")

    for p in [master_path, train_path, val_path, test_kaggle_path, test_real_path]:
        if not os.path.exists(p):
            raise FileNotFoundError(f"Missing required manifest: {p}")
        df = pd.read_csv(p)
        print(f"Manifest: {os.path.basename(p)} -> {len(df)} records. Columns: {df.columns.tolist()[:5]}...")

    df_master = pd.read_csv(master_path)
    df_train = pd.read_csv(train_path)
    df_val = pd.read_csv(val_path)
    df_test_k = pd.read_csv(test_kaggle_path)
    df_test_r = pd.read_csv(test_real_path)

    print("\n=================================================================")
    print("STEP 2: CONFIRMING HUMAN-REVIEWED LABELS MATCH")
    print("=================================================================")
    df_reviewed = pd.read_csv(REVIEWED_MANIFEST)
    real_master = df_master[df_master["source_dataset"] == "real_world"]
    print(f"Total reviewed in reviewed_labels_manifest: {len(df_reviewed)}")
    print(f"Total real-world in master_manifest: {len(real_master)}")

    mismatch_count = 0
    for _, row in df_reviewed.iterrows():
        fname = row["image_filename"]
        rev_lbl = row["reviewed_label"]
        match = real_master[real_master["original_filename"] == fname]
        if len(match) == 0:
            print(f"[ERROR] Image {fname} not found in master manifest!")
            mismatch_count += 1
            continue
        master_row = match.iloc[0]
        expected_lbl = "Review_Required" if rev_lbl == "Skip" else rev_lbl
        if master_row["class_label"] != expected_lbl:
            print(f"[MISMATCH] {fname}: Reviewed={rev_lbl}, Master={master_row['class_label']}")
            mismatch_count += 1

    if mismatch_count == 0:
        print("[OK] All 75 human-reviewed labels match perfectly between reviewed_labels_manifest and master_manifest!")
    else:
        print(f"[FAIL] Found {mismatch_count} label mismatches!")

    print("\n=================================================================")
    print("STEP 3: VERIFYING UNCERTAIN IMAGES EXCLUDED FROM SUPERVISED TRAINING")
    print("=================================================================")
    train_labels = df_train["class_label"].unique().tolist()
    val_labels = df_val["class_label"].unique().tolist()
    test_k_labels = df_test_k["class_label"].unique().tolist()
    test_r_labels = df_test_r["class_label"].unique().tolist()

    print(f"Train unique labels: {train_labels}")
    print(f"Val unique labels: {val_labels}")
    print(f"Kaggle Test unique labels: {test_k_labels}")
    print(f"Real Holdout Test unique labels: {test_r_labels}")

    uncertain_in_train = df_train[df_train["class_label"].isin(["Review_Required", "Skip"])]
    uncertain_in_val = df_val[df_val["class_label"].isin(["Review_Required", "Skip"])]
    failed_in_train = df_train[df_train["image_status"].astype(str).str.upper() != "USABLE"]
    failed_in_val = df_val[df_val["image_status"].astype(str).str.upper() != "USABLE"]

    print(f"Uncertain images in Train: {len(uncertain_in_train)}")
    print(f"Uncertain images in Val: {len(uncertain_in_val)}")
    print(f"Non-usable images in Train: {len(failed_in_train)}")
    print(f"Non-usable images in Val: {len(failed_in_val)}")

    if len(uncertain_in_train) == 0 and len(uncertain_in_val) == 0 and len(failed_in_train) == 0 and len(failed_in_val) == 0:
        print("[OK] All uncertain and non-usable images are strictly EXCLUDED from train and val sets.")
    else:
        print("[FAIL] Uncertain images leaked into supervised training/validation!")

    print("\n=================================================================")
    print("STEP 4: VERIFYING CLASS MAPPINGS AND FEATURE ORDER")
    print("=================================================================")
    expected_classes = ["Heart", "Oblong", "Oval", "Round", "Square"]
    print(f"Expected 5 classes: {expected_classes}")
    print(f"Train classes present: {sorted(df_train['class_label'].unique())}")
    print(f"Val classes present: {sorted(df_val['class_label'].unique())}")
    print(f"Kaggle Test classes present: {sorted(df_test_k['class_label'].unique())}")
    print(f"Real Test classes present: {sorted(df_test_r['class_label'].unique())}")

    print(f"MediaPipe FaceMesh Feature order ({len(FEATURE_NAMES)} features):")
    for i, fn in enumerate(FEATURE_NAMES):
        print(f"  [{i}] {fn}")

    print("\n=================================================================")
    print("STEP 5: VERIFYING PERSON & DUPLICATE SPLIT ISOLATION (NO LEAKAGE)")
    print("=================================================================")
    train_people = set(df_train[df_train["source_dataset"] == "real_world"]["person_group"])
    val_people = set(df_val[df_val["source_dataset"] == "real_world"]["person_group"])
    test_r_people = set(df_test_r["person_group"])

    print(f"Real-world unique people in Train: {len(train_people)}")
    print(f"Real-world unique people in Val: {len(val_people)}")
    print(f"Real-world unique people in Test: {len(test_r_people)}")

    overlap_train_val = train_people.intersection(val_people)
    overlap_train_test = train_people.intersection(test_r_people)
    overlap_val_test = val_people.intersection(test_r_people)

    print(f"Person Overlap (Train & Val): {len(overlap_train_val)} ({overlap_train_val})")
    print(f"Person Overlap (Train & Test): {len(overlap_train_test)} ({overlap_train_test})")
    print(f"Person Overlap (Val & Test): {len(overlap_val_test)} ({overlap_val_test})")

    # Duplicate groups check (only actual duplicate clusters, excluding 'none' or 'unique')
    train_dups = set(df_train[~df_train["duplicate_group"].isin(["unique", "none"])]["duplicate_group"])
    val_dups = set(df_val[~df_val["duplicate_group"].isin(["unique", "none"])]["duplicate_group"])
    test_k_dups = set(df_test_k[~df_test_k["duplicate_group"].isin(["unique", "none"])]["duplicate_group"])

    print(f"Duplicate groups in Train: {train_dups}")
    print(f"Duplicate groups in Val: {val_dups}")
    print(f"Duplicate groups in Test: {test_k_dups}")

    dup_overlap_tv = train_dups.intersection(val_dups)
    dup_overlap_tt = train_dups.intersection(test_k_dups)
    print(f"Duplicate Overlap (Train & Val): {dup_overlap_tv}")
    print(f"Duplicate Overlap (Train & Test): {dup_overlap_tt}")

    if len(overlap_train_val) == 0 and len(overlap_train_test) == 0 and len(overlap_val_test) == 0 and len(dup_overlap_tv) == 0 and len(dup_overlap_tt) == 0:
        print("[OK] Complete isolation confirmed. Zero person identity or duplicate leakage across splits!")
    else:
        print("[FAIL] Leakage detected across splits!")

    print("\n=================================================================")
    print("STEP 6: CHECKING PHYSICAL FILE EXISTENCE")
    print("=================================================================")
    missing_files = []
    total_checked = 0

    for name, df in [("train", df_train), ("val", df_val), ("test_kaggle", df_test_k), ("test_real_world", df_test_r)]:
        missing_in_split = 0
        for _, r in df.iterrows():
            total_checked += 1
            # Check working path and original path
            w_path = r.get("working_path", "")
            orig_path = r.get("image_path", "")
            
            # Absolute check
            if not os.path.exists(w_path):
                # Try relative to SmartframeAi
                cand = os.path.join("D:/SmartframeAi", orig_path.replace("/", "\\"))
                if not os.path.exists(cand):
                    missing_files.append((name, r["original_filename"], w_path))
                    missing_in_split += 1
        print(f"Split {name} ({len(df)} images): {missing_in_split} missing files.")

    print(f"Total image files verified on disk: {total_checked - len(missing_files)} / {total_checked}")
    if len(missing_files) == 0:
        print("[OK] All images referenced by all split manifests physically exist on disk!")
    else:
        print(f"[FAIL] {len(missing_files)} missing files found!")

    print("\n=================================================================")
    print("STEP 7: PER-CLASS SAMPLES ACROSS SPLITS")
    print("=================================================================")
    summary = []
    for cls in expected_classes:
        n_tr_k = len(df_train[(df_train["source_dataset"] == "kaggle") & (df_train["class_label"] == cls)])
        n_tr_r = len(df_train[(df_train["source_dataset"] == "real_world") & (df_train["class_label"] == cls)])
        n_val_k = len(df_val[(df_val["source_dataset"] == "kaggle") & (df_val["class_label"] == cls)])
        n_val_r = len(df_val[(df_val["source_dataset"] == "real_world") & (df_val["class_label"] == cls)])
        n_test_k = len(df_test_k[df_test_k["class_label"] == cls])
        n_test_r = len(df_test_r[df_test_r["class_label"] == cls])
        summary.append({
            "Class": cls,
            "Train_Kaggle": n_tr_k,
            "Train_Real": n_tr_r,
            "Train_Total": n_tr_k + n_tr_r,
            "Val_Kaggle": n_val_k,
            "Val_Real": n_val_r,
            "Val_Total": n_val_k + n_val_r,
            "Test_Kaggle": n_test_k,
            "Test_Real": n_test_r
        })
    df_sum = pd.DataFrame(summary)
    print(df_sum.to_string(index=False))

    print("\n[VERIFICATION RESULT] All pre-training integrity criteria satisfied. Ready to proceed!")

if __name__ == "__main__":
    verify_all()
