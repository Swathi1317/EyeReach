import cv2
import numpy as np
import mediapipe as mp
import logging
from typing import Optional, Dict, Tuple

logger = logging.getLogger(__name__)

mp_face_mesh = mp.solutions.face_mesh

class SharedFaceAnalyzer:
    def __init__(self):
        # We use refine_landmarks=True to get the iris landmarks (468, 473)
        self.face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2, # Allow 2 to detect 'multiple faces'
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
        
    def process_image(self, image: np.ndarray) -> Dict:
        """
        Process the image and return quality metrics and landmarks.
        Image should be BGR numpy array.
        """
        result = {
            "quality": {
                "status": "valid",
                "reasons": []
            },
            "landmarks": None,
            "image_rgb": None,
            "width": 0,
            "height": 0
        }
        
        if image is None or image.size == 0:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("invalid_image")
            return result
            
        h, w = image.shape[:2]
        result["width"] = w
        result["height"] = h
        
        # Check brightness
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        mean_brightness = np.mean(gray)
        if mean_brightness < 30:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("too_dark")
        elif mean_brightness > 225:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("too_bright")
            
        # Check blur (Laplacian variance)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        if variance < 10.0:  # Threshold can be adjusted
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("blur")
            
        # Resize for mediapipe if too large (improves speed)
        proc_img = image
        max_size = 1280
        if max(h, w) > max_size:
            scale = max_size / max(h, w)
            proc_img = cv2.resize(image, (int(w * scale), int(h * scale)))
            
        img_rgb = cv2.cvtColor(proc_img, cv2.COLOR_BGR2RGB)
        result["image_rgb"] = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) # Original size for skin tone
        
        fm_result = self.face_mesh.process(img_rgb)
        
        if not fm_result.multi_face_landmarks:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("no_face")
            return result
            
        if len(fm_result.multi_face_landmarks) > 1:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("multiple_faces")
            return result
            
        # Single face found
        landmarks = fm_result.multi_face_landmarks[0].landmark
        
        # Check face size
        # Distance between cheekbones roughly represents face width
        left_cheek = landmarks[234]
        right_cheek = landmarks[454]
        face_width_px = abs(right_cheek.x - left_cheek.x) * w
        
        if face_width_px < w * 0.15:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("face_too_small")
            
        # Landmark points for pose analysis
        nose = landmarks[1]
        right_eye = landmarks[33]   # Anatomical right outer eye corner
        left_eye = landmarks[263]   # Anatomical left outer eye corner
        chin = landmarks[152]
        forehead = landmarks[10]

        # 1. Face Centering (nose center between 0.30 and 0.70 normalized frame width)
        if nose.x < 0.30 or nose.x > 0.70:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("face_not_centered")

        # 2. Roll (head level / tilt): angle between eyes
        import math
        dy = left_eye.y - right_eye.y
        dx = left_eye.x - right_eye.x
        roll_angle = abs(math.degrees(math.atan2(dy, dx)))
        if roll_angle > 8.0:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("head_not_level")
            if "excessive_head_pose" not in result["quality"]["reasons"]:
                result["quality"]["reasons"].append("excessive_head_pose")

        # 3. Yaw (facing forward): rotation-invariant Euclidean eye-to-nose ratio
        dL = math.hypot(nose.x - left_eye.x, nose.y - left_eye.y)
        dR = math.hypot(nose.x - right_eye.x, nose.y - right_eye.y)
        if (dL + dR) > 0:
            eye_ratio = abs(dL - dR) / (dL + dR)
            if eye_ratio > 0.14:  # approx > 12 degrees turned
                result["quality"]["status"] = "invalid"
                result["quality"]["reasons"].append("not_facing_camera")
                if "excessive_head_pose" not in result["quality"]["reasons"]:
                    result["quality"]["reasons"].append("excessive_head_pose")
            
        # 4. Pitch (camera at eye level): eye-nose vs nose-chin ratio
        eye_y = (left_eye.y + right_eye.y) / 2.0
        eye_nose_dist = nose.y - eye_y
        nose_chin_dist = chin.y - nose.y
        if nose_chin_dist > 0:
            ratio = eye_nose_dist / nose_chin_dist
            # typical ratio is around 0.55 to 0.95
            if ratio < 0.50 or ratio > 1.05:
                result["quality"]["status"] = "invalid"
                result["quality"]["reasons"].append("head_not_level")
                if "excessive_head_pose" not in result["quality"]["reasons"]:
                    result["quality"]["reasons"].append("excessive_head_pose")
            
        if len(result["quality"]["reasons"]) == 0:
            result["quality"]["status"] = "valid"
            
        # Map landmarks back to original image size
        mapped_landmarks = []
        for lm in landmarks:
            mapped_landmarks.append((lm.x * w, lm.y * h))
        result["landmarks"] = np.array(mapped_landmarks)
        
        return result


def get_capture_guidance_message(quality_dict: Dict) -> str:
    """
    Returns user-friendly capture guidance message according to SmartFrame AI Phase 1 specifications.
    """
    if quality_dict.get("status") == "valid":
        return "Face detected. You can continue."
    
    reasons = quality_dict.get("reasons", [])
    if "no_face" in reasons:
        return "Face not detected. Please position your face in the frame."
    if "not_facing_camera" in reasons:
        return "Please face the camera directly."
    if "head_not_level" in reasons:
        return "Keep your head level and try again."
    if "excessive_head_pose" in reasons:
        return "Please face the camera directly."
    if "face_not_centered" in reasons:
        return "Keep your face centered."
    if "face_too_small" in reasons:
        return "Keep the face sufficiently close and clearly visible."
    if "multiple_faces" in reasons:
        return "Multiple faces detected. Please ensure only one person is in the frame."
    if "too_dark" in reasons:
        return "Lighting is too dark. Please move to a brighter area."
    if "too_bright" in reasons:
        return "Lighting is too harsh. Please reduce glare."
    if "blur" in reasons:
        return "Image is blurry. Please hold steady and try again."
    
    return "Please position your face directly in front of the camera and try again."

# Global instance to be reused
shared_face_analyzer = SharedFaceAnalyzer()
