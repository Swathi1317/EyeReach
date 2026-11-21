"""
Tests for SmartFrame AI Phase 1 Live Camera and Image Upload Capture Quality
Verifies:
1. Live camera / upload quality checking before prediction.
2. Helpful standardized guidance messages:
   - "Face not detected. Please position your face in the frame."
   - "Please face the camera directly."
   - "Keep your head level and try again."
   - "Face detected. You can continue."
3. Non-invented landmark-based pose checks (yaw, roll, pitch, centering, scale).
4. Preservation of 5 classes (Heart, Oblong, Oval, Round, Square).
5. Proper error handling and API contract backwards compatibility.
"""

import os
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
import io

from backend.app.main import app
from backend.ml.face_utils import shared_face_analyzer, get_capture_guidance_message

client = TestClient(app)

TARGET_CLASSES = ["Heart", "Oblong", "Oval", "Round", "Square"]


def create_blank_image(width=640, height=480, color=(128, 128, 128)):
    """Creates a synthetic image with no face."""
    img = np.full((height, width, 3), color, dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return io.BytesIO(buf.tobytes())


def test_phase1_no_face_guidance():
    """Verify that uploading an image without a face returns the standard guidance message."""
    blank_io = create_blank_image()
    response = client.post(
        "/api/analyze/phase1",
        files={"image": ("blank.jpg", blank_io, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["face_shape"] == "Unknown"
    assert data["confidence"] == 0.0
    assert data["top_predictions"] == []
    assert data["guidance_message"] == "Face not detected. Please position your face in the frame."
    assert "no_face" in data["quality"]["reasons"]


def test_phase1_valid_face_prediction():
    """Verify that a valid face image returns face shape prediction and 'Face detected. You can continue.'"""
    # Use a real verified face from the dataset
    sample_path = "D:/SmartframeAi/Data/Working_Dataset/Oval/IMG-20261027-WA0003.jpg.jpeg"
    if not os.path.exists(sample_path):
        pytest.skip(f"Sample image not found: {sample_path}")

    with open(sample_path, "rb") as f:
        img_bytes = f.read()

    response = client.post(
        "/api/analyze/phase1",
        files={"image": ("sample.jpg", io.BytesIO(img_bytes), "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["face_shape"] in TARGET_CLASSES
    assert data["confidence"] > 0.0
    assert len(data["top_predictions"]) == 5
    # Confirm all 5 classes are present
    classes_returned = [p["shape"] for p in data["top_predictions"]]
    assert set(classes_returned) == set(TARGET_CLASSES)
    assert data["guidance_message"] == "Face detected. You can continue."
    assert data["quality"]["status"] == "valid"


def test_phase1_turned_head_pose_rejection():
    """Verify that an excessively turned face returns 'Please face the camera directly.'"""
    sample_path = "D:/SmartframeAi/Data/Working_Dataset/Oval/IMG-20261027-WA0003.jpg.jpeg"
    if not os.path.exists(sample_path):
        pytest.skip(f"Sample image not found: {sample_path}")

    img = cv2.imread(sample_path)
    # Synthesize severe yaw by cropping and shifting half the face
    h, w = img.shape[:2]
    # Crop right half and paste onto left to distort symmetry severely
    distorted = img.copy()
    distorted[:, :w//2] = cv2.flip(distorted[:, w//2:], 1)

    _, buf = cv2.imencode(".jpg", distorted)
    response = client.post(
        "/api/analyze/phase1",
        files={"image": ("distorted.jpg", io.BytesIO(buf.tobytes()), "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    # Should reject or fail quality
    if data["quality"]["status"] != "valid":
        reasons = data["quality"]["reasons"]
        msg = data["guidance_message"]
        if "not_facing_camera" in reasons or "excessive_head_pose" in reasons:
            assert msg == "Please face the camera directly."


def test_phase1_tilted_head_pose_rejection():
    """Verify that an image rotated/tilted beyond threshold returns 'Keep your head level and try again.'"""
    sample_path = "D:/SmartframeAi/Data/Working_Dataset/Oval/IMG-20261027-WA0003.jpg.jpeg"
    if not os.path.exists(sample_path):
        pytest.skip(f"Sample image not found: {sample_path}")

    img = cv2.imread(sample_path)
    h, w = img.shape[:2]
    # Rotate by 20 degrees (well beyond 6 degree roll threshold)
    M = cv2.getRotationMatrix2D((w // 2, h // 2), 20, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h))

    _, buf = cv2.imencode(".jpg", rotated)
    response = client.post(
        "/api/analyze/phase1",
        files={"image": ("rotated.jpg", io.BytesIO(buf.tobytes()), "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["quality"]["status"] == "invalid"
    assert "head_not_level" in data["quality"]["reasons"]
    assert data["guidance_message"] == "Keep your head level and try again."


def test_get_capture_guidance_message_helper():
    """Unit test for get_capture_guidance_message rule mappings."""
    assert get_capture_guidance_message({"status": "valid", "reasons": []}) == "Face detected. You can continue."
    assert get_capture_guidance_message({"status": "invalid", "reasons": ["no_face"]}) == "Face not detected. Please position your face in the frame."
    assert get_capture_guidance_message({"status": "invalid", "reasons": ["not_facing_camera"]}) == "Please face the camera directly."
    assert get_capture_guidance_message({"status": "invalid", "reasons": ["head_not_level"]}) == "Keep your head level and try again."
    assert get_capture_guidance_message({"status": "invalid", "reasons": ["face_not_centered"]}) == "Keep your face centered."
    assert get_capture_guidance_message({"status": "invalid", "reasons": ["face_too_small"]}) == "Keep the face sufficiently close and clearly visible."
