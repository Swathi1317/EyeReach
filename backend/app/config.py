from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "EyeReach – Home Testing App"
    VERSION: str = "0.1.0"
    
    # Image Quality Thresholds
    IMAGE_MAX_SIZE: int = 1280
    MIN_FACE_HEIGHT_RATIO: float = 0.25
    BLUR_THRESHOLD: float = 100.0
    MIN_BRIGHTNESS: float = 40.0
    MAX_BRIGHTNESS: float = 240.0
    MAX_YAW: float = 12.0
    MAX_PITCH: float = 12.0
    MAX_ROLL: float = 10.0
    
    # IPD Thresholds
    IRIS_DIAMETER_MM: float = 11.7
    IRIS_DIAMETER_MISMATCH_MAX: float = 0.15
    ADULT_MIN_IPD_MM: float = 50.0
    ADULT_MAX_IPD_MM: float = 78.0
    
    # Face Shape
    FACE_SHAPE_CONFIDENCE_THRESHOLD: float = 0.6
    
    # Recommender Weights
    WEIGHT_FACE_SHAPE: float = 0.4
    WEIGHT_FIT: float = 0.3
    WEIGHT_COLOR: float = 0.2
    WEIGHT_PRICE: float = 0.1

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

settings = Settings()
