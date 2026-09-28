import sys
import os
import joblib
import pandas as pd

# We need FaceFeatureExtractor from build_features
# Add backend to python path if not there
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from backend.ml.build_features import FaceFeatureExtractor, FEATURE_NAMES

def predict_image(image_path: str, model_path: str):
    print(f"Loading model from {model_path}...")
    model_artifact = joblib.load(model_path)
    pipeline = model_artifact["pipeline"]
    le = model_artifact["label_encoder"]
    feature_cols = model_artifact["feature_cols"]
    
    print(f"Extracting features from {image_path}...")
    extractor = FaceFeatureExtractor()
    features = extractor.process_image(image_path)
    
    if features is None:
        print("Failed to extract features (no face detected or extraction failed).")
        return
        
    # Convert to dataframe in exact feature order
    df = pd.DataFrame([features])[feature_cols]
    
    # Predict probabilities
    probs = pipeline.predict_proba(df.values)[0]
    
    # Map to classes
    classes = le.classes_
    prob_dict = {classes[i]: float(probs[i]) for i in range(len(classes))}
    
    # Sort by probability descending
    sorted_preds = sorted(prob_dict.items(), key=lambda x: x[1], reverse=True)
    
    print("\n--- PREDICTION RESULTS ---")
    print(f"Top-1 Shape: {sorted_preds[0][0]} (Confidence: {sorted_preds[0][1]:.2%})")
    
    print("\nTop-3 Predictions:")
    for shape, prob in sorted_preds[:3]:
        print(f"  {shape}: {prob:.2%}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python predict.py <image_path>")
        sys.exit(1)
        
    img_path = sys.argv[1]
    model_path = os.path.join(os.path.dirname(__file__), "models", "face_shape_model.joblib")
    predict_image(img_path, model_path)
