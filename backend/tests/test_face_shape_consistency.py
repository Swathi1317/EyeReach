"""
Tests for Face Shape Detection Consistency, Multi-Frame Soft-Voting,
Temporal MAD Feature Stabilization, and Anthropometric Geometric Priors.

Verifies:
1. Support for multi-frame image upload to /api/analyze/phase1.
2. Pose quality weighting and temporal outlier pruning across frames.
3. High repeatability across simulated repeated scans of the same person (zero shape drift).
4. Boundary case disambiguation and transparent confidence reporting.
5. Graceful handling of noisy/tilted frames within a multi-frame burst.
"""

import os
import io
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.ml.face_shape_classifier import face_shape_classifier, AnthropometricFaceShapeScorer

client = TestClient(app)

TARGET_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]
SAMPLE_IMAGE_PATH = "D:/SmartframeAi/Data/Working_Dataset/Oval/IMG-20261027-WA0003.jpg.jpeg"


def test_single_frame_endpoint_backwards_compatible():
    """Verify single image upload returns all expected fields."""
    if not os.path.exists(SAMPLE_IMAGE_PATH):
        pytest.skip(f"Sample image not found: {SAMPLE_IMAGE_PATH}")

    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        img_bytes = f.read()

    response = client.post(
        "/api/analyze/phase1",
        files={"image": ("single.jpg", io.BytesIO(img_bytes), "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["face_shape"] in TARGET_CLASSES
    assert data["confidence"] > 0.0
    assert len(data["top_predictions"]) == 5
    assert data["frames_evaluated"] == 1
    assert "features" in data
    assert "measurements" in data
    assert "explanation" in data
    assert "stability" in data


def test_multi_frame_endpoint():
    """Verify multi-frame burst upload processes multiple frames and returns high stability."""
    if not os.path.exists(SAMPLE_IMAGE_PATH):
        pytest.skip(f"Sample image not found: {SAMPLE_IMAGE_PATH}")

    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        img_bytes = f.read()

    # Create 5 frames (simulating burst capture)
    files = [("images", (f"frame_{i}.jpg", io.BytesIO(img_bytes), "image/jpeg")) for i in range(5)]

    response = client.post("/api/analyze/phase1", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["face_shape"] in TARGET_CLASSES
    assert data["confidence"] > 0.0
    assert data["frames_evaluated"] == 5
    assert data["stability"] in ["high", "moderate"]
    assert "explanation" in data
    assert len(data["explanation"]) > 10


def test_multi_frame_with_one_corrupted_frame():
    """Verify that if one frame in a multi-frame burst is tilted/invalid, it is filtered out and the remaining valid frames succeed."""
    if not os.path.exists(SAMPLE_IMAGE_PATH):
        pytest.skip(f"Sample image not found: {SAMPLE_IMAGE_PATH}")

    with open(SAMPLE_IMAGE_PATH, "rb") as f:
        valid_bytes = f.read()

    # Create an invalid blank frame
    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    _, blank_buf = cv2.imencode(".jpg", blank)
    blank_bytes = blank_buf.tobytes()

    files = [
        ("images", ("frame_0.jpg", io.BytesIO(valid_bytes), "image/jpeg")),
        ("images", ("frame_1.jpg", io.BytesIO(blank_bytes), "image/jpeg")),
        ("images", ("frame_2.jpg", io.BytesIO(valid_bytes), "image/jpeg")),
        ("images", ("frame_3.jpg", io.BytesIO(valid_bytes), "image/jpeg"))
    ]

    response = client.post("/api/analyze/phase1", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["face_shape"] in TARGET_CLASSES
    # 3 valid frames out of 4 should be evaluated
    assert data["frames_evaluated"] == 3
    assert data["quality"]["status"] == "valid"


def test_repeatability_across_repeated_scans():
    """
    Verify repeatability:
    Simulate 10 consecutive scans of the same person with realistic sensor landmark jitter.
    The stabilized prediction must remain 100% consistent (zero shape flipping).
    """
    if not os.path.exists(SAMPLE_IMAGE_PATH):
        pytest.skip(f"Sample image not found: {SAMPLE_IMAGE_PATH}")

    img = cv2.imread(SAMPLE_IMAGE_PATH)
    base_feat = face_shape_classifier.extract_features_from_image(img)
    assert base_feat is not None

    predictions_across_scans = []

    np.random.seed(123)
    for scan_idx in range(10):
        # Generate 5 jittered frames representing 1 scan session
        simulated_frames = []
        for _ in range(5):
            jittered = {}
            for k, v in base_feat.items():
                # Add typical ±1-2% micro-movement / pitch variation
                noise = np.random.normal(1.0, 0.015)
                jittered[k] = float(v * noise)
            simulated_frames.append(jittered)

        # Stabilize features with MAD
        stable_feat = face_shape_classifier.stabilize_features_mad(simulated_frames)
        res = face_shape_classifier.predict_hybrid(stable_feat, frames_evaluated=5)
        predictions_across_scans.append(res["face_shape"])

    # Ensure 100% consistency across all 10 scans
    unique_preds = set(predictions_across_scans)
    assert len(unique_preds) == 1, f"Prediction drifted across scans! Results: {predictions_across_scans}"


def test_anthropometric_prior_scoring():
    """Verify AnthropometricFaceShapeScorer produces valid normalized probability distributions."""
    sample_features = {
        "face_length_to_cheekbone_width": 1.28,  # long -> Oblong
        "jaw_width_to_cheekbone_width": 0.94,
        "forehead_width_to_cheekbone_width": 0.86,
        "jaw_width_to_forehead_width": 1.09,
        "chin_width_to_jaw_width": 0.43,
        "avg_jaw_angle": 143.0,
        "chin_angle": 84.0,
        "cheekbone_to_jaw_taper": 0.05,
        "contour_curvature": 0.088
    }
    scores = AnthropometricFaceShapeScorer.compute_scores(sample_features)
    assert len(scores) == 5
    assert abs(sum(scores.values()) - 1.0) < 1e-4
    # Oblong should have the highest prior for an elongated face (L/W = 1.28)
    assert scores["Oblong"] == max(scores.values())
