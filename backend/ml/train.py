import os
import logging
import joblib
import pandas as pd
import numpy as np
from sklearn.model_selection import StratifiedKFold, GridSearchCV
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.metrics import accuracy_score, f1_score
from xgboost import XGBClassifier

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

def train_and_select_model(cache_path: str, model_save_path: str):
    logger.info(f"Loading training data from {cache_path}")
    df = pd.read_parquet(cache_path)
    
    # Filter only successful extractions
    df_success = df[df["status"] == "success"].copy()
    logger.info(f"Using {len(df_success)} successful samples for training out of {len(df)}")
    
    # Identify feature columns (exclude metadata columns)
    metadata_cols = ["image_path", "label", "status", "reason"]
    feature_cols = [c for c in df_success.columns if c not in metadata_cols]
    logger.info(f"Found {len(feature_cols)} feature columns: {feature_cols}")
    
    X = df_success[feature_cols].to_numpy(dtype=float)
    y_raw = df_success["label"].to_numpy(dtype=str)
    
    # Encode labels (required for XGBoost)
    le = LabelEncoder()
    y = le.fit_transform(y_raw)
    classes = le.classes_
    logger.info(f"Classes: {classes}")
    
    # Models and Grids
    # Using Pipelines to ensure scaling is applied inside the CV loop to avoid leakage.
    models = {
        "RandomForest": {
            "pipeline": Pipeline([
                ("scaler", StandardScaler()),
                ("rf", RandomForestClassifier(random_state=42))
            ]),
            "params": {
                "rf__n_estimators": [100],
                "rf__max_depth": [None, 10],
                "rf__min_samples_split": [2, 5]
            }
        },
        "KNN": {
            "pipeline": Pipeline([
                ("scaler", StandardScaler()),
                ("knn", KNeighborsClassifier())
            ]),
            "params": {
                "knn__n_neighbors": [3, 5, 7],
                "knn__weights": ["uniform", "distance"]
            }
        },
        "XGBoost": {
            "pipeline": Pipeline([
                ("scaler", StandardScaler()),
                ("xgb", XGBClassifier(random_state=42, use_label_encoder=False, eval_metric="mlogloss"))
            ]),
            "params": {
                "xgb__n_estimators": [100],
                "xgb__max_depth": [3, 6],
                "xgb__learning_rate": [0.1]
            }
        }
    }
    
    from sklearn.model_selection import ParameterGrid
    from sklearn.metrics import accuracy_score, f1_score
    from sklearn.base import clone
    
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    best_overall_model_name = None
    best_overall_score = -1
    best_overall_pipeline = None
    
    results = {}
    
    for name, config in models.items():
        logger.info(f"--- Tuning {name} ---")
        best_model_score = -1
        best_model_params = None
        best_model_pipeline = None
        
        param_grid = list(ParameterGrid(config["params"]))
        
        for params in param_grid:
            logger.info(f"Testing params: {params}")
            pipe = clone(config["pipeline"])
            pipe.set_params(**params)
            
            f1_scores = []
            acc_scores = []
            f1_weighted_scores = []
            
            for train_idx, test_idx in cv.split(X, y):
                X_train, y_train = X[train_idx], y[train_idx]
                X_test, y_test = X[test_idx], y[test_idx]
                
                pipe.fit(X_train, y_train)
                preds = pipe.predict(X_test)
                
                f1_scores.append(f1_score(y_test, preds, average="macro"))
                acc_scores.append(accuracy_score(y_test, preds))
                f1_weighted_scores.append(f1_score(y_test, preds, average="weighted"))
                
            mean_f1 = np.mean(f1_scores)
            logger.info(f"Mean F1: {mean_f1:.4f}")
            if mean_f1 > best_model_score:
                best_model_score = mean_f1
                best_model_params = params
                best_model_pipeline = clone(config["pipeline"]).set_params(**params)
                
                # Store full metrics for best model
                results[name] = {
                    "accuracy_mean": np.mean(acc_scores),
                    "accuracy_std": np.std(acc_scores),
                    "f1_macro": mean_f1,
                    "f1_weighted": np.mean(f1_weighted_scores),
                    "best_params": params
                }
        
        acc_mean = results[name]["accuracy_mean"]
        acc_std = results[name]["accuracy_std"]
        f1_macro_mean = results[name]["f1_macro"]
        f1_weighted_mean = results[name]["f1_weighted"]
        best_params = results[name]["best_params"]
        
        logger.info(f"{name} CV Results: Acc={acc_mean:.4f} (±{acc_std:.4f}), F1-Macro={f1_macro_mean:.4f}, F1-Weighted={f1_weighted_mean:.4f}")
        logger.info(f"Best Params: {best_params}")
        
        if f1_macro_mean > best_overall_score:
            best_overall_score = f1_macro_mean
            best_overall_model_name = name
            best_overall_pipeline = best_model_pipeline

            
    logger.info(f"\nBest Model Selected: {best_overall_model_name} with F1-Macro: {best_overall_score:.4f}")
    
    # Train the best overall model on the FULL training dataset
    logger.info("Training best model on the complete training set...")
    best_overall_pipeline.fit(X, y)
    
    # Save the model artifact
    model_artifact = {
        "pipeline": best_overall_pipeline, # Contains both scaler and model
        "label_encoder": le,
        "feature_cols": feature_cols,
        "classes": classes.tolist(),
        "model_name": best_overall_model_name,
        "version": "1.0",
        "training_samples": len(X)
    }
    
    os.makedirs(os.path.dirname(model_save_path), exist_ok=True)
    joblib.dump(model_artifact, model_save_path)
    logger.info(f"Model successfully saved to {model_save_path}")

if __name__ == "__main__":
    base_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    train_cache = os.path.join(base_dir, "cache", "training_set.parquet")
    model_path = os.path.join(os.path.dirname(__file__), "models", "face_shape_model.joblib")
    
    train_and_select_model(train_cache, model_path)
