# SmartFrame AI

SmartFrame AI is a selfie-based eyewear recommendation system.

## Project Phases

### Phase 1: Scaffold & Face-Shape ML
- Core FastAPI setup, models, and dependencies.
- Extracted 11 geometric facial features from FaceMesh.
- Stratified 5-Fold Cross Validation tuning across Random Forest, KNN, and XGBoost.
- XGBoost selected as the core Face Shape ML classifier.

### Phase 2: IPD Measurement & Skin Tone Analysis (Current)
- **IPD Measurement Methodology:** 
  - Extracts MediaPipe iris landmarks (468, 473) to measure pixel distance between the eyes.
  - **Calibrated IPD:** If the user supplies a known reference scale (`reference_width_mm` and `reference_width_px`), physical IPD is computed with high accuracy.
  - **Estimated IPD:** If uncalibrated, a software heuristic estimates IPD based on average adult facial width (cheeks). *Warning: Uncalibrated estimates are not clinically accurate and should be treated as software plausibility only.*
  - **Multi-Frame Support:** For camera modes, multiple valid frames can be sent to calculate a robust median IPD with variance and confidence scores.
- **Skin Tone Methodology:**
  - Extracts safe skin regions (cheeks and forehead) directly from FaceMesh polygons.
  - Excludes eyes, lips, and hair.
  - Uses CIE L*a*b* color space for robust lighting and undertone classification (Cool vs Warm vs Neutral).
  - Flags images with poor lighting quality (too dark, too bright, or excessive shadows).
- **Limitations:** Skin tone analysis is intended exclusively for eyewear color recommendation and makes no health, race, ethnicity, or medical claims. Uncalibrated IPD is an estimate, not a medical measurement.

### Upcoming Phases
- Frame recommendation logic.
- E-commerce integration.
- Virtual try-on and store locator.

## Environment Setup

### 1. Python version
Ensure you have Python 3.12 (in our venv) with `mediapipe==0.10.14`.

### 2. Virtual Environment Creation
Using Windows PowerShell:
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 3. Installation
```powershell
pip install -r backend/requirements.txt
```

### 4. Running the Backend
Ensure you are at the root of the project (`SmartFrameAI/`).
```powershell
$env:PYTHONPATH = (Get-Location).Path
uvicorn backend.app.main:app --reload
```

### 5. Opening Swagger Docs
Open your browser and navigate to: [http://localhost:8000/docs](http://localhost:8000/docs)

### 6. Running Tests
```powershell
pytest backend/tests/ -v
```
