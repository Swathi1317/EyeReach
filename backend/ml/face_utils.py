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
            
        # Check head pose (strict heuristic for ~8 deg)
        nose = landmarks[1]
        left_eye = landmarks[33]
        right_eye = landmarks[263]
        
        # Yaw
        mid_x = (left_cheek.x + right_cheek.x) / 2.0
        face_w = abs(right_cheek.x - left_cheek.x)
        if abs(nose.x - mid_x) > face_w * 0.06:  # approx < 8 degrees
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("excessive_head_pose")
            
        # Roll
        import math
        dy = right_eye.y - left_eye.y
        dx = right_eye.x - left_eye.x
        roll_angle = abs(math.degrees(math.atan2(dy, dx)))
        if roll_angle > 6.0:
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("excessive_head_pose")
            
        # Pitch (rough heuristic comparing eye-nose vs nose-chin ratio)
        chin = landmarks[152]
        eye_y = (left_eye.y + right_eye.y) / 2.0
        eye_nose_dist = nose.y - eye_y
        nose_chin_dist = chin.y - nose.y
        if nose_chin_dist > 0:
            ratio = eye_nose_dist / nose_chin_dist
            # typical ratio is around 0.65 to 0.85
            if ratio < 0.55 or ratio > 0.95:
                result["quality"]["status"] = "invalid"
                result["quality"]["reasons"].append("excessive_head_pose")
            
        if len(result["quality"]["reasons"]) == 0:
            result["quality"]["status"] = "valid"
            
        # Map landmarks back to original image size
        mapped_landmarks = []
        for lm in landmarks:
            mapped_landmarks.append((lm.x * w, lm.y * h))
        result["landmarks"] = np.array(mapped_landmarks)
        
        return result

# Global instance to be reused
shared_face_analyzer = SharedFaceAnalyzer()
