import sys
import os
import joblib
import pandas as pd
import cv2

# Add backend to python path if not there
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from backend.ml.face_shape_classifier import face_shape_classifier, AnthropometricFaceShapeScorer

def predict_image(image_path: str, model_path: str = None):
    if not os.path.exists(image_path):
        print(f"Error: Image file not found: {image_path}")
        return

    print(f"Reading {image_path}...")
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Failed to decode image: {image_path}")
        return

    print(f"Extracting features from {image_path}...")
    features = face_shape_classifier.extract_features_from_image(img)
    if features is None:
        print("Failed to extract features (no face detected or extraction failed).")
        return

    result = face_shape_classifier.predict_hybrid(features, frames_evaluated=1)

    print("\n--- HYBRID FACE SHAPE PREDICTION RESULTS ---")
    print(f"Top-1 Shape: {result['face_shape']} (Confidence: {result['confidence']:.2%})")
    print(f"Stability: {result['stability'].upper()}")
    if result["is_boundary_case"]:
        print(f"Notice: Boundary case detected. Secondary tendency: {result['secondary_shape']}")
    print(f"Explanation: {result['explanation']}")

    print("\nTop Predictions:")
    for item in result["top_predictions"]:
        print(f"  {item['shape']}: {item['probability']:.2%}")

    print("\nKey Facial Proportions:")
    print(f"  Length-to-Width Ratio: {features['face_length_to_cheekbone_width']:.3f}")
    print(f"  Jaw-to-Cheekbone Ratio: {features['jaw_width_to_cheekbone_width']:.3f}")
    print(f"  Average Jaw Angle: {features['avg_jaw_angle']:.1f}°")
    print(f"  Chin Angle: {features['chin_angle']:.1f}°")
    print(f"  Cheekbone-to-Jaw Taper: {features['cheekbone_to_jaw_taper']:.3f}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python predict.py <image_path>")
        sys.exit(1)

    img_path = sys.argv[1]
    predict_image(img_path)
