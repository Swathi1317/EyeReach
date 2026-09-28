import os
import logging
import joblib
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, precision_recall_fscore_support
import seaborn as sns

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

def evaluate_model(test_cache_path: str, model_path: str, reports_dir: str):
    logger.info(f"Loading testing data from {test_cache_path}")
    df = pd.read_parquet(test_cache_path)
    
    df_success = df[df["status"] == "success"].copy()
    logger.info(f"Using {len(df_success)} successful samples for testing out of {len(df)}")
    
    logger.info(f"Loading model artifact from {model_path}")
    model_artifact = joblib.load(model_path)
    
    pipeline = model_artifact["pipeline"]
    le = model_artifact["label_encoder"]
    feature_cols = model_artifact["feature_cols"]
    classes = model_artifact["classes"]
    
    # Ensure columns match the exact training order
    X_test = df_success[feature_cols].to_numpy(dtype=float)
    y_test_raw = df_success["label"].to_numpy(dtype=str)
    y_test = le.transform(y_test_raw)
    
    logger.info("Running predictions...")
    y_pred = pipeline.predict(X_test)
    y_pred_labels = le.inverse_transform(y_pred)
    
    # Metrics
    acc = accuracy_score(y_test_raw, y_pred_labels)
    
    # precision_recall_fscore_support for macro
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(y_test_raw, y_pred_labels, average="macro")
    
    logger.info("\n--- FINAL TEST EVALUATION ---")
    logger.info(f"Test Accuracy: {acc:.4f}")
    logger.info(f"Macro Precision: {p_macro:.4f}")
    logger.info(f"Macro Recall: {r_macro:.4f}")
    logger.info(f"Macro F1: {f1_macro:.4f}")
    
    logger.info("\n--- CLASSIFICATION REPORT ---")
    report = classification_report(y_test_raw, y_pred_labels, target_names=classes)
    logger.info("\n" + report)
    
    # Confusion Matrix
    cm = confusion_matrix(y_test_raw, y_pred_labels, labels=classes)
    
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', xticklabels=classes, yticklabels=classes)
    plt.xlabel('Predicted')
    plt.ylabel('Actual')
    plt.title('Confusion Matrix - Face Shape Classification')
    
    os.makedirs(reports_dir, exist_ok=True)
    cm_path = os.path.join(reports_dir, "confusion_matrix.png")
    plt.savefig(cm_path, bbox_inches='tight')
    plt.close()
    
    logger.info(f"Confusion matrix saved to: {cm_path}")

if __name__ == "__main__":
    base_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    test_cache = os.path.join(base_dir, "cache", "testing_set.parquet")
    model_path = os.path.join(os.path.dirname(__file__), "models", "face_shape_model.joblib")
    reports_dir = os.path.join(os.path.dirname(__file__), "models")
    
    evaluate_model(test_cache, model_path, reports_dir)
