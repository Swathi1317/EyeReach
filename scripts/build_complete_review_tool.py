"""
SmartFrame AI - Comprehensive Label Review Tool Generator & Asset Builder
Creates an interactive, robust, offline-capable Face Shape Label Review Tool
with zero CORS issues, pre-rendered thumbnails, embedded metadata,
real-time progress tracking, class filters, and 1-click manifest export.
"""

import os
import io
import json
import base64
import logging
from typing import Dict, List, Any
from PIL import Image
import pandas as pd

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("build_review_tool")

DATASET_DIR = "D:/SmartframeAi/Data/Dataset"
CLASSIFIED_DIR = "D:/SmartframeAi/Data/Classified_Dataset"
PREVIEWS_DIR = os.path.join(CLASSIFIED_DIR, "previews")
DOT_PREVIEWS_DIR = os.path.join(CLASSIFIED_DIR, ".previews")
REPORT_CSV = os.path.join(CLASSIFIED_DIR, "classification_report.csv")
MANIFEST_CSV = os.path.join(CLASSIFIED_DIR, "reviewed_labels_manifest.csv")
OUTPUT_HTML = os.path.join(CLASSIFIED_DIR, "review_tool.html")


def ensure_thumbnail_directories():
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    os.makedirs(DOT_PREVIEWS_DIR, exist_ok=True)


def build_review_tool():
    logger.info("=" * 68)
    logger.info(" SmartFrame AI - Building Complete Face Shape Review Tool")
    logger.info("=" * 68)

    ensure_thumbnail_directories()

    if not os.path.exists(REPORT_CSV):
        raise FileNotFoundError(f"Missing classification report: {REPORT_CSV}")

    df_report = pd.read_csv(REPORT_CSV)
    logger.info(f"Loaded {len(df_report)} records from {REPORT_CSV}")

    # Load existing manifest if available
    manifest_map = {}
    if os.path.exists(MANIFEST_CSV):
        try:
            df_manifest = pd.read_csv(MANIFEST_CSV)
            for _, r in df_manifest.iterrows():
                manifest_map[r["image_filename"]] = {
                    "reviewed_label": r.get("reviewed_label", "Skip"),
                    "lw_ratio": r.get("lw_ratio", 0.0),
                    "jaw_angle": r.get("jaw_angle", 0.0),
                    "chin_angle": r.get("chin_angle", 0.0),
                    "reason": r.get("reason", "")
                }
            logger.info(f"Loaded {len(manifest_map)} verified labels from {MANIFEST_CSV}")
        except Exception as e:
            logger.warning(f"Failed to read existing manifest: {e}")

    items: List[Dict[str, Any]] = []

    for idx, row in df_report.iterrows():
        fname = row["image_filename"]
        orig_path = row["original_path"]

        # Ensure valid original path
        if not os.path.exists(orig_path):
            cand = os.path.join(DATASET_DIR, fname)
            if os.path.exists(cand):
                orig_path = cand
            else:
                for root, _, files in os.walk(CLASSIFIED_DIR):
                    if fname in files:
                        orig_path = os.path.join(root, fname)
                        break

        # Process image and generate thumbnail + base64 data URI
        b64_str = ""
        base_name, _ = os.path.splitext(fname)

        try:
            pil_img = Image.open(orig_path).convert("RGB")
            pil_img.thumbnail((360, 360))

            # Save to buffer for base64
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=84)
            b64_str = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

            # Save to previews/ and .previews/ under all possible naming conventions
            for pdir in [PREVIEWS_DIR, DOT_PREVIEWS_DIR]:
                # 1. Exact filename (saved as JPEG content)
                p1 = os.path.join(pdir, fname)
                pil_img.save(p1, format="JPEG", quality=84)

                # 2. Base + .jpg
                p2 = os.path.join(pdir, f"{base_name}.jpg")
                pil_img.save(p2, format="JPEG", quality=84)

        except Exception as e:
            logger.warning(f"Error processing image thumbnail for {fname}: {e}")

        # Metadata extraction
        pred_shape = str(row["predicted_face_shape"])
        conf_val = float(row["confidence"]) if pd.notnull(row["confidence"]) else 0.0
        review_stat = str(row.get("review_status", "AUTO_CLASSIFIED"))
        reason_text = str(row.get("reason_for_classification", ""))
        top2_shape = str(row.get("top2_face_shape", ""))
        top2_conf_val = float(row.get("top2_confidence", 0.0)) if pd.notnull(row.get("top2_confidence", 0.0)) else 0.0

        # Manifest / anthropometric data
        man_info = manifest_map.get(fname, {})
        verified_lbl = man_info.get("reviewed_label", pred_shape if pred_shape in ["Heart", "Oblong", "Oval", "Round", "Square"] else "Skip")
        lw_ratio = float(man_info.get("lw_ratio", row.get("face_length_to_cheekbone_width", 0.0)))
        jaw_angle = float(man_info.get("jaw_angle", row.get("avg_jaw_angle", 0.0)))
        chin_angle = float(man_info.get("chin_angle", row.get("chin_angle", 0.0)))
        anthro_reason = man_info.get("reason", "")

        items.append({
            "id": idx + 1,
            "filename": fname,
            "original_path": orig_path,
            "predicted_face_shape": pred_shape,
            "confidence": conf_val,
            "review_status": review_stat,
            "reason": reason_text,
            "top2_face_shape": top2_shape,
            "top2_confidence": top2_conf_val,
            "verified_shape": verified_lbl,
            "lw_ratio": round(lw_ratio, 2),
            "jaw_angle": round(jaw_angle, 1),
            "chin_angle": round(chin_angle, 1),
            "anthro_reason": anthro_reason,
            "thumbnail_b64": b64_str,
            "preview_url": f"previews/{fname}"
        })

    logger.info(f"Generated complete embedded metadata and thumbnails for all {len(items)} images.")

    data_json = json.dumps(items)

    html_code = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SmartFrame AI - Face Shape Label Review Tool</title>
<style>
  :root {{
    --bg-main: #0b1120;
    --bg-card: #151e32;
    --border: #28354f;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --primary: #3b82f6;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --anthro: #a855f7;
    --skip: #64748b;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg-main);
    color: var(--text-main);
    margin: 0;
    padding: 24px 32px;
  }}
  header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 16px;
  }}
  .title-group h1 {{
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    color: #60a5fa;
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .title-group p {{
    margin: 6px 0 0 0;
    font-size: 14px;
    color: var(--text-muted);
  }}
  button {{
    background: var(--primary);
    color: white;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }}
  button:hover {{ filter: brightness(1.15); }}
  button.btn-success {{ background: #059669; }}
  button.btn-anthro {{ background: #9333ea; }}
  button.btn-secondary {{ background: #334155; }}

  .toolbar {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }}
  .stats-pill {{
    background: #0f172a;
    border: 1px solid var(--border);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .filter-box {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }}
  select {{
    background: #0b1120;
    color: var(--text-main);
    border: 1px solid var(--border);
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
  }}

  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 22px;
  }}
  .card {{
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
    transition: transform 0.15s ease, border-color 0.15s ease;
  }}
  .card:hover {{
    transform: translateY(-2px);
    border-color: #3b82f6;
  }}
  .card.is-skipped {{
    opacity: 0.72;
    border-color: #475569;
  }}
  .card.is-approved {{
    border-color: #10b981;
  }}

  .img-frame {{
    height: 250px;
    background: #030712;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }}
  .img-frame img {{
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transition: transform 0.2s ease;
  }}
  .img-frame:hover img {{
    transform: scale(1.04);
  }}
  .badge-index {{
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(15, 23, 42, 0.88);
    color: #f1f5f9;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
  }}
  .badge-status {{
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }}
  .badge-AUTO_CLASSIFIED {{ background: rgba(16,185,129,0.25); color: #34d399; }}
  .badge-REVIEW_REQUIRED {{ background: rgba(245,158,11,0.25); color: #fbbf24; }}

  .card-body {{
    padding: 14px 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
  }}
  .fname {{
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
    word-break: break-all;
    margin-bottom: 8px;
    line-height: 1.35;
  }}

  .compare-box {{
    background: #0b1120;
    border: 1px solid #1e293b;
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 12px;
    font-size: 11px;
    line-height: 1.45;
  }}
  .compare-line {{
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }}
  .ml-tag {{ color: #60a5fa; font-weight: 700; }}
  .anthro-tag {{ color: #c084fc; font-weight: 700; }}

  .meter {{
    height: 5px;
    background: #334155;
    border-radius: 3px;
    overflow: hidden;
    margin: 4px 0 8px 0;
  }}
  .meter-fill {{
    height: 100%;
    background: var(--primary);
  }}

  .reason-box {{
    font-size: 10.5px;
    color: #94a3b8;
    background: #0f172a;
    padding: 6px 8px;
    border-radius: 4px;
    margin-bottom: 12px;
  }}

  .label-title {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 6px;
    display: flex;
    justify-content: space-between;
  }}
  .current-choice {{
    font-weight: 700;
    color: #38bdf8;
  }}

  .options-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: auto;
  }}
  .opt-btn {{
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
    padding: 8px 4px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 5px;
    text-align: center;
    cursor: pointer;
    transition: 0.12s ease;
    user-select: none;
  }}
  .opt-btn:hover {{
    background: #334155;
    color: white;
  }}
  .opt-btn.active {{
    background: #2563eb;
    color: white;
    border-color: #60a5fa;
    box-shadow: 0 0 8px rgba(37,99,235,0.5);
  }}
  .opt-btn.active-skip {{
    background: #475569;
    color: #f8fafc;
    border-color: #94a3b8;
  }}

  .empty-state {{
    grid-column: 1 / -1;
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
  }}
  .empty-state h3 {{
    margin: 0 0 8px 0;
    color: #e2e8f0;
  }}
</style>
</head>
<body>

<header>
  <div class="title-group">
    <h1>&#128100; SmartFrame AI - Face Shape Label Review Tool</h1>
    <p>Human-in-the-Loop review & verification for all 75 dataset images</p>
  </div>
  <div>
    <button class="btn-success" onclick="saveManifest()">&#128190; Save reviewed_labels_manifest.csv</button>
  </div>
</header>

<div class="toolbar">
  <div class="stats-pill" id="statsPill">Progress: 0 / 75 Approved (0 Skipped)</div>
  <button class="btn-anthro" onclick="applyAllAnthropometric()">&#9889; Apply Geometric Anthropometric Shapes</button>
  <button class="btn-secondary" onclick="approveHighConfidence()">Approve High Confidence (&ge;70%)</button>
  <button class="btn-secondary" onclick="resetToPredicted()">Reset to Predicted</button>
  <button class="btn-secondary" onclick="clearAllToSkip()">Set All to Skip</button>
  <div class="filter-box">
    <label for="filterSelect" style="font-size:13px; color:var(--text-muted); font-weight:600;">Filter:</label>
    <select id="filterSelect" onchange="renderCards()">
      <option value="ALL" selected>All Images (75)</option>
      <option value="Heart">Heart</option>
      <option value="Oblong">Oblong</option>
      <option value="Oval">Oval</option>
      <option value="Round">Round</option>
      <option value="Square">Square</option>
      <option value="Skip">Skip / Discarded</option>
      <option value="REVIEW_REQUIRED">Review Required Only</option>
    </select>
  </div>
</div>

<div class="grid" id="cardGrid"></div>

<script>
const DATASET = {data_json};
const OPTIONS = ["Heart", "Oblong", "Oval", "Round", "Square", "Skip"];

// Initial selections loaded from verified manifest or fallback to predictions
const userLabels = {{}};
DATASET.forEach(it => {{
  if (OPTIONS.includes(it.verified_shape)) {{
    userLabels[it.filename] = it.verified_shape;
  }} else if (["Heart", "Oblong", "Oval", "Round", "Square"].includes(it.predicted_face_shape)) {{
    userLabels[it.filename] = it.predicted_face_shape;
  }} else {{
    userLabels[it.filename] = "Skip";
  }}
}});

function updateStats() {{
  let approved = 0;
  let skipped = 0;
  let counts = {{ Heart: 0, Oblong: 0, Oval: 0, Round: 0, Square: 0, Skip: 0 }};

  DATASET.forEach(it => {{
    const lbl = userLabels[it.filename] || "Skip";
    counts[lbl] = (counts[lbl] || 0) + 1;
    if (lbl === "Skip") {{
      skipped++;
    }} else {{
      approved++;
    }}
  }});

  const pill = document.getElementById("statsPill");
  pill.textContent = `Progress: ${{approved}} / ${{DATASET.length}} Approved (${{skipped}} Skipped) | H:${{counts.Heart}} Ob:${{counts.Oblong}} Ov:${{counts.Oval}} R:${{counts.Round}} Sq:${{counts.Square}}`;
}}

function renderCards() {{
  const filter = document.getElementById("filterSelect").value;
  const grid = document.getElementById("cardGrid");
  grid.innerHTML = "";

  let renderedCount = 0;

  DATASET.forEach(it => {{
    const currentChoice = userLabels[it.filename] || "Skip";

    // Filtering logic
    if (filter === "REVIEW_REQUIRED" && it.review_status !== "REVIEW_REQUIRED") return;
    if (OPTIONS.includes(filter)) {{
      if (currentChoice !== filter && it.predicted_face_shape !== filter && it.verified_shape !== filter) return;
    }}

    renderedCount++;

    const card = document.createElement("div");
    card.className = "card " + (currentChoice === "Skip" ? "is-skipped" : "is-approved");

    let optionsHtml = OPTIONS.map(opt => {{
      const isSel = currentChoice === opt;
      const cls = isSel ? (opt === "Skip" ? "opt-btn active-skip" : "opt-btn active") : "opt-btn";
      return `<div class="${{cls}}" onclick="setChoice('${{it.filename.replace(/'/g, "\\\\\\'")}}', '${{opt}}')">${{opt}}</div>`;
    }}).join("");

    const confPct = (it.confidence * 100).toFixed(1);
    const top2ConfPct = (it.top2_confidence * 100).toFixed(0);

    card.innerHTML = `
      <div class="img-frame">
        <span class="badge-index">#${{it.id}}</span>
        <span class="badge-status badge-${{it.review_status}}">${{it.review_status === "REVIEW_REQUIRED" ? "Review" : "Auto"}}</span>
        <img src="${{it.thumbnail_b64}}" 
             alt="${{it.filename}}" 
             loading="lazy" 
             onerror="this.onerror=null; this.src='previews/' + encodeURIComponent('${{it.filename}}');" />
      </div>
      <div class="card-body">
        <div class="fname" title="${{it.filename}}">${{it.filename}}</div>
        
        <div class="compare-box">
          <div class="compare-line">
            <span>Predicted Shape:</span>
            <span class="ml-tag">${{it.predicted_face_shape}} (${{confPct}}%)</span>
          </div>
          <div class="meter">
            <div class="meter-fill" style="width: ${{confPct}}%;"></div>
          </div>
          <div class="compare-line">
            <span>Geometric Shape:</span>
            <span class="anthro-tag">${{it.verified_shape}}</span>
          </div>
          <div style="color:var(--text-muted); font-size:10.5px; margin-top:4px;">
            L/W: <strong>${{it.lw_ratio}}</strong> | Jaw: <strong>${{it.jaw_angle}}&deg;</strong> | Chin: <strong>${{it.chin_angle}}&deg;</strong>
          </div>
        </div>

        <div class="reason-box">
          ${{it.anthro_reason || it.reason || "Confidence: " + confPct + "%"}}
        </div>

        <div class="label-title">
          <span>Assigned Label:</span>
          <span class="current-choice">${{currentChoice}}</span>
        </div>

        <div class="options-grid">
          ${{optionsHtml}}
        </div>
      </div>
    `;
    grid.appendChild(card);
  }});

  if (renderedCount === 0) {{
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<h3>No images found matching filter: "${{filter}}"</h3><p>Select "All Images (75)" in the filter dropdown above to view the full dataset.</p>`;
    grid.appendChild(empty);
  }}

  updateStats();
}}

function setChoice(fname, choice) {{
  userLabels[fname] = choice;
  renderCards();
}}

function applyAllAnthropometric() {{
  DATASET.forEach(it => {{
    if (["Heart", "Oblong", "Oval", "Round", "Square"].includes(it.verified_shape)) {{
      userLabels[it.filename] = it.verified_shape;
    }} else {{
      userLabels[it.filename] = "Skip";
    }}
  }});
  renderCards();
}}

function approveHighConfidence() {{
  DATASET.forEach(it => {{
    if (it.confidence >= 0.70 && ["Heart", "Oblong", "Oval", "Round", "Square"].includes(it.predicted_face_shape)) {{
      userLabels[it.filename] = it.predicted_face_shape;
    }}
  }});
  renderCards();
  alert("Approved all predictions with confidence >= 70%!");
}}

function resetToPredicted() {{
  DATASET.forEach(it => {{
    if (["Heart", "Oblong", "Oval", "Round", "Square"].includes(it.predicted_face_shape)) {{
      userLabels[it.filename] = it.predicted_face_shape;
    }} else {{
      userLabels[it.filename] = "Skip";
    }}
  }});
  renderCards();
}}

function clearAllToSkip() {{
  DATASET.forEach(it => {{
    userLabels[it.filename] = "Skip";
  }});
  renderCards();
}}

function saveManifest() {{
  let csv = "image_filename,reviewed_label,original_predicted_shape,confidence,original_path,review_status,review_timestamp\\n";
  const now = new Date().toISOString();

  let confirmedCount = 0;
  let skippedCount = 0;

  DATASET.forEach(it => {{
    const label = userLabels[it.filename] || "Skip";
    const status = label === "Skip" ? "SKIPPED" : "MANUALLY_VERIFIED";
    if (label !== "Skip") {{
      confirmedCount++;
    }} else {{
      skippedCount++;
    }}
    csv += `"${{it.filename}}","${{label}}","${{it.predicted_face_shape}}",${{it.confidence}},"${{it.original_path}}","${{status}}","${{now}}"\\n`;
  }});

  const blob = new Blob([csv], {{ type: "text/csv;charset=utf-8;" }});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reviewed_labels_manifest.csv";
  link.click();

  alert(`reviewed_labels_manifest.csv successfully exported!\\n\\nVerified: ${{confirmedCount}} images\\nSkipped: ${{skippedCount}} images`);
}}

// Initialize and render all 75 images
renderCards();
</script>
</body>
</html>
"""

    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(html_code)

    logger.info(f"Successfully generated standalone review tool HTML at: {OUTPUT_HTML}")
    logger.info(f"File size: {os.path.getsize(OUTPUT_HTML) / (1024 * 1024):.2f} MB")
    return OUTPUT_HTML


if __name__ == "__main__":
    build_review_tool()
