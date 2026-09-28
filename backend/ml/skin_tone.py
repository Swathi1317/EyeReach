import cv2
import numpy as np
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

# Skin tone categories (simplified, neutral)
TONE_CATEGORIES = [
    ("Very Light", (240, 240, 240)),  # Approx RGB
    ("Light", (225, 200, 180)),
    ("Medium Light", (200, 160, 130)),
    ("Medium", (160, 110, 80)),
    ("Medium Dark", (110, 70, 45)),
    ("Dark", (70, 40, 25)),
    ("Very Dark", (40, 20, 15))
]

# Undertone categories based on a* and b* in Lab space
# a* (green to red), b* (blue to yellow)
# Cool: Pink/red/blue hues (higher a*, lower b*)
# Warm: Yellow/golden/peach (higher b*, lower a*)
# Neutral: Balanced

def get_skin_mask(image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    """
    Creates a mask of the safe skin regions (cheeks, forehead).
    """
    h, w = image.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    
    # Cheek regions
    left_cheek_pts = np.array([landmarks[i] for i in [116, 117, 118, 119, 100, 120]], dtype=np.int32)
    right_cheek_pts = np.array([landmarks[i] for i in [345, 346, 347, 348, 329, 349]], dtype=np.int32)
    
    # Forehead region (lower part, avoiding hair)
    forehead_pts = np.array([landmarks[i] for i in [109, 10, 338, 297, 332, 284, 9]], dtype=np.int32)
    
    cv2.fillPoly(mask, [left_cheek_pts], 255)
    cv2.fillPoly(mask, [right_cheek_pts], 255)
    cv2.fillPoly(mask, [forehead_pts], 255)
    
    return mask

def classify_tone_and_undertone(lab_color: np.ndarray, rgb_color: np.ndarray) -> Dict:
    L, a, b = lab_color
    
    # Undertone heuristic
    if a > b + 2:
        undertone = "Cool"
    elif b > a + 5:
        undertone = "Warm"
    else:
        undertone = "Neutral"
        
    # Tone heuristic (closest Euclidean distance in RGB or L channel)
    min_dist = float('inf')
    best_tone = "Unknown"
    for tone_name, tone_rgb in TONE_CATEGORIES:
        dist = np.linalg.norm(rgb_color - np.array(tone_rgb))
        if dist < min_dist:
            min_dist = dist
            best_tone = tone_name
            
    return {
        "skin_tone": best_tone,
        "undertone": undertone,
        "rgb": rgb_color.tolist(),
        "lab": lab_color.tolist()
    }

def analyze_skin_tone(image_rgb: np.ndarray, landmarks: np.ndarray) -> Dict:
    """
    Extracts skin pixels using a mask, converts to Lab space, computes robust median,
    and classifies skin tone and undertone.
    """
    mask = get_skin_mask(image_rgb, landmarks)
    
    skin_pixels = cv2.bitwise_and(image_rgb, image_rgb, mask=mask)
    pixels = image_rgb[mask == 255]
    
    if len(pixels) < 100:
        return {
            "status": "invalid",
            "reasons": ["insufficient_skin_pixels"]
        }
        
    # Remove outliers by considering middle 50% percentile
    # Simplest approach: compute median
    median_rgb = np.median(pixels, axis=0)
    
    # Convert median RGB to Lab
    median_rgb_img = np.uint8([[median_rgb]])
    median_lab = cv2.cvtColor(median_rgb_img, cv2.COLOR_RGB2LAB)[0][0]
    
    # Assess lighting quality based on luminance (L channel 0-255 in opencv)
    L_channel = median_lab[0]
    lighting_quality = "Good"
    confidence = 0.90
    
    if L_channel < 30:
        lighting_quality = "Too Dark"
        confidence -= 0.3
    elif L_channel > 225:
        lighting_quality = "Too Bright"
        confidence -= 0.3
        
    # Calculate variance to see if there are heavy shadows or glare
    rgb_std = np.std(pixels, axis=0).mean()
    if rgb_std > 50:
        lighting_quality = "High Contrast / Shadows"
        confidence -= 0.2
        
    classification = classify_tone_and_undertone(median_lab, median_rgb)
    
    return {
        "status": "valid",
        "skin_tone": classification["skin_tone"],
        "undertone": classification["undertone"],
        "confidence": max(0.1, round(confidence, 2)),
        "lighting_quality": lighting_quality
    }
