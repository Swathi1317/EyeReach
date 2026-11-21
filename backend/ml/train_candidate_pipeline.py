"""
SmartFrame AI - Five-Class Face Shape Model Training & Evaluation Pipeline
Trains Random Forest and XGBoost candidates on the verified training split.
Performs model selection strictly on the validation split.
Evaluates final candidate model on untouched Kaggle test set and Real-World holdout set.
Saves model candidate artifact to: backend/ml/models/face_shape_model_candidate.joblib
"""

import os
import sys
import json
import logging
import joblib
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    classification_report,
    confusion_matrix
)
from sklearn.model_selection import ParameterGrid
from xgboost import XGBClassifier

# Add project root to sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

from backend.ml.build_features import FaceFeatureExtractor, FEATURE_NAMES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("train_candidate_pipeline")

WORKING_DIR = "D:/SmartframeAi/Data/Working_Dataset"
SPLITS_DIR = os.path.join(WORKING_DIR, "splits")
FEATURES_CACHE_DIR = os.path.join(WORKING_DIR, "features_cache")
MODELS_DIR = os.path.join(PROJECT_ROOT, "backend", "ml", "models")
RAW_CACHE_DIR = os.path.join(PROJECT_ROOT, "backend", "data", "cache")

CANDIDATE_MODEL_PATH = os.path.join(MODELS_DIR, "face_shape_model_candidate.joblib")
PRODUCTION_MODEL_PATH = os.path.join(MODELS_DIR, "face_shape_model.joblib")
REPORT_PATH = os.path.join(MODELS_DIR, "candidate_evaluation_report.json")
KAGGLE_CM_PATH = os.path.join(MODELS_DIR, "candidate_confusion_matrix_kaggle.png")
REAL_CM_PATH = os.path.join(MODELS_DIR, "candidate_confusion_matrix_real_holdout.png")

TARGET_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]


def load_cached_raw_features():
    """Loads existing precomputed features for Kaggle images if available."""
    raw_dict = {}
    for fname in ["training_set.parquet", "testing_set.parquet"]:
        p = os.path.join(RAW_CACHE_DIR, fname)
        if os.path.exists(p):
            df = pd.read_parquet(p)
            for _, r in df.iterrows():
                base_fn = os.path.basename(r["image_path"])
                if r.get("status", "success") == "success":
                    raw_dict[base_fn] = {feat: float(r[feat]) for feat in FEATURE_NAMES if feat in r and pd.notnull(r[feat])}
    logger.info(f"Loaded {len(raw_dict)} precomputed Kaggle feature profiles.")
    return raw_dict


def build_split_features(split_name: str, manifest_path: str, raw_cache: dict) -> pd.DataFrame:
    """Builds or loads feature dataframe for a split."""
    os.makedirs(FEATURES_CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(FEATURES_CACHE_DIR, f"{split_name}_features.parquet")
    if os.path.exists(cache_file):
        logger.info(f"Loading cached features for split '{split_name}' from {cache_file}")
        return pd.read_parquet(cache_file)

    logger.info(f"Extracting features for split '{split_name}' from {manifest_path}...")
    df_manifest = pd.read_csv(manifest_path)
    extractor = FaceFeatureExtractor()

    records = []
    total = len(df_manifest)
    extracted_fresh = 0
    used_cache = 0
    failed = 0

    for idx, row in df_manifest.iterrows():
        orig_fn = row["original_filename"]
        cls_lbl = row["class_label"]
        src = row["source_dataset"]
        w_path = row.get("working_path", "")
        raw_p = row.get("image_path", "")

        # Try to resolve physical image path
        img_path = w_path if os.path.exists(w_path) else None
        if not img_path:
            cand = os.path.join("D:/SmartframeAi", raw_p.replace("/", "\\"))
            if os.path.exists(cand):
                img_path = cand
            else:
                cand2 = os.path.join("D:/SmartframeAi/Data/Dataset", orig_fn)
                if os.path.exists(cand2):
                    img_path = cand2

        features = None
        # Check raw cache first if it's Kaggle
        if src == "kaggle" and orig_fn in raw_cache and len(raw_cache[orig_fn]) == len(FEATURE_NAMES):
            features = raw_cache[orig_fn]
            used_cache += 1
        elif img_path and os.path.exists(img_path):
            features = extractor.process_image(img_path)
            if features:
                extracted_fresh += 1
            else:
                failed += 1
        else:
            logger.warning(f"File not found for {orig_fn}")
            failed += 1

        rec = {
            "image_filename": orig_fn,
            "source_dataset": src,
            "class_label": cls_lbl,
            "person_group": row.get("person_group", "none"),
            "duplicate_group": row.get("duplicate_group", "unique"),
            "image_path": img_path or raw_p,
            "status": "success" if features is not None else "failed"
        }
        if features:
            for feat in FEATURE_NAMES:
                rec[feat] = float(features[feat])
        else:
            for feat in FEATURE_NAMES:
                rec[feat] = np.nan

        records.append(rec)

    df_out = pd.DataFrame(records)
    df_out.to_parquet(cache_file)
    logger.info(f"Split '{split_name}': {len(df_out)} total (Cached: {used_cache}, Fresh: {extracted_fresh}, Failed: {failed}). Saved to {cache_file}")
    return df_out


def train_and_evaluate():
    logger.info("=================================================================")
    logger.info("SMARTFRAME AI: FIVE-CLASS MODEL TRAINING & VALIDATION PIPELINE")
    logger.info("=================================================================")

    # Safety checks
    if not os.path.exists(PRODUCTION_MODEL_PATH):
        logger.warning(f"Production model not found at {PRODUCTION_MODEL_PATH}")
    else:
        prod_mtime = os.path.getmtime(PRODUCTION_MODEL_PATH)
        logger.info(f"Production model exists. Preservation mtime: {datetime.fromtimestamp(prod_mtime)}")

    # 1. Load feature caches for splits
    raw_cache = load_cached_raw_features()

    train_manifest = os.path.join(SPLITS_DIR, "train_manifest.csv")
    val_manifest = os.path.join(SPLITS_DIR, "val_manifest.csv")
    test_kaggle_manifest = os.path.join(SPLITS_DIR, "test_kaggle_manifest.csv")
    test_real_manifest = os.path.join(SPLITS_DIR, "test_real_world_holdout_manifest.csv")

    df_train = build_split_features("train", train_manifest, raw_cache)
    df_val = build_split_features("val", val_manifest, raw_cache)
    df_test_k = build_split_features("test_kaggle", test_kaggle_manifest, raw_cache)
    df_test_r = build_split_features("test_real_world_holdout", test_real_manifest, raw_cache)

    # Filter successful rows
    df_train_clean = df_train[df_train["status"] == "success"].copy().reset_index(drop=True)
    df_val_clean = df_val[df_val["status"] == "success"].copy().reset_index(drop=True)
    df_test_k_clean = df_test_k[df_test_k["status"] == "success"].copy().reset_index(drop=True)
    df_test_r_clean = df_test_r[df_test_r["status"] == "success"].copy().reset_index(drop=True)

    logger.info(f"Clean samples: Train={len(df_train_clean)}, Val={len(df_val_clean)}, Test_Kaggle={len(df_test_k_clean)}, Test_Real={len(df_test_r_clean)}")

    # Prepare feature matrices
    X_train = df_train_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_train_raw = df_train_clean["class_label"].to_numpy(dtype=str)

    X_val = df_val_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_val_raw = df_val_clean["class_label"].to_numpy(dtype=str)

    X_test_k = df_test_k_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_test_k_raw = df_test_k_clean["class_label"].to_numpy(dtype=str)

    X_test_r = df_test_r_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_test_r_raw = df_test_r_clean["class_label"].to_numpy(dtype=str)

    # Encode target labels
    le = LabelEncoder()
    le.fit(TARGET_CLASSES)
    y_train = le.transform(y_train_raw)
    y_val = le.transform(y_val_raw)
    y_test_k = le.transform(y_test_k_raw)
    y_test_r = le.transform(y_test_r_raw)

    logger.info(f"Target classes: {le.classes_.tolist()}")
    logger.info(f"Train class distribution:\n{pd.Series(y_train_raw).value_counts()}")
    logger.info(f"Val class distribution:\n{pd.Series(y_val_raw).value_counts()}")

    # 2. Define Model Configurations & Hyperparameter Grids
    models_config = {
        "RandomForest": {
            "base_pipeline": Pipeline([
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(random_state=42))
            ]),
            "grid": {
                "clf__n_estimators": [100, 200, 300],
                "clf__max_depth": [None, 10, 15],
                "clf__min_samples_split": [2, 5],
                "clf__class_weight": [None, "balanced"]
            }
        },
        "XGBoost": {
            "base_pipeline": Pipeline([
                ("scaler", StandardScaler()),
                ("clf", XGBClassifier(random_state=42, eval_metric="mlogloss"))
            ]),
            "grid": {
                "clf__n_estimators": [100, 200],
                "clf__max_depth": [3, 5, 7],
                "clf__learning_rate": [0.03, 0.1],
                "clf__subsample": [0.8, 1.0]
            }
        }
    }

    # 3. Model Tuning & Selection via Validation Split
    logger.info("\n=================================================================")
    logger.info("MODEL SELECTION ON VALIDATION SPLIT (NO TEST LEAKAGE)")
    logger.info("=================================================================")

    tuning_results = {}
    best_overall = {
        "name": None,
        "pipeline": None,
        "params": None,
        "val_macro_f1": -1.0,
        "val_accuracy": -1.0,
        "val_metrics": {}
    }

    for model_name, cfg in models_config.items():
        logger.info(f"--- Tuning {model_name} ---")
        grid = list(ParameterGrid(cfg["grid"]))
        logger.info(f"Evaluating {len(grid)} hyperparameter combinations on Validation Split...")

        best_m_score = -1.0
        best_m_params = None
        best_m_pipe = None
        best_m_metrics = None

        for idx_g, params in enumerate(grid):
            pipe = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", cfg["base_pipeline"].named_steps["clf"].__class__(**{
                    k.replace("clf__", ""): v for k, v in params.items()
                }))
            ])

            # Fit strictly on train set
            pipe.fit(X_train, y_train)

            # Evaluate on validation set
            y_val_pred = pipe.predict(X_val)
            val_acc = accuracy_score(y_val, y_val_pred)
            p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(
                y_val, y_val_pred, average="macro", zero_division=0
            )

            if f1_macro > best_m_score:
                best_m_score = f1_macro
                best_m_params = params
                best_m_pipe = pipe
                best_m_metrics = {
                    "accuracy": float(val_acc),
                    "macro_f1": float(f1_macro),
                    "macro_precision": float(p_macro),
                    "macro_recall": float(r_macro)
                }

        tuning_results[model_name] = {
            "best_params": best_m_params,
            "val_metrics": best_m_metrics
        }
        logger.info(f"Best {model_name} on Val -> Macro F1: {best_m_metrics['macro_f1']:.4f}, Accuracy: {best_m_metrics['accuracy']:.4f}")
        logger.info(f"Params: {best_m_params}")

        if best_m_metrics["macro_f1"] > best_overall["val_macro_f1"]:
            best_overall["name"] = model_name
            best_overall["pipeline"] = best_m_pipe
            best_overall["params"] = best_m_params
            best_overall["val_macro_f1"] = best_m_metrics["macro_f1"]
            best_overall["val_accuracy"] = best_m_metrics["accuracy"]
            best_overall["val_metrics"] = best_m_metrics

    logger.info(f"\nWINNING MODEL SELECTED: {best_overall['name']} with Validation Macro F1 = {best_overall['val_macro_f1']:.4f}")

    selected_pipeline = best_overall["pipeline"]

    # 4. Evaluate on Untouched Kaggle Test Set
    logger.info("\n=================================================================")
    logger.info("EVALUATING SELECTED MODEL ON UNTOUCHED KAGGLE TEST SET (750 samples)")
    logger.info("=================================================================")
    y_test_k_pred = selected_pipeline.predict(X_test_k)
    y_test_k_pred_labels = le.inverse_transform(y_test_k_pred)

    kaggle_acc = accuracy_score(y_test_k, y_test_k_pred)
    k_p_macro, k_r_macro, k_f1_macro, _ = precision_recall_fscore_support(
        y_test_k, y_test_k_pred, average="macro", zero_division=0
    )
    k_p_weighted, k_r_weighted, k_f1_weighted, _ = precision_recall_fscore_support(
        y_test_k, y_test_k_pred, average="weighted", zero_division=0
    )

    p_per_class, r_per_class, f1_per_class, supp_per_class = precision_recall_fscore_support(
        y_test_k, y_test_k_pred, labels=range(len(TARGET_CLASSES)), zero_division=0
    )

    kaggle_report = classification_report(
        y_test_k_raw, y_test_k_pred_labels, target_names=TARGET_CLASSES, digits=4
    )
    logger.info(f"Kaggle Test Accuracy: {kaggle_acc:.4f}")
    logger.info(f"Kaggle Test Macro F1: {k_f1_macro:.4f}")
    logger.info(f"Kaggle Test Macro Precision: {k_p_macro:.4f}")
    logger.info(f"Kaggle Test Macro Recall: {k_r_macro:.4f}")
    logger.info(f"\nKaggle Test Classification Report:\n{kaggle_report}")

    cm_kaggle = confusion_matrix(y_test_k_raw, y_test_k_pred_labels, labels=TARGET_CLASSES)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm_kaggle, annot=True, fmt="d", cmap="Blues", xticklabels=TARGET_CLASSES, yticklabels=TARGET_CLASSES)
    plt.title(f"Confusion Matrix (Kaggle Test Set, N={len(df_test_k_clean)})\nModel: {best_overall['name']}")
    plt.xlabel("Predicted Face Shape")
    plt.ylabel("Actual Face Shape")
    plt.tight_layout()
    plt.savefig(KAGGLE_CM_PATH, dpi=180)
    plt.close()
    logger.info(f"Saved Kaggle confusion matrix to: {KAGGLE_CM_PATH}")

    # 5. Evaluate on Real-World Holdout Set
    logger.info("\n=================================================================")
    logger.info("EVALUATING ON REAL-WORLD HOLDOUT SET (11 samples)")
    logger.info("=================================================================")
    y_test_r_pred = selected_pipeline.predict(X_test_r)
    y_test_r_pred_labels = le.inverse_transform(y_test_r_pred)

    real_acc = accuracy_score(y_test_r, y_test_r_pred)
    logger.info(f"Real-World Holdout Accuracy: {real_acc:.4f} ({int(real_acc * len(y_test_r))}/{len(y_test_r)})")
    
    real_results_df = pd.DataFrame({
        "image_filename": df_test_r_clean["image_filename"],
        "actual_label": y_test_r_raw,
        "predicted_label": y_test_r_pred_labels,
        "match": y_test_r_raw == y_test_r_pred_labels
    })
    logger.info(f"\nReal-World Sample Predictions:\n{real_results_df.to_string(index=False)}")

    cm_real = confusion_matrix(y_test_r_raw, y_test_r_pred_labels, labels=TARGET_CLASSES)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm_real, annot=True, fmt="d", cmap="Oranges", xticklabels=TARGET_CLASSES, yticklabels=TARGET_CLASSES)
    plt.title(f"Confusion Matrix (Real-World Holdout, N={len(df_test_r_clean)})\nNote: Contains only Oval & Round")
    plt.xlabel("Predicted Face Shape")
    plt.ylabel("Actual Face Shape")
    plt.tight_layout()
    plt.savefig(REAL_CM_PATH, dpi=180)
    plt.close()
    logger.info(f"Saved Real-World confusion matrix to: {REAL_CM_PATH}")

    # 6. Save Candidate Model Artifact (Preserving Production Model)
    logger.info("\n=================================================================")
    logger.info("SAVING CANDIDATE MODEL ARTIFACT")
    logger.info("=================================================================")
    candidate_artifact = {
        "pipeline": selected_pipeline,
        "label_encoder": le,
        "feature_cols": FEATURE_NAMES,
        "classes": TARGET_CLASSES,
        "model_name": best_overall["name"],
        "version": "candidate-5class-1.0",
        "training_samples": len(X_train),
        "validation_macro_f1": best_overall["val_macro_f1"],
        "validation_accuracy": best_overall["val_accuracy"],
        "best_params": best_overall["params"],
        "created_at": datetime.now().isoformat()
    }

    joblib.dump(candidate_artifact, CANDIDATE_MODEL_PATH)
    logger.info(f"Candidate model successfully saved to: {CANDIDATE_MODEL_PATH}")

    # Assert production model untouched
    if os.path.exists(PRODUCTION_MODEL_PATH):
        post_mtime = os.path.getmtime(PRODUCTION_MODEL_PATH)
        assert prod_mtime == post_mtime, "SAFETY VIOLATION: Production model was modified!"
        logger.info("[CONFIRMED] Production model 'face_shape_model.joblib' is 100% UNTOUCHED.")

    # 7. Save Comprehensive Evaluation Report
    per_class_metrics = {}
    for i, c in enumerate(TARGET_CLASSES):
        per_class_metrics[c] = {
            "precision": float(p_per_class[i]),
            "recall": float(r_per_class[i]),
            "f1_score": float(f1_per_class[i]),
            "support": int(supp_per_class[i])
        }

    evaluation_report = {
        "timestamp": datetime.now().isoformat(),
        "selected_model": best_overall["name"],
        "best_hyperparameters": best_overall["params"],
        "dataset_splits": {
            "train": len(df_train_clean),
            "val": len(df_val_clean),
            "test_kaggle": len(df_test_k_clean),
            "test_real_world_holdout": len(df_test_r_clean)
        },
        "model_comparison_validation": tuning_results,
        "kaggle_test_evaluation": {
            "accuracy": float(kaggle_acc),
            "macro_precision": float(k_p_macro),
            "macro_recall": float(k_r_macro),
            "macro_f1": float(k_f1_macro),
            "weighted_f1": float(k_f1_weighted),
            "per_class": per_class_metrics,
            "confusion_matrix": cm_kaggle.tolist(),
            "classes": TARGET_CLASSES
        },
        "real_world_holdout_evaluation": {
            "sample_count": len(df_test_r_clean),
            "available_classes": ["Oval", "Round"],
            "accuracy": float(real_acc),
            "predictions": real_results_df.to_dict(orient="records"),
            "limitation_notice": (
                "The real-world holdout set currently only evaluates Oval and Round face shapes. "
                "Real-world generalization for Heart, Oblong, and Square cannot be determined "
                "until verified real-world samples for those classes are collected."
            )
        }
    }

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(evaluation_report, f, indent=2)
    logger.info(f"Evaluation report successfully saved to: {REPORT_PATH}")

    logger.info("\nPipeline execution complete!")
    return evaluation_report


if __name__ == "__main__":
    train_and_evaluate()
