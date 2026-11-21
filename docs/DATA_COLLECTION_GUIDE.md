# SmartFrame AI - Dataset Collection & Verification Guide

This guide establishes the standardized acquisition, quality control, annotation, and verification protocol for expanding the SmartFrame AI facial morphology dataset across the **five canonical face shapes**:

1. **Heart**
2. **Oblong**
3. **Oval**
4. **Round**
5. **Square**

---

## 1. Initial Collection Target & Class Deficit

To construct a robust 5-class machine learning dataset with reproducible 70% Train / 15% Validation / 15% Test splits and 5-fold cross-validation, the project has established an **initial milestone target of at least 100 genuine, human-verified images per class** (500 total valid images).

### Current Status & Deficit Breakdown:

| Class | Current Verified | Collection Target | Additional Images Needed | Deficit Severity |
| :--- | :---: | :---: | :---: | :--- |
| **Square** | 0 | 100 | **+100** | 🔴 Extreme (Zero samples) |
| **Oblong** | 1 | 100 | **+99** | 🔴 Critical (1 sample) |
| **Heart** | 2 | 100 | **+98** | 🔴 Critical (2 samples) |
| **Round** | 29 | 100 | **+71** | 🟡 Moderate |
| **Oval** | 34 | 100 | **+66** | 🟡 Moderate |
| **Total Valid** | **66** | **500** | **+434** | **Requires Focused Collection** |

*(9 additional collected images were skipped/excluded due to blur or distance <15% frame width).*

---

## 2. Anatomical Classification Criteria (Farkas Anthropometry)

Facial classification must adhere to clinical craniofacial morphology rules, not subjective visual impression:

```
  1. SQUARE               2. OBLONG               3. HEART
  ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
  │ ┌─────────┐ │        │   ┌─────┐   │        │ ┌─────────┐ │
  │ │         │ │        │   │     │   │        │  \       /  │
  │ └─────────┘ │        │   │     │   │        │   \     /   │
  └─────────────┘        │   └─────┘   │        │    \___/    │
  Aspect Ratio ≤ 1.20    └─────────────┘        └─────────────┘
  Jaw Angle ≤ 130°       Aspect Ratio ≥ 1.45    Wide Forehead
  Broad Flat Chin                               Pointed Chin (≤ 90°)

  4. ROUND               5. OVAL
  ┌─────────────┐        ┌─────────────┐
  │   .-----.   │        │   .-----.   │
  │  /       \  │        │  /       \  │
  │  \       /  │        │  |       |  │
  │   `-----'   │        │   \     /   │
  └─────────────┘        │    `---'    │
  Aspect Ratio ≤ 1.20    └─────────────┘
  Curved Jaw > 135°      Aspect Ratio 1.20 - 1.45
  Soft Contour           Balanced Egg Shape
```

### Detailed Class Signatures:

#### 1. Square
- **Length-to-Width Ratio ($L/W$):** $\le 1.20$ (compact vertical height relative to cheekbone breadth).
- **Mandibular Jaw Angle:** $\le 130^\circ$ (sharp, defined, prominent gonial corners).
- **Chin Morphology:** Wide, horizontal, and flat ($\text{chin angle} \ge 102^\circ$, gonion-to-chin taper $< 35\%$).
- **Transverse Proportions:** Forehead width, cheekbone width, and jaw width are approximately equal ($Jaw/Cheek \ge 0.90$).

#### 2. Oblong (Long)
- **Length-to-Width Ratio ($L/W$):** $\ge 1.45$ (visibly elongated face).
- **Transverse Proportions:** Forehead, cheekbone, and jaw breadths are relatively uniform with straight lateral contours.
- **Cheekbones:** Not noticeably wider than forehead or jaw.

#### 3. Heart (Inverted Triangle)
- **Transverse Proportions:** Forehead and temples form the widest facial segment; jawline tapers sharply downward.
- **Chin Morphology:** Narrow, acute, and pointed ($\text{chin angle} \le 90^\circ$, gonion-to-chin taper $\ge 45\%$).
- **Upper-to-Lower Ratio:** $\text{Forehead Width} / \text{Jaw Width} \ge 1.10$.

#### 4. Round
- **Length-to-Width Ratio ($L/W$):** $\le 1.20$ (face length and cheekbone breadth nearly identical).
- **Mandibular Jaw Angle:** $> 135^\circ$ (soft, circular jawline without sharp bony corners).
- **Cheekbones:** Distinctly wider than both forehead and jawline.

#### 5. Oval
- **Length-to-Width Ratio ($L/W$):** $1.20 < L/W < 1.45$ (classic proportional balance).
- **Contour:** Smooth, continuous egg-shaped curve tapering gently from cheekbones to a softly rounded chin.
- **Jaw Angle:** $> 135^\circ$ (gentle curvature without angular flaring).

---

## 3. Image Capture & Quality Protocol

All photos must satisfy these strict quality constraints to ensure MediaPipe Face Mesh generates accurate 3D landmarks:

### A. Framing and Camera Alignment
- **Strictly Frontal Pose:** Direct eye contact with the camera. Pitch, yaw, and roll must remain within $\pm 10^\circ$. (Any turning beyond $15^\circ$ skews perceived jaw width).
- **Face Scale:** The face must fill **35% to 65% of the image frame**. Avoid wide full-body photos where the face is smaller than 200 pixels.
- **Camera Level:** Camera must be positioned at eye level (not high angle or low under-chin angle).

### B. Facial Exposure and Occlusion (Critical)
- **Forehead and Temples Exposed:** Hair must be parted or pulled back so MediaPipe landmarks 54 and 284 are visible. Bangs covering the forehead artificially compress forehead breadth.
- **Ears and Mandibular Angles Exposed:** Hair must be tucked behind ears to allow detection of gonial landmarks 132 and 361.
- **No Facial Hair Concealing Jawline:** Avoid subjects with heavy, bushy beards that disguise the bony mandibular contour.
- **No Accessories:** Eyeglasses, hats, scarves, masks, and large earrings must be removed during capture.

### C. Expression and Lighting
- **Neutral Expression:** Mouth closed, lips relaxed, eyes open. Smiling expands cheek breadth and shortens vertical midface measurements.
- **Diffuse Frontal Lighting:** Even illumination across both left and right cheeks. Avoid strong directional sidelight or deep overhead shadows.
- **Focus & Resolution:** Minimum resolution of $720 \times 720\text{ px}$ (preferred $1080 \times 1080\text{ px}$ or native smartphone portrait resolution). Zero motion blur.

### D. Demographic & Sensor Diversity
- **Gender Balance:** Target equal representation of male and female subjects across each class.
- **Age Distribution:** Collect across 18–30, 31–50, and 50+ age brackets.
- **Fitzpatrick Skin Tone Scale:** Include diverse complexions (Types I through VI) to ensure color-invariant landmark extraction.
- **Hardware Diversity:** Use multiple camera sensors (smartphones, webcams) to prevent overfitting to specific optical lens characteristics.

---

## 4. Ethical Compliance & Data Governance

1. **Informed Consent:** Explicit participant agreement must be obtained for research and machine learning evaluation.
2. **Privacy Protection:** Filenames must use anonymous identifiers (e.g. `subj_sq_001.jpg`) rather than personally identifying names.
3. **No Synthetic Images:** Do NOT use diffusion models (Midjourney, Stable Diffusion, DALL-E) or 3D synthetic face generators. Synthetic faces exhibit subtle landmark artifacts and non-natural mandibular geometry.
4. **No Artificially Duplicated Images:** Do NOT flip, re-crop, or duplicate photos of the same individual to inflate sample numbers.
5. **Person Identity Tracking:** Assign a unique `person_id` (e.g. `person_101`) to each participant to prevent identity leakage across Train/Val/Test splits.

---

## 5. Step-by-Step Batch Ingestion Workflow

```
[1. Collect Photos] ──► [2. Populate CSV Template] ──► [3. Ingestion & Validation Script] ──► [4. Human Review Tool] ──► [5. Export Verified Dataset]
```

### Step 1: Stage New Photos
Place newly collected raw images in a dedicated batch folder:
`D:\SmartframeAi\Data\New_Batches\`

### Step 2: Fill Out `data_collection_template.csv`
Open [`data_collection_template.csv`](file:///D:/SmartframeAi/Data/data_collection_template.csv) and register each image:

| image_filename | image_path | face_shape | person_id | consent_status | verification_status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `batch1_sq_01.jpg` | `D:\SmartframeAi\Data\New_Batches\batch1_sq_01.jpg` | `Square` | `person_101` | `GRANTED` | `PENDING_REVIEW` |
| `batch1_ob_01.jpg` | `D:\SmartframeAi\Data\New_Batches\batch1_ob_01.jpg` | `Oblong` | `person_102` | `GRANTED` | `PENDING_REVIEW` |
| `batch1_ht_01.jpg` | `D:\SmartframeAi\Data\New_Batches\batch1_ht_01.jpg` | `Heart` | `person_103` | `GRANTED` | `PENDING_REVIEW` |

- `face_shape`: Must be one of `Heart`, `Oblong`, `Oval`, `Round`, `Square`.
- `verification_status`: Always set to `PENDING_REVIEW`.

### Step 3: Run Batch Ingestion & Validation
Execute the ingestion script in PowerShell:
```powershell
D:\SmartframeAi\SmartFrameAI\venv\Scripts\python.exe D:\SmartframeAi\SmartFrameAI\scripts\ingest_new_batch.py --batch_csv "D:\SmartframeAi\Data\New_Batches\batch_manifest.csv"
```
The script will:
1. Verify image bitstream integrity and resolution.
2. Confirm consent status (`GRANTED`).
3. Run MediaPipe Face Mesh to extract anatomical proportions ($L/W$, jaw angle, chin angle).
4. Generate thumbnails in `previews/` and base64 payloads.
5. Append new records to the Review Tool with status `PENDING_REVIEW`.

### Step 4: Review and Verify in the Review Tool
Open the review tool:
```powershell
Start-Process "D:\SmartframeAi\Data\Classified_Dataset\review_tool.html"
```
Filter by `PENDING_REVIEW`, inspect the physical ratios, and confirm the true shape button (`Heart`, `Oblong`, `Oval`, `Round`, `Square`, or `Skip`).

### Step 5: Save Updated Manifest
Click **`💾 Save reviewed_labels_manifest.csv`** to preserve the verified annotations.
Existing verified labels and models are protected and never overwritten without explicit instruction.
