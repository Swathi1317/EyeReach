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
            
        # 5. Eye Detection and Openness Check (Avoid blinks or closed eyes during capture)
        # Check both eye contours and calculate Eye Aspect Ratio (EAR)
        # Right eye: 33 (outer), 133 (inner), 159 (upper), 145 (lower)
        # Left eye: 263 (outer), 362 (inner), 386 (upper), 374 (lower)
        if len(landmarks) >= 468:
            r_eye_w = math.hypot(landmarks[33].x - landmarks[133].x, landmarks[33].y - landmarks[133].y)
            r_eye_h = math.hypot(landmarks[159].x - landmarks[145].x, landmarks[159].y - landmarks[145].y)
            r_ear = r_eye_h / max(0.001, r_eye_w)

            l_eye_w = math.hypot(landmarks[263].x - landmarks[362].x, landmarks[263].y - landmarks[362].y)
            l_eye_h = math.hypot(landmarks[386].x - landmarks[374].x, landmarks[386].y - landmarks[374].y)
            l_ear = l_eye_h / max(0.001, l_eye_w)

            # Strict eye detection: both eyes must be open and not blinking
            if r_ear < 0.11 or l_ear < 0.11:
                result["quality"]["status"] = "invalid"
                result["quality"]["reasons"].append("eyes_closed_or_blinking")

        # 6. Both Ears Detection (when visible in frame)
        # Right ear tragus (234), Left ear tragus (454)
        r_ear_vis = bool(landmarks[234].x >= 0.01 and landmarks[234].x < landmarks[33].x and abs(landmarks[234].y - right_eye.y) < 0.22)
        l_ear_vis = bool(landmarks[454].x <= 0.99 and landmarks[454].x > landmarks[263].x and abs(landmarks[454].y - left_eye.y) < 0.22)
        result["ears_detected"] = {
            "right_ear": r_ear_vis,
            "left_ear": l_ear_vis,
            "both_ears": bool(r_ear_vis and l_ear_vis)
        }

        # 7. Facial Landmark Integrity & Spatial Positioning Check
        # Forehead above nose, nose above chin, horizontal eye order
        if not (forehead.y < nose.y - 0.04 and nose.y < chin.y - 0.04 and right_eye.x < left_eye.x):
            result["quality"]["status"] = "invalid"
            result["quality"]["reasons"].append("incomplete_or_misplaced_landmarks")

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
    if "eyes_closed_or_blinking" in reasons:
        return "Please open both eyes clearly."
    if "incomplete_or_misplaced_landmarks" in reasons:
        return "Facial landmarks not properly positioned. Please align your face directly."
    if "head_not_level" in reasons:
        return "Keep your head level and try again."
    if "excessive_head_pose" in reasons:
        return "Please face the camera directly."
    if "face_not_centered" in reasons:
        return "Keep your face centered."
    if "face_too_small" in reasons:
        return "You are too far from the camera. Please come closer."
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
