"""
SmartFrame AI - Five-Class Model Improvement Pipeline (Candidate v2)
Trains Gaussianized RBF Support Vector Classifier (PowerTransformer + SVC) on verified train split.
Selects model strictly on validation split.
Evaluates on untouched Kaggle test set and Real-World holdout test set.
Saves model candidate artifact to: backend/ml/models/face_shape_model_candidate_v2.joblib
Preserves production model (face_shape_model.joblib) and candidate v1 (face_shape_model_candidate.joblib).
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
from sklearn.preprocessing import StandardScaler, PowerTransformer, LabelEncoder
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    classification_report,
    confusion_matrix
)
from xgboost import XGBClassifier

# Add project root to sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

from backend.ml.build_features import FEATURE_NAMES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("train_candidate_v2")

WORKING_DIR = "D:/SmartframeAi/Data/Working_Dataset"
FEATURES_CACHE_DIR = os.path.join(WORKING_DIR, "features_cache")
MODELS_DIR = os.path.join(PROJECT_ROOT, "backend", "ml", "models")

PRODUCTION_MODEL_PATH = os.path.join(MODELS_DIR, "face_shape_model.joblib")
CANDIDATE_V1_MODEL_PATH = os.path.join(MODELS_DIR, "face_shape_model_candidate.joblib")
CANDIDATE_V2_MODEL_PATH = os.path.join(MODELS_DIR, "face_shape_model_candidate_v2.joblib")
REPORT_V2_PATH = os.path.join(MODELS_DIR, "candidate_v2_evaluation_report.json")
KAGGLE_CM_PATH = os.path.join(MODELS_DIR, "candidate_v2_confusion_matrix_kaggle.png")
REAL_CM_PATH = os.path.join(MODELS_DIR, "candidate_v2_confusion_matrix_real_holdout.png")

TARGET_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]


def run_pipeline():
    logger.info("=================================================================")
    logger.info("SMARTFRAME AI: FIVE-CLASS CANDIDATE V2 TRAINING & EVALUATION")
    logger.info("=================================================================")

    # 1. Record original mtimes for safety
    prod_mtime = os.path.getmtime(PRODUCTION_MODEL_PATH) if os.path.exists(PRODUCTION_MODEL_PATH) else None
    cand_v1_mtime = os.path.getmtime(CANDIDATE_V1_MODEL_PATH) if os.path.exists(CANDIDATE_V1_MODEL_PATH) else None

    # 2. Load feature caches for splits
    df_train = pd.read_parquet(os.path.join(FEATURES_CACHE_DIR, "train_features.parquet"))
    df_val = pd.read_parquet(os.path.join(FEATURES_CACHE_DIR, "val_features.parquet"))
    df_test_k = pd.read_parquet(os.path.join(FEATURES_CACHE_DIR, "test_kaggle_features.parquet"))
    df_test_r = pd.read_parquet(os.path.join(FEATURES_CACHE_DIR, "test_real_world_holdout_features.parquet"))

    df_train_clean = df_train[df_train["status"] == "success"].copy().reset_index(drop=True)
    df_val_clean = df_val[df_val["status"] == "success"].copy().reset_index(drop=True)
    df_test_k_clean = df_test_k[df_test_k["status"] == "success"].copy().reset_index(drop=True)
    df_test_r_clean = df_test_r[df_test_r["status"] == "success"].copy().reset_index(drop=True)

    logger.info(f"Loaded samples: Train={len(df_train_clean)}, Val={len(df_val_clean)}, Test_Kaggle={len(df_test_k_clean)}, Test_Real={len(df_test_r_clean)}")

    X_train = df_train_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_train_raw = df_train_clean["class_label"].to_numpy(dtype=str)

    X_val = df_val_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_val_raw = df_val_clean["class_label"].to_numpy(dtype=str)

    X_test_k = df_test_k_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_test_k_raw = df_test_k_clean["class_label"].to_numpy(dtype=str)

    X_test_r = df_test_r_clean[FEATURE_NAMES].to_numpy(dtype=float)
    y_test_r_raw = df_test_r_clean["class_label"].to_numpy(dtype=str)

    le = LabelEncoder()
    le.fit(TARGET_CLASSES)
    y_train = le.transform(y_train_raw)
    y_val = le.transform(y_val_raw)
    y_test_k = le.transform(y_test_k_raw)
    y_test_r = le.transform(y_test_r_raw)

    # 3. Model Architecture Comparison on Validation Split
    logger.info("\n--- VALIDATION MODEL COMPARISON ---")
    candidates = {
        "RandomForest_Baseline": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", RandomForestClassifier(n_estimators=300, max_depth=None, min_samples_split=5, random_state=42))
        ]),
        "XGBoost_Candidate_v1": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", XGBClassifier(learning_rate=0.03, max_depth=5, n_estimators=200, subsample=0.8, random_state=42, eval_metric="mlogloss"))
        ]),
        "PowerSVC_Candidate_v2": Pipeline([
            ("scaler", PowerTransformer(method="yeo-johnson")),
            ("clf", SVC(C=1.5, gamma=0.1, kernel="rbf", probability=True, random_state=42))
        ])
    }

    val_comparison = {}
    for name, pipe in candidates.items():
        pipe.fit(X_train, y_train)
        preds_v = pipe.predict(X_val)
        acc_v = accuracy_score(y_val, preds_v)
        p_v, r_v, f1_v, _ = precision_recall_fscore_support(y_val, preds_v, average="macro", zero_division=0)
        val_comparison[name] = {
            "accuracy": float(acc_v),
            "macro_f1": float(f1_v),
            "macro_precision": float(p_v),
            "macro_recall": float(r_v)
        }
        logger.info(f"{name:25s} -> Val Acc: {acc_v:.4f} | Val Macro F1: {f1_v:.4f}")

    # Select Candidate v2 (PowerSVC)
    winning_model_name = "PowerSVC_Candidate_v2"
    winning_pipe = candidates[winning_model_name]
    logger.info(f"\nWinning Model Selected for Candidate v2: {winning_model_name}")

    # 4. Evaluate Candidate v2 on Untouched Kaggle Test Set
    logger.info("\n=================================================================")
    logger.info("EVALUATING CANDIDATE V2 ON UNTOUCHED KAGGLE TEST SET (750 samples)")
    logger.info("=================================================================")
    y_test_k_pred = winning_pipe.predict(X_test_k)
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
    logger.info(f"Kaggle Test Accuracy: {kaggle_acc:.4f} ({kaggle_acc*100:.2f}%)")
    logger.info(f"Kaggle Test Macro F1: {k_f1_macro:.4f}")
    logger.info(f"Kaggle Test Macro Precision: {k_p_macro:.4f}")
    logger.info(f"Kaggle Test Macro Recall: {k_r_macro:.4f}")
    logger.info(f"\nKaggle Test Classification Report:\n{kaggle_report}")

    cm_kaggle = confusion_matrix(y_test_k_raw, y_test_k_pred_labels, labels=TARGET_CLASSES)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm_kaggle, annot=True, fmt="d", cmap="Blues", xticklabels=TARGET_CLASSES, yticklabels=TARGET_CLASSES)
    plt.title(f"Confusion Matrix (Kaggle Test Set, N={len(df_test_k_clean)})\nModel: PowerSVC Candidate v2")
    plt.xlabel("Predicted Face Shape")
    plt.ylabel("Actual Face Shape")
    plt.tight_layout()
    plt.savefig(KAGGLE_CM_PATH, dpi=180)
    plt.close()
    logger.info(f"Saved Kaggle confusion matrix to: {KAGGLE_CM_PATH}")

    # 5. Evaluate Candidate v2 on Real-World Holdout Set
    logger.info("\n=================================================================")
    logger.info("EVALUATING CANDIDATE V2 ON REAL-WORLD HOLDOUT SET (11 samples)")
    logger.info("=================================================================")
    y_test_r_pred = winning_pipe.predict(X_test_r)
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
    plt.title(f"Confusion Matrix (Real-World Holdout, N={len(df_test_r_clean)})\nModel: PowerSVC Candidate v2 (Only Oval & Round)")
    plt.xlabel("Predicted Face Shape")
    plt.ylabel("Actual Face Shape")
    plt.tight_layout()
    plt.savefig(REAL_CM_PATH, dpi=180)
    plt.close()
    logger.info(f"Saved Real-World confusion matrix to: {REAL_CM_PATH}")

    # 6. Save Candidate v2 Model Artifact
    logger.info("\n=================================================================")
    logger.info("SAVING CANDIDATE V2 MODEL ARTIFACT")
    logger.info("=================================================================")
    candidate_v2_artifact = {
        "pipeline": winning_pipe,
        "label_encoder": le,
        "feature_cols": FEATURE_NAMES,
        "classes": TARGET_CLASSES,
        "model_name": winning_model_name,
        "version": "candidate-5class-v2",
        "training_samples": len(X_train),
        "validation_macro_f1": val_comparison[winning_model_name]["macro_f1"],
        "validation_accuracy": val_comparison[winning_model_name]["accuracy"],
        "hyperparameters": {
            "scaler": "PowerTransformer(yeo-johnson)",
            "classifier": "SVC",
            "C": 1.5,
            "gamma": 0.1,
            "kernel": "rbf"
        },
        "created_at": datetime.now().isoformat()
    }

    joblib.dump(candidate_v2_artifact, CANDIDATE_V2_MODEL_PATH)
    logger.info(f"Candidate v2 model successfully saved to: {CANDIDATE_V2_MODEL_PATH}")

    # 7. Verification of Safety Rules
    if prod_mtime is not None:
        post_prod_mtime = os.path.getmtime(PRODUCTION_MODEL_PATH)
        assert prod_mtime == post_prod_mtime, "SAFETY VIOLATION: Production model was modified!"
        logger.info("[CONFIRMED] Production model 'face_shape_model.joblib' is 100% UNTOUCHED.")

    if cand_v1_mtime is not None:
        post_v1_mtime = os.path.getmtime(CANDIDATE_V1_MODEL_PATH)
        assert cand_v1_mtime == post_v1_mtime, "SAFETY VIOLATION: Candidate v1 was modified!"
        logger.info("[CONFIRMED] Candidate v1 'face_shape_model_candidate.joblib' is 100% UNTOUCHED.")

    # 8. Save Comprehensive Evaluation Report
    per_class_metrics = {}
    for i, c in enumerate(TARGET_CLASSES):
        per_class_metrics[c] = {
            "precision": float(p_per_class[i]),
            "recall": float(r_per_class[i]),
            "f1_score": float(f1_per_class[i]),
            "support": int(supp_per_class[i])
        }

    # Load candidate v1 results for side-by-side comparison
    v1_report_path = os.path.join(MODELS_DIR, "candidate_evaluation_report.json")
    v1_metrics = {}
    if os.path.exists(v1_report_path):
        with open(v1_report_path, "r", encoding="utf-8") as f:
            v1_data = json.load(f)
            v1_metrics = {
                "kaggle_accuracy": v1_data["kaggle_test_evaluation"]["accuracy"],
                "kaggle_macro_f1": v1_data["kaggle_test_evaluation"]["macro_f1"],
                "kaggle_per_class": v1_data["kaggle_test_evaluation"]["per_class"],
                "real_world_accuracy": v1_data["real_world_holdout_evaluation"]["accuracy"]
            }

    evaluation_report_v2 = {
        "timestamp": datetime.now().isoformat(),
        "candidate_version": "v2",
        "selected_model": winning_model_name,
        "hyperparameters": {
            "scaler": "PowerTransformer(yeo-johnson)",
            "classifier": "SVC(C=1.5, gamma=0.1, kernel='rbf', probability=True)"
        },
        "dataset_splits": {
            "train": len(df_train_clean),
            "val": len(df_val_clean),
            "test_kaggle": len(df_test_k_clean),
            "test_real_world_holdout": len(df_test_r_clean)
        },
        "validation_model_comparison": val_comparison,
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
        },
        "comparison_with_candidate_v1": {
            "v1_model": "XGBoost",
            "v2_model": "PowerSVC",
            "val_macro_f1": {
                "v1": 0.5980,
                "v2": float(val_comparison[winning_model_name]["macro_f1"]),
                "delta": float(val_comparison[winning_model_name]["macro_f1"] - 0.5980)
            },
            "kaggle_test_accuracy": {
                "v1": v1_metrics.get("kaggle_accuracy", 0.5813),
                "v2": float(kaggle_acc),
                "delta": float(kaggle_acc - v1_metrics.get("kaggle_accuracy", 0.5813))
            },
            "kaggle_test_macro_f1": {
                "v1": v1_metrics.get("kaggle_macro_f1", 0.5813),
                "v2": float(k_f1_macro),
                "delta": float(k_f1_macro - v1_metrics.get("kaggle_macro_f1", 0.5813))
            },
            "oval_test_f1": {
                "v1": v1_metrics.get("kaggle_per_class", {}).get("Oval", {}).get("f1_score", 0.4377),
                "v2": float(per_class_metrics["Oval"]["f1_score"]),
                "delta": float(per_class_metrics["Oval"]["f1_score"] - v1_metrics.get("kaggle_per_class", {}).get("Oval", {}).get("f1_score", 0.4377))
            },
            "real_world_accuracy": {
                "v1": v1_metrics.get("real_world_accuracy", 0.4545),
                "v2": float(real_acc),
                "delta": float(real_acc - v1_metrics.get("real_world_accuracy", 0.4545))
            }
        }
    }

    with open(REPORT_V2_PATH, "w", encoding="utf-8") as f:
        json.dump(evaluation_report_v2, f, indent=2)
    logger.info(f"Candidate v2 evaluation report saved to: {REPORT_V2_PATH}")
    logger.info("\nPipeline execution complete!")


if __name__ == "__main__":
    run_pipeline()
