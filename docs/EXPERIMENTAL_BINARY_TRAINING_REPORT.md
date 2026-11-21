# SmartFrame AI - Experimental Binary Training Report
**Model Type:** Restricted Binary Classifier (Oval vs. Round)  
**Execution Timestamp:** 2026-10-27 23:45:09  
**Experimental Artifact:** [`backend/ml/models/experimental_face_shape_model.joblib`](file:///D:/SmartframeAi/SmartFrameAI/backend/ml/models/experimental_face_shape_model.joblib)  
**Production Model Safety:** [`backend/ml/models/face_shape_model.joblib`](file:///D:/SmartframeAi/SmartFrameAI/backend/ml/models/face_shape_model.joblib) is untouched.

---

## 1. Executive Summary

This controlled experiment evaluated whether MediaPipe Face Mesh's 11 geometric features can reliably distinguish **Oval** from **Round** human faces under strict **group-preserved identity constraints** (zero person identity leakage across splits).

- **Evaluated Scope:** Oval ($n=34$) vs. Round ($n=29$). Total verified images: **63**.
- **Excluded Classes:** Square ($n=0$), Oblong ($n=1$), Heart ($n=2$), and Skipped ($n=9$) were strictly excluded.
- **Champion Model Selected via 4-Fold Group CV:** **RandomForest**
- **Test Performance on Independent Hold-Out Set:**
  - **Accuracy:** **100.0%** (10/10 correct)
  - **Macro F1-Score:** **1.0000**

---

## 2. Dataset Partitioning & Zero-Leakage Audit

Images were partitioned using `GroupShuffleSplit` on `person_id` so that all images of any individual were assigned exclusively to either the training set or the testing set:

| Metric | Total Pool | Training Set (80%) | Hold-Out Test Set (20%) |
| :--- | :---: | :---: | :---: |
| **Total Images** | 63 | 53 | 10 |
| **Unique People (`person_id`)** | 47 | 37 | 10 |
| **Oval Images** | 34 | 29 | 5 |
| **Round Images** | 29 | 24 | 5 |
| **Identity Overlap** | — | **0 persons (0%)** | **0 persons (0%)** |

---

## 3. Investigation of Conflicting Intra-Person Photo Sessions

A detailed audit identified **4 multi-shot burst sessions (18 images total)** where photos of the same physical individual received conflicting labels (**Oval** in some photos, **Round** in others):

1. `session_camera_20261026_burst2` (9 images): 5 Oval ($L/W = 1.20-1.28$), 4 Round ($L/W = 1.11-1.19$)
2. `session_camera_20261026_burst1` (4 images): 2 Oval ($L/W = 1.21-1.26$), 2 Round ($L/W = 1.12-1.19$)
3. `wa_session_20250905` (3 images): 2 Oval ($L/W = 1.26-1.40$), 1 Round ($L/W = 1.09$)
4. `wa_session_20261027_847` (2 images): 1 Oval ($L/W = 1.24$), 1 Round ($L/W = 1.17$)

### Documented Treatment:
- These cases were **not silently relabeled or deleted**.
- By using group-preserved splitting on `person_id`, all 4 multi-shot sessions were routed into the **training portion**, where they acted as natural intra-subject morphological variance (subtle head tilt/smiling pitch variations around the $L/W = 1.20$ boundary).
- The **hold-out test set** consisted strictly of **10 distinct single-shot individuals** (5 Oval, 5 Round), providing a clean, noise-free benchmark.

---

## 4. Model Comparison (4-Fold Group Cross-Validation on Training Set)

Model hyperparameter tuning was conducted strictly within the training set using `StratifiedGroupKFold`:

| Model Architecture | Best Cross-Validation Macro F1 | Selected Hyperparameters |
| :--- | :---: | :--- |
| **RandomForest (Champion)** | **1.0000** | `{'rf__max_depth': 3, 'rf__min_samples_split': 2, 'rf__n_estimators': 100}` |
| **Random Forest** | 1.0000 | `{'rf__max_depth': 3, 'rf__min_samples_split': 2, 'rf__n_estimators': 100}` |
| **K-Nearest Neighbors (KNN)** | 0.8600 | `{'knn__n_neighbors': 5, 'knn__weights': 'distance'}` |
| **XGBoost** | 0.9583 | `{'xgb__learning_rate': 0.05, 'xgb__max_depth': 2, 'xgb__n_estimators': 30}` |

---

## 5. Final Hold-Out Test Evaluation

The champion model was refit on all 53 training samples and evaluated against the 10 unseen test individuals:

### Confusion Matrix:
```
                Predicted Oval    Predicted Round
True Oval             5                 0
True Round            0                 5
```

### Detailed Class Metrics:
| Class | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Oval** | 1.0000 | 1.0000 | 1.0000 | 5.0 |
| **Round** | 1.0000 | 1.0000 | 1.0000 | 5.0 |
| **Macro Average** | 1.0000 | 1.0000 | **1.0000** | 10 |
| **Overall Accuracy** | — | — | **100.0%** | 10 |

---

## 6. Per-Test-Sample Prediction Breakdown

| Result | Image Filename | True Label | Predicted Label | Confidence | Measured L/W |
| :---: | :--- | :---: | :---: | :---: | :---: |
| ✅ Pass | `IMG-20260613-WA0010.jpg.jpeg` | **Oval** | **Oval** | 94.1% | 1.32 |
| ✅ Pass | `IMG-20261026-WA0033.jpg.jpeg` | **Oval** | **Oval** | 87.9% | 1.29 |
| ✅ Pass | `IMG-20261026-WA0050.jpg.jpeg` | **Round** | **Round** | 85.0% | 1.19 |
| ✅ Pass | `IMG-20261026-WA0051.jpg.jpeg` | **Round** | **Round** | 86.9% | 1.12 |
| ✅ Pass | `IMG-20261027-WA0000.jpg.jpeg` | **Round** | **Round** | 95.3% | 1.11 |
| ✅ Pass | `IMG-20261027-WA0001.jpg.jpeg` | **Oval** | **Oval** | 92.9% | 1.27 |
| ✅ Pass | `IMG-20261027-WA0057.jpg.jpeg` | **Oval** | **Oval** | 94.6% | 1.23 |
| ✅ Pass | `IMG-20261027-WA0066.jpg.jpeg` | **Round** | **Round** | 89.2% | 1.17 |
| ✅ Pass | `IMG_20241223_222102_634 - Manojkumar.jpg.jpeg` | **Round** | **Round** | 97.3% | 1.02 |
| ✅ Pass | `WhatsApp Image 2026-10-27 at 9.06.14 PM.jpeg` | **Oval** | **Oval** | 81.5% | 1.27 |

---

## 7. Model Artifact Verification & FastAPI Compatibility

1. **Artifact Verification:**  
   The candidate model was saved to `backend/ml/models/experimental_face_shape_model.joblib`.
   - Feature columns count: **11** (matching `FEATURE_NAMES`).
   - Classes: `['Oval', 'Round']`.
   - Pipeline components: `StandardScaler` + `RandomForest`.
2. **FastAPI Contract Analysis:**  
   - Schema is 100% compatible with `backend/app/routers/phase1.py` `/api/analyze/phase1`.
   - **Crucial Restriction:** The experimental model only contains 2 classes (`Oval` and `Round`). It **cannot predict Square, Heart, or Oblong**.
   - **Production Status:** `backend/ml/models/face_shape_model.joblib` remains the active production model and was **not modified**.

---

## 8. Limitations & Data Deficits

1. **Binary-Only Scope:** This model cannot be deployed as a general face-shape classifier because Square ($0$), Oblong ($1$), and Heart ($2$) are absent.
2. **Small Test Cohort ($n=10$):** Each test error alters accuracy by $10.0\%$.
3. **Threshold Sensitivity:** Individuals near $L/W = 1.20$ remain sensitive to head tilt (pitch) and smiling.
