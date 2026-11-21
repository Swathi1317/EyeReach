"""
Explore improvements on SmartFrame AI 5-class face shape representation and models.
Fits strictly on the training set (3,544 samples).
Evaluates strictly on the validation set (757 samples).
Tests:
1. Baseline XGBoost & Random Forest
2. Additional models (SVC RBF, ExtraTrees, HistGradientBoosting, MLP)
3. Feature engineering / transformations (domain-specific geometric ratios)
4. Ensembling (Soft Voting of diverse models)
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler, RobustScaler, PowerTransformer, LabelEncoder
from sklearn.ensemble import (
    RandomForestClassifier,
    ExtraTreesClassifier,
    HistGradientBoostingClassifier,
    VotingClassifier
)
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_recall_fscore_support
from xgboost import XGBClassifier

train_df = pd.read_parquet("D:/SmartframeAi/Data/Working_Dataset/features_cache/train_features.parquet")
val_df = pd.read_parquet("D:/SmartframeAi/Data/Working_Dataset/features_cache/val_features.parquet")

train_clean = train_df[train_df["status"] == "success"].copy().reset_index(drop=True)
val_clean = val_df[val_df["status"] == "success"].copy().reset_index(drop=True)

base_features = [
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

le = LabelEncoder()
y_train = le.fit_transform(train_clean["class_label"])
y_val = le.transform(val_clean["class_label"])
classes = le.classes_.tolist()

print(f"Train samples: {len(y_train)}, Val samples: {len(y_val)}")
print(f"Classes: {classes}")

# 1. Base 11 features
X_train_raw = train_clean[base_features].to_numpy(dtype=float)
X_val_raw = val_clean[base_features].to_numpy(dtype=float)

scaler_std = StandardScaler()
X_tr_std = scaler_std.fit_transform(X_train_raw)
X_va_std = scaler_std.transform(X_val_raw)

print("\n--- EXPERIMENT 1: MODEL FAMILY COMPARISON (11 BASE FEATURES) ---")
models = {
    "XGBoost_Baseline": XGBClassifier(learning_rate=0.03, max_depth=5, n_estimators=200, subsample=0.8, random_state=42, eval_metric="mlogloss"),
    "RandomForest_Baseline": RandomForestClassifier(n_estimators=300, max_depth=None, min_samples_split=5, random_state=42),
    "SVC_RBF_C2": SVC(C=2.0, kernel="rbf", probability=True, random_state=42),
    "SVC_RBF_C3": SVC(C=3.0, kernel="rbf", probability=True, random_state=42),
    "ExtraTrees_300": ExtraTreesClassifier(n_estimators=300, max_depth=16, min_samples_split=4, random_state=42),
    "HistGradBoost": HistGradientBoostingClassifier(max_iter=200, learning_rate=0.04, max_depth=5, random_state=42),
    "MLP_2Layer": MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=400, random_state=42)
}

res_exp1 = {}
for name, clf in models.items():
    clf.fit(X_tr_std, y_train)
    preds = clf.predict(X_va_std)
    acc = accuracy_score(y_val, preds)
    f1_m = f1_score(y_val, preds, average="macro")
    res_exp1[name] = {"acc": acc, "f1_macro": f1_m}
    print(f"{name:25s} -> Val Acc: {acc:.4f} | Val Macro F1: {f1_m:.4f}")

# 2. FEATURE ENGINEERING EXPERIMENT
print("\n--- EXPERIMENT 2: FEATURE ENGINEERING (DOMAIN-SPECIFIC GEOMETRIC RATIOS) ---")
def add_engineered_features(df):
    d = df.copy()
    # 1. Heart vs Oval: forehead to jaw ratio (taper of forehead relative to jaw)
    d["forehead_to_jaw_ratio"] = d["forehead_width_to_cheekbone_width"] / (d["jaw_width_to_cheekbone_width"] + 1e-6)
    # 2. Oval/Heart vs Round/Square: chin sharpness index
    d["chin_to_jaw_angle_ratio"] = d["chin_angle"] / (d["avg_jaw_angle"] + 1e-6)
    # 3. Square vs Round: jaw prominence index (wide jaw + sharp angle)
    d["jaw_squareness_index"] = (d["jaw_width_to_cheekbone_width"] ** 2) / (d["avg_jaw_angle"] + 1e-6) * 100
    # 4. Oblong vs Oval: vertical elongation relative to jaw taper
    d["elongation_to_taper"] = d["face_length_to_cheekbone_width"] / (d["cheekbone_to_jaw_taper"] + 0.01)
    # 5. Facial aspect ratio product (length * chin angle)
    d["face_length_chin_product"] = d["face_length_to_cheekbone_width"] * (d["chin_angle"] / 100.0)
    return d

train_eng = add_engineered_features(train_clean)
val_eng = add_engineered_features(val_clean)

eng_feature_names = [c for c in train_eng.columns if c not in [
    "image_filename", "source_dataset", "class_label", "person_group", "duplicate_group", "image_path", "status"
]]
print(f"Engineered feature set: {len(eng_feature_names)} features ({len(base_features)} base + 5 domain-engineered)")

X_tr_eng = train_eng[eng_feature_names].to_numpy(dtype=float)
X_va_eng = val_eng[eng_feature_names].to_numpy(dtype=float)

scaler_eng = StandardScaler()
X_tr_eng_s = scaler_eng.fit_transform(X_tr_eng)
X_va_eng_s = scaler_eng.transform(X_va_eng)

res_exp2 = {}
for name, clf in models.items():
    clf.fit(X_tr_eng_s, y_train)
    preds = clf.predict(X_va_eng_s)
    acc = accuracy_score(y_val, preds)
    f1_m = f1_score(y_val, preds, average="macro")
    res_exp2[name] = {"acc": acc, "f1_macro": f1_m}
    diff_f1 = f1_m - res_exp1[name]["f1_macro"]
    diff_acc = acc - res_exp1[name]["acc"]
    print(f"{name:25s} -> Val Acc: {acc:.4f} ({diff_acc:+.4f}) | Val Macro F1: {f1_m:.4f} ({diff_f1:+.4f})")

# 3. ENSEMBLING EXPERIMENT
print("\n--- EXPERIMENT 3: ENSEMBLE (SOFT VOTING) ---")
best_xgb = XGBClassifier(learning_rate=0.03, max_depth=5, n_estimators=200, subsample=0.8, colsample_bytree=0.85, random_state=42, eval_metric="mlogloss")
best_rf = RandomForestClassifier(n_estimators=300, max_depth=None, min_samples_split=5, random_state=42)
best_svc = SVC(C=2.5, kernel="rbf", probability=True, random_state=42)
best_et = ExtraTreesClassifier(n_estimators=300, max_depth=16, min_samples_split=4, random_state=42)

voting_clf = VotingClassifier(
    estimators=[
        ("xgb", best_xgb),
        ("rf", best_rf),
        ("svc", best_svc),
        ("et", best_et)
    ],
    voting="soft",
    weights=[2, 1, 2, 1]
)

# Test ensemble on base features
voting_clf.fit(X_tr_std, y_train)
preds_v_base = voting_clf.predict(X_va_std)
acc_v_base = accuracy_score(y_val, preds_v_base)
f1_v_base = f1_score(y_val, preds_v_base, average="macro")
print(f"Ensemble (Soft Voting on Base 11 features) -> Val Acc: {acc_v_base:.4f} | Val Macro F1: {f1_v_base:.4f}")

# Test ensemble on engineered features
voting_clf_eng = VotingClassifier(
    estimators=[
        ("xgb", XGBClassifier(learning_rate=0.03, max_depth=5, n_estimators=200, subsample=0.8, colsample_bytree=0.85, random_state=42, eval_metric="mlogloss")),
        ("rf", RandomForestClassifier(n_estimators=300, max_depth=None, min_samples_split=5, random_state=42)),
        ("svc", SVC(C=2.5, kernel="rbf", probability=True, random_state=42)),
        ("et", ExtraTreesClassifier(n_estimators=300, max_depth=16, min_samples_split=4, random_state=42))
    ],
    voting="soft",
    weights=[2, 1, 2, 1]
)
voting_clf_eng.fit(X_tr_eng_s, y_train)
preds_v_eng = voting_clf_eng.predict(X_va_eng_s)
acc_v_eng = accuracy_score(y_val, preds_v_eng)
f1_v_eng = f1_score(y_val, preds_v_eng, average="macro")
print(f"Ensemble (Soft Voting on 16 Engineered features) -> Val Acc: {acc_v_eng:.4f} | Val Macro F1: {f1_v_eng:.4f}")

# Per-class breakdown on validation set for best ensemble vs baseline
print("\n--- PER-CLASS VALIDATION F1 BREAKDOWN ---")
p_b, r_b, f1_b, _ = precision_recall_fscore_support(y_val, res_exp1["XGBoost_Baseline"]["f1_macro"] and models["XGBoost_Baseline"].predict(X_va_std), average=None)
p_v, r_v, f1_v, _ = precision_recall_fscore_support(y_val, preds_v_eng, average=None)

for idx_c, c_name in enumerate(classes):
    print(f"Class {c_name:8s} | Baseline F1: {f1_b[idx_c]:.4f} -> Ensemble Engineered F1: {f1_v[idx_c]:.4f} ({f1_v[idx_c] - f1_b[idx_c]:+.4f})")
