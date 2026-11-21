"""
SmartFrame AI - Dataset Classifier & Organizer
Automatically inspects, classifies, and organizes unlabelled facial images into:
Heart, Oblong, Oval, Round, Square, and Review_Required.

Preserves all original images in their original locations.
Generates classification_report.csv and an interactive review tool.
"""

import os
import sys
import glob
import shutil
import hashlib
import argparse
import logging
from typing import Dict, Tuple, Optional, List

import cv2
import numpy as np
import pandas as pd
import joblib
from PIL import Image

# Register HEIF/HEIC opener for iPhone/mobile photos
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

# Ensure backend modules are discoverable
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.ml.build_features import FaceFeatureExtractor
from backend.ml.face_utils import shared_face_analyzer

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("classify_dataset")


def compute_md5(file_path: str) -> str:
    """Compute MD5 hash of a file for duplicate detection."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def load_image_bgr(file_path: str) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """
    Safely load an image into BGR numpy array.
    Supports standard formats (.jpg, .jpeg, .png) and .heic/.HEIC.
    Returns (image_bgr, error_message).
    """
    ext = os.path.splitext(file_path)[1].lower()
    try:
        if ext in [".heic", ".heif"]:
            pil_img = Image.open(file_path)
            rgb_arr = np.array(pil_img.convert("RGB"))
            bgr_arr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
            return bgr_arr, None
        else:
            img = cv2.imread(file_path)
            if img is None:
                # Try Pillow fallback for non-standard JPEGs
                pil_img = Image.open(file_path)
                rgb_arr = np.array(pil_img.convert("RGB"))
                return cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR), None
            return img, None
    except Exception as e:
        return None, str(e)


def extract_features_with_orientation(
    img_bgr: np.ndarray,
    extractor: FaceFeatureExtractor
) -> Tuple[Optional[Dict[str, float]], Optional[np.ndarray], int]:
    """
    Extract FaceMesh features, attempting 0, 90, 180, and 270 deg rotation
    if the initial orientation yields no landmarks.
    Returns (features_dict, oriented_image, rotation_applied_degrees).
    """
    rotations = [
        (None, 0),
        (cv2.ROTATE_90_CLOCKWISE, 90),
        (cv2.ROTATE_180, 180),
        (cv2.ROTATE_90_COUNTERCLOCKWISE, 270),
    ]

    for rot_code, angle in rotations:
        cand = img_bgr if rot_code is None else cv2.rotate(img_bgr, rot_code)
        h, w = cand.shape[:2]
        max_size = 1280
        proc_img = cand
        if max(h, w) > max_size:
            scale = max_size / max(h, w)
            proc_img = cv2.resize(cand, (int(w * scale), int(h * scale)))

        results = extractor.face_mesh.process(cv2.cvtColor(proc_img, cv2.COLOR_BGR2RGB))
        if results.multi_face_landmarks:
            landmarks = results.multi_face_landmarks[0].landmark
            h_p, w_p = proc_img.shape[:2]
            coords = np.array([[lm.x * w_p, lm.y * h_p] for lm in landmarks])
            feats = extractor._compute_features(coords)
            if feats is not None:
                return feats, cand, angle

    return None, None, 0


def classify_and_organize(
    input_dir: str,
    output_dir: str,
    model_path: str,
    confidence_threshold: float = 0.45,
    margin_threshold: float = 0.10,
):
    logger.info("=" * 65)
    logger.info(" SmartFrame AI - Dataset Classifier & Organizer")
    logger.info("=" * 65)
    logger.info(f"Input Directory:  {input_dir}")
    logger.info(f"Output Directory: {output_dir}")
    logger.info(f"Model Artifact:   {model_path}")
    logger.info(f"Min Confidence:   {confidence_threshold:.0%}")
    logger.info(f"Min Margin:       {margin_threshold:.0%}")

    if not os.path.exists(input_dir):
        logger.error(f"Input directory does not exist: {input_dir}")
        return

    # Load trained model artifact
    if not os.path.exists(model_path):
        logger.error(f"Model artifact not found: {model_path}")
        return

    logger.info("Loading face shape model artifact...")
    artifact = joblib.load(model_path)
    pipeline = artifact["pipeline"]
    le = artifact["label_encoder"]
    feature_cols = artifact["feature_cols"]
    classes = list(artifact["classes"])
    logger.info(f"Model loaded: {artifact.get('model_name', 'Classifier')} | Classes: {classes}")

    # Output directories
    target_dirs = {c: os.path.join(output_dir, c) for c in classes}
    target_dirs["Review_Required"] = os.path.join(output_dir, "Review_Required")

    for d in target_dirs.values():
        os.makedirs(d, exist_ok=True)

    # 1. Discover all files
    all_entries = [os.path.join(input_dir, f) for f in os.listdir(input_dir)]
    files = [f for f in all_entries if os.path.isfile(f)]
    logger.info(f"Discovered {len(files)} files in input directory.")

    # 2. Check for duplicate hashes
    hashes = {}
    duplicate_map = {}
    for f in files:
        h = compute_md5(f)
        if h in hashes:
            duplicate_map[f] = hashes[h]
        else:
            hashes[h] = f

    if duplicate_map:
        logger.warning(f"Detected {len(duplicate_map)} duplicate file(s) in input dataset:")
        for dup, orig in duplicate_map.items():
            logger.warning(f"  {os.path.basename(dup)} is identical to {os.path.basename(orig)}")
    else:
        logger.info("Duplicate check: 0 duplicates found across all files.")

    # 3. Process each image
    extractor = FaceFeatureExtractor()
    records = []
    class_counts = {c: 0 for c in classes}
    class_counts["Review_Required"] = 0

    corrupt_count = 0
    duplicate_count = len(duplicate_map)

    for idx, f in enumerate(files, 1):
        filename = os.path.basename(f)
        logger.info(f"[{idx}/{len(files)}] Processing {filename}...")

        # Base record
        rec = {
            "image_filename": filename,
            "original_path": os.path.abspath(f),
            "predicted_face_shape": "Unknown",
            "confidence": 0.0,
            "review_status": "REVIEW_REQUIRED",
            "reason_for_classification": "",
            "top2_face_shape": "",
            "top2_confidence": 0.0,
            "margin": 0.0,
            "face_detected": False,
            "rotation_applied_deg": 0,
            "quality_warnings": "",
            "destination_folder": ""
        }

        # Check for duplicate
        if f in duplicate_map:
            rec["predicted_face_shape"] = "Review_Required"
            rec["review_status"] = "REVIEW_REQUIRED"
            rec["reason_for_classification"] = f"Duplicate of {os.path.basename(duplicate_map[f])}"
            dest = os.path.join(target_dirs["Review_Required"], filename)
            shutil.copy2(f, dest)
            rec["destination_folder"] = "Review_Required"
            class_counts["Review_Required"] += 1
            records.append(rec)
            continue

        # Load image
        img_bgr, err = load_image_bgr(f)
        if img_bgr is None:
            corrupt_count += 1
            rec["predicted_face_shape"] = "Corrupt"
            rec["review_status"] = "REVIEW_REQUIRED"
            rec["reason_for_classification"] = f"Corrupt/unreadable image: {err}"
            dest = os.path.join(target_dirs["Review_Required"], filename)
            shutil.copy2(f, dest)
            rec["destination_folder"] = "Review_Required"
            class_counts["Review_Required"] += 1
            records.append(rec)
            continue

        # Check with SharedFaceAnalyzer
        qa = shared_face_analyzer.process_image(img_bgr)
        q_reasons = qa["quality"]["reasons"]
        rec["quality_warnings"] = "; ".join(q_reasons) if q_reasons else "none"

        # Check for multiple faces
        if "multiple_faces" in q_reasons:
            rec["face_detected"] = True
            rec["predicted_face_shape"] = "Review_Required"
            rec["review_status"] = "REVIEW_REQUIRED"
            rec["reason_for_classification"] = "Multiple faces detected in image (group/multi-person photo)"
            dest = os.path.join(target_dirs["Review_Required"], filename)
            shutil.copy2(f, dest)
            rec["destination_folder"] = "Review_Required"
            class_counts["Review_Required"] += 1
            records.append(rec)
            continue

        # Extract features (with orientation fallback)
        feats, oriented_img, rot_deg = extract_features_with_orientation(img_bgr, extractor)
        rec["rotation_applied_deg"] = rot_deg

        if feats is None:
            rec["face_detected"] = False
            rec["predicted_face_shape"] = "Review_Required"
            rec["review_status"] = "REVIEW_REQUIRED"
            rec["reason_for_classification"] = "No usable face detected by MediaPipe FaceMesh"
            dest = os.path.join(target_dirs["Review_Required"], filename)
            shutil.copy2(f, dest)
            rec["destination_folder"] = "Review_Required"
            class_counts["Review_Required"] += 1
            records.append(rec)
            continue

        rec["face_detected"] = True

        # Append individual geometric features to record
        for k, v in feats.items():
            rec[k] = round(float(v), 4)

        # Predict using model pipeline
        df_feat = pd.DataFrame([feats])[feature_cols]
        probs = pipeline.predict_proba(df_feat.values)[0]
        sorted_indices = np.argsort(probs)[::-1]

        top1_idx = sorted_indices[0]
        top2_idx = sorted_indices[1]

        top1_class = classes[top1_idx]
        top1_prob = float(probs[top1_idx])

        top2_class = classes[top2_idx]
        top2_prob = float(probs[top2_idx])

        margin = top1_prob - top2_prob

        rec["predicted_face_shape"] = top1_class
        rec["confidence"] = round(top1_prob, 4)
        rec["top2_face_shape"] = top2_class
        rec["top2_confidence"] = round(top2_prob, 4)
        rec["margin"] = round(margin, 4)

        # Apply strict ambiguity & confidence criteria
        reasons = []
        is_review = False

        if top1_prob < confidence_threshold:
            is_review = True
            reasons.append(f"Low model confidence ({top1_prob:.1%} < {confidence_threshold:.0%})")

        if margin < margin_threshold:
            is_review = True
            reasons.append(f"Ambiguous margin ({top1_class} {top1_prob:.1%} vs {top2_class} {top2_prob:.1%})")

        if "face_too_small" in q_reasons:
            is_review = True
            reasons.append("Face takes up <15% of image width")

        if is_review:
            rec["review_status"] = "REVIEW_REQUIRED"
            rec["reason_for_classification"] = "; ".join(reasons)
            dest = os.path.join(target_dirs["Review_Required"], filename)
            shutil.copy2(f, dest)
            rec["destination_folder"] = "Review_Required"
            class_counts["Review_Required"] += 1
        else:
            rec["review_status"] = "AUTO_CLASSIFIED"
            reasons_auto = [f"Confident {top1_class} prediction ({top1_prob:.1%} probability, {margin:.1%} margin)"]
            if rot_deg > 0:
                reasons_auto.append(f"Detected with {rot_deg}° orientation correction")
            rec["reason_for_classification"] = "; ".join(reasons_auto)
            dest = os.path.join(target_dirs[top1_class], filename)
            shutil.copy2(f, dest)
            rec["destination_folder"] = top1_class
            class_counts[top1_class] += 1

        records.append(rec)

    # 4. Save Classification Report CSV
    report_path = os.path.join(output_dir, "classification_report.csv")
    df_report = pd.DataFrame(records)
    df_report.to_csv(report_path, index=False)
    logger.info(f"Classification report successfully written to: {report_path}")

    # 5. Create Interactive HTML Review Tool
    create_review_tool_html(output_dir, df_report, classes)

    # 6. Verification and Summary
    logger.info("\n" + "=" * 65)
    logger.info(" CLASSIFICATION & ORGANIZATION SUMMARY")
    logger.info("=" * 65)
    logger.info(f"Total Original Images:        {len(files)}")
    logger.info(f"Total Organized Copies:       {sum(class_counts.values())}")
    logger.info(f"Total Duplicates Detected:    {duplicate_count}")
    logger.info(f"Total Corrupt Images:         {corrupt_count}")
    logger.info("-" * 65)
    logger.info("Breakdown by Destination Class:")
    for c in classes:
        logger.info(f"  {c:<12}: {class_counts[c]:>3} images ({class_counts[c]/len(files):.1%})")
    logger.info(f"  {'Review_Required':<12}: {class_counts['Review_Required']:>3} images ({class_counts['Review_Required']/len(files):.1%})")
    logger.info("=" * 65)
    logger.info("Original images were preserved without modification.")
    logger.info(f"Open review tool at: file:///{os.path.abspath(os.path.join(output_dir, 'review_tool.html'))}")

    return df_report


def create_review_tool_html(output_dir: str, df: pd.DataFrame, classes: List[str]):
    """Creates a standalone, interactive HTML review tool."""
    html_path = os.path.join(output_dir, "review_tool.html")

    cards_json = []
    for _, row in df.iterrows():
        # Relative path for image preview in browser
        rel_path = f"{row['destination_folder']}/{row['image_filename']}"
        cards_json.append({
            "filename": row["image_filename"],
            "rel_path": rel_path,
            "predicted": row["predicted_face_shape"],
            "confidence": float(row["confidence"]),
            "status": row["review_status"],
            "reason": row["reason_for_classification"],
            "top2": row["top2_face_shape"],
            "top2_conf": float(row["top2_confidence"]),
            "folder": row["destination_folder"]
        })

    import json
    data_js = json.dumps(cards_json)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SmartFrame AI - Dataset Label Review Tool</title>
<style>
  :root {{
    --bg: #0f172a;
    --card: #1e293b;
    --border: #334155;
    --text: #f8fafc;
    --muted: #94a3b8;
    --primary: #3b82f6;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
  }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 20px 40px;
  }}
  header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
    margin-bottom: 25px;
  }}
  h1 {{ margin: 0; font-size: 24px; color: #60a5fa; }}
  .subtitle {{ color: var(--muted); font-size: 14px; margin-top: 4px; }}
  .toolbar {{
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
    align-items: center;
    flex-wrap: wrap;
  }}
  button {{
    background: var(--primary);
    color: white;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: 0.2s;
  }}
  button:hover {{ filter: brightness(1.15); }}
  button.btn-success {{ background: var(--success); }}
  button.btn-secondary {{ background: #475569; }}
  .filter-group {{
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
  }}
  select, input {{
    background: #0f172a;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 6px;
  }}
  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
  }}
  .card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
  }}
  .card.status-review {{ border-color: var(--warning); }}
  .card.status-approved {{ border-color: var(--success); }}
  .img-container {{
    height: 260px;
    background: #020617;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }}
  .img-container img {{
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }}
  .card-body {{
    padding: 14px;
    flex: 1;
    display: flex;
    flex-direction: column;
  }}
  .fname {{
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    word-break: break-all;
    margin-bottom: 8px;
  }}
  .badge {{
    display: inline-block;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }}
  .badge-AUTO_CLASSIFIED {{ background: rgba(16,185,129,0.2); color: #34d399; }}
  .badge-REVIEW_REQUIRED {{ background: rgba(245,158,11,0.2); color: #fbbf24; }}
  .meter {{
    height: 6px;
    background: #334155;
    border-radius: 3px;
    overflow: hidden;
    margin: 8px 0;
  }}
  .meter-fill {{
    height: 100%;
    background: var(--primary);
  }}
  .stats-row {{
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 4px;
  }}
  .reason {{
    font-size: 11px;
    color: #cbd5e1;
    background: #0f172a;
    padding: 6px 8px;
    border-radius: 4px;
    margin-top: 6px;
    margin-bottom: 12px;
    flex: 1;
  }}
  .selector-row {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: auto;
  }}
  .selector-row label {{ font-size: 12px; color: var(--muted); }}
  .selector-row select {{ flex: 1; font-weight: 600; }}
</style>
</head>
<body>

<header>
  <div>
    <h1>SmartFrame AI - Dataset Label Review Tool</h1>
    <div class="subtitle">Human-in-the-Loop review & verification before ML training</div>
  </div>
  <div style="text-align: right;">
    <button class="btn-success" onclick="exportVerifiedLabels()">Save Verified Labels CSV</button>
  </div>
</header>

<div class="toolbar">
  <button class="btn-secondary" onclick="approveAllHighConfidence()">Approve All High-Confidence (&ge;70%)</button>
  <button class="btn-secondary" onclick="resetAll()">Reset to Predicted</button>
  <div class="filter-group">
    <label>Filter:</label>
    <select id="filterSelect" onchange="renderCards()">
      <option value="ALL">All Items</option>
      <option value="REVIEW_REQUIRED">Review Required Only</option>
      <option value="AUTO_CLASSIFIED">Auto Classified Only</option>
      <option value="Heart">Heart Only</option>
      <option value="Oblong">Oblong Only</option>
      <option value="Oval">Oval Only</option>
      <option value="Round">Round Only</option>
      <option value="Square">Square Only</option>
    </select>
  </div>
</div>

<div class="grid" id="cardGrid"></div>

<script>
const items = {data_js};
const classes = {json.dumps(classes)};

// State: verified class for each item
const verifiedLabels = {{}};
items.forEach(it => {{
  verifiedLabels[it.filename] = it.predicted !== "Unknown" && it.predicted !== "Corrupt" && it.predicted !== "Review_Required" ? it.predicted : "DISCARD";
}});

function renderCards() {{
  const filter = document.getElementById("filterSelect").value;
  const grid = document.getElementById("cardGrid");
  grid.innerHTML = "";

  items.forEach(it => {{
    if (filter === "REVIEW_REQUIRED" && it.status !== "REVIEW_REQUIRED") return;
    if (filter === "AUTO_CLASSIFIED" && it.status !== "AUTO_CLASSIFIED") return;
    if (classes.includes(filter) && it.predicted !== filter) return;

    const card = document.createElement("div");
    card.className = "card " + (it.status === "REVIEW_REQUIRED" ? "status-review" : "status-approved");

    const confPct = (it.confidence * 100).toFixed(1);
    const currClass = verifiedLabels[it.filename];

    let optionsHtml = classes.map(c => `<option value="${{c}}" ${{currClass === c ? "selected" : ""}}>${{c}}</option>`).join("");
    optionsHtml += `<option value="DISCARD" ${{currClass === "DISCARD" ? "selected" : ""}}>-- Discard / Unusable --</option>`;

    card.innerHTML = `
      <div class="img-container">
        <img src="${{it.rel_path}}" alt="${{it.filename}}" loading="lazy" onerror="this.src=''; this.alt='Image preview unavailable';"/>
      </div>
      <div class="card-body">
        <div class="fname">${{it.filename}}</div>
        <div class="stats-row">
          <span>Predicted: <strong>${{it.predicted}}</strong></span>
          <span class="badge badge-${{it.status}}">${{it.status}}</span>
        </div>
        <div class="meter">
          <div class="meter-fill" style="width: ${{confPct}}%;"></div>
        </div>
        <div class="stats-row">
          <span>Confidence: ${{confPct}}%</span>
          <span>Top 2: ${{it.top2}} (${{(it.top2_conf * 100).toFixed(0)}}%)</span>
        </div>
        <div class="reason">${{it.reason || "High confidence classification"}}</div>
        <div class="selector-row">
          <label>Verified:</label>
          <select onchange="updateLabel('${{it.filename}}', this.value)">
            ${{optionsHtml}}
          </select>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }});
}}

function updateLabel(filename, val) {{
  verifiedLabels[filename] = val;
}}

function approveAllHighConfidence() {{
  items.forEach(it => {{
    if (it.confidence >= 0.70 && classes.includes(it.predicted)) {{
      verifiedLabels[it.filename] = it.predicted;
    }}
  }});
  renderCards();
  alert("All images with confidence >= 70% have been confirmed!");
}}

function resetAll() {{
  items.forEach(it => {{
    verifiedLabels[it.filename] = it.predicted !== "Unknown" && it.predicted !== "Corrupt" ? it.predicted : "DISCARD";
  }});
  renderCards();
}}

function exportVerifiedLabels() {{
  let csv = "image_filename,verified_face_shape,original_predicted,confidence\\n";
  items.forEach(it => {{
    csv += `"${{it.filename}}","${{verifiedLabels[it.filename]}}","${{it.predicted}}",${{it.confidence}}\\n`;
  }});

  const blob = new Blob([csv], {{ type: "text/csv;charset=utf-8;" }});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "verified_labels.csv";
  link.click();
}}

renderCards();
</script>
</body>
</html>
"""

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    logger.info(f"Interactive review tool created at: {html_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SmartFrame AI Dataset Classifier & Organizer")
    parser.add_argument("--input_dir", default="D:/SmartframeAi/Data/Dataset", help="Path to input images folder")
    parser.add_argument("--output_dir", default="D:/SmartframeAi/Data/Classified_Dataset", help="Output directory")
    parser.add_argument("--model_path", default="D:/SmartframeAi/SmartFrameAI/backend/ml/models/face_shape_model.joblib", help="Path to face shape model")
    parser.add_argument("--confidence_threshold", type=float, default=0.45, help="Confidence threshold")
    parser.add_argument("--margin_threshold", type=float, default=0.10, help="Top-1 vs Top-2 margin threshold")

    args = parser.parse_args()
    classify_and_organize(
        input_dir=args.input_dir,
        output_dir=args.output_dir,
        model_path=args.model_path,
        confidence_threshold=args.confidence_threshold,
        margin_threshold=args.margin_threshold,
    )
