import cv2
import numpy as np
import os
import joblib
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
import tempfile

from backend.ml.build_features import FaceFeatureExtractor

router = APIRouter()

# Load model lazily or at startup. For now, lazily in the module.
model_path = os.path.join(os.path.dirname(__file__), "..", "..", "ml", "models", "face_shape_model.joblib")
model_artifact = None
extractor = None

def get_model():
    global model_artifact
    if model_artifact is None:
        model_artifact = joblib.load(model_path)
    return model_artifact

def get_extractor():
    global extractor
    if extractor is None:
        extractor = FaceFeatureExtractor()
    return extractor

@router.post("/api/analyze/phase1")
async def analyze_phase1(image: UploadFile = File(...)):
    try:
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image file.")
        
    if img is None:
        raise HTTPException(status_code=400, detail="Failed to decode image.")
        
    # We need to save the image to a temp file because extractor.process_image expects a path
    # (Since we are explicitly told not to modify phase 1 calculation logic, we will use it as is)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
        cv2.imwrite(tmp.name, img)
        tmp_path = tmp.name
        
    try:
        ext = get_extractor()
        features = ext.process_image(tmp_path)
        
        if features is None:
            return {
                "face_shape": "Unknown",
                "confidence": 0.0,
                "top_predictions": [],
                "error": "Failed to extract features (no face detected or extraction failed)."
            }
            
        mod = get_model()
        pipeline = mod["pipeline"]
        le = mod["label_encoder"]
        feature_cols = mod["feature_cols"]
        
        # Convert to dataframe in exact feature order
        df = pd.DataFrame([features])[feature_cols]
        
        # Predict probabilities
        probs = pipeline.predict_proba(df.values)[0]
        
        classes = le.classes_
        prob_dict = {classes[i]: float(probs[i]) for i in range(len(classes))}
        sorted_preds = sorted(prob_dict.items(), key=lambda x: x[1], reverse=True)
        
        top_predictions = [{"shape": shape, "probability": prob} for shape, prob in sorted_preds]
        
        return {
            "face_shape": sorted_preds[0][0],
            "confidence": sorted_preds[0][1],
            "top_predictions": top_predictions
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
