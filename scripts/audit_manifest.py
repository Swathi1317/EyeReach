"""
SmartFrame AI - Audit Manifest and Review Tool Verification
"""

import os
import json
import re
import pandas as pd

REPORT_PATH = "D:/SmartframeAi/Data/Classified_Dataset/classification_report.csv"
MANIFEST_PATH = "D:/SmartframeAi/Data/Classified_Dataset/reviewed_labels_manifest.csv"
HTML_PATH = "D:/SmartframeAi/Data/Classified_Dataset/review_tool.html"
DATASET_PATH = "D:/SmartframeAi/Data/Dataset"

def run_audit():
    print("=" * 70)
    print(" SMARTFRAME AI - FACE SHAPE REVIEW RESULTS AUDIT REPORT")
    print("=" * 70)

    # 1. Dataset on disk
    dataset_files = sorted([f for f in os.listdir(DATASET_PATH) if os.path.isfile(os.path.join(DATASET_PATH, f))])
    print(f"1. Total images in Dataset folder: {len(dataset_files)}")

    # 2. Manifest check
    df_man = pd.read_csv(MANIFEST_PATH)
    print(f"2. Total records in reviewed_labels_manifest.csv: {len(df_man)}")
    assert len(df_man) == len(dataset_files), "Manifest count does not match dataset files count!"

    # 3. Label Breakdown
    print("\n3. CSV Label Distribution (reviewed_label column):")
    counts = df_man["reviewed_label"].value_counts(dropna=False).to_dict()
    for lbl in ["Heart", "Oblong", "Oval", "Round", "Square", "Skip"]:
        cnt = counts.get(lbl, 0)
        pct = (cnt / len(df_man)) * 100
        print(f"   - {lbl:<8}: {cnt:>2} images ({pct:>5.1f}%)")

    # Check for invalid labels
    valid_classes = {"Heart", "Oblong", "Oval", "Round", "Square", "Skip"}
    invalid = df_man[~df_man["reviewed_label"].isin(valid_classes)]
    print(f"\n4. Invalid / Unexpected labels in manifest: {len(invalid)}")
    if len(invalid) > 0:
        print("   WARNING! Found invalid labels:", invalid["reviewed_label"].tolist())

    # Check for Review_Required
    rr_in_manifest = df_man[df_man["reviewed_label"] == "Review_Required"]
    print(f"5. 'Review_Required' saved as face-shape class in manifest: {len(rr_in_manifest)} (Should be 0)")

    # 6. Approved vs Skipped
    approved_count = (df_man["reviewed_label"] != "Skip").sum()
    skipped_count = (df_man["reviewed_label"] == "Skip").sum()
    print(f"\n6. Summary Verification:")
    print(f"   - Total Images: {len(df_man)}")
    print(f"   - Approved:     {approved_count}")
    print(f"   - Skipped:      {skipped_count}")

    # 7. Check HTML review tool counter and DATASET JSON
    with open(HTML_PATH, "r", encoding="utf-8") as f:
        html_content = f.read()

    match = re.search(r"const DATASET = (\[.*?\]);\s*const OPTIONS =", html_content, re.DOTALL)
    if match:
        html_dataset = json.loads(match.group(1))
        print(f"\n7. HTML Review Tool Embedded Records: {len(html_dataset)}")
        html_counts = {}
        for it in html_dataset:
            lbl = it.get("verified_shape", "Skip")
            html_counts[lbl] = html_counts.get(lbl, 0) + 1

        print("   HTML Initial Counts:")
        for lbl in ["Heart", "Oblong", "Oval", "Round", "Square", "Skip"]:
            print(f"   - {lbl:<8}: {html_counts.get(lbl, 0):>2}")

        html_approved = sum(v for k, v in html_counts.items() if k != "Skip")
        html_skipped = html_counts.get("Skip", 0)
        print(f"   - HTML Approved: {html_approved}")
        print(f"   - HTML Skipped:  {html_skipped}")

        # Check match
        counts_match = (
            html_approved == approved_count and
            html_skipped == skipped_count and
            html_counts.get("Heart", 0) == counts.get("Heart", 0) and
            html_counts.get("Oblong", 0) == counts.get("Oblong", 0) and
            html_counts.get("Oval", 0) == counts.get("Oval", 0) and
            html_counts.get("Round", 0) == counts.get("Round", 0) and
            html_counts.get("Square", 0) == counts.get("Square", 0)
        )
        print(f"   - Consistency Check between HTML and CSV: {'MATCH 100%' if counts_match else 'MISMATCH'}")
    else:
        print("   WARNING: Could not parse DATASET from HTML")

    # 8. Detailed Skipped Images Report
    print("\n" + "=" * 70)
    print(" DETAILED REPORT ON ALL 9 SKIPPED IMAGES")
    print("=" * 70)
    skipped_df = df_man[df_man["reviewed_label"] == "Skip"].copy()
    for idx, (_, r) in enumerate(skipped_df.iterrows(), 1):
        print(f"[{idx}] Filename: {r['image_filename']}")
        print(f"    Reason:   {r['reason']}")
        print(f"    Ratios:   L/W: {r['lw_ratio']} | Jaw: {r['jaw_angle']} deg | Chin: {r['chin_angle']} deg")
        print(f"    Status:   {r['review_status']}")
        print("-" * 70)

    # 9. Comparison with Original Predictions
    df_rep = pd.read_csv(REPORT_PATH)
    merged = pd.merge(df_rep, df_man, on="image_filename", suffixes=("_old", "_verified"))
    print("\n9. Original XGBoost Model Predictions vs. Verified Accurate Labels:")
    print(f"{'Metric':<30} {'Original Model':<18} {'Verified Anthropometric':<22}")
    print("-" * 70)
    old_counts = df_rep["predicted_face_shape"].value_counts().to_dict()
    for cls_name in ["Heart", "Oblong", "Oval", "Round", "Square", "Skip/Review"]:
        old_c = old_counts.get(cls_name, old_counts.get("Review_Required", 0) if cls_name == "Skip/Review" else 0)
        new_c = counts.get("Skip", 0) if cls_name == "Skip/Review" else counts.get(cls_name, 0)
        print(f"  {cls_name:<28} {old_c:>4} images ({old_c/75:>5.1%})   {new_c:>4} images ({new_c/75:>5.1%})")

    # 10. Check if any persons or bursts are present in dataset
    print("\n" + "=" * 70)
    print(" IDENTITY & REPETITION AUDIT")
    print("=" * 70)
    # Check bursts
    bursts = {}
    for fn in dataset_files:
        if "IMG2026102620" in fn:
            bursts["burst_cam1"] = bursts.get("burst_cam1", 0) + 1
        elif "IMG_20261026_20" in fn:
            bursts["burst_cam2"] = bursts.get("burst_cam2", 0) + 1
        elif "IMG_015" in fn:
            bursts["burst_iphone"] = bursts.get("burst_iphone", 0) + 1
        elif "WhatsApp Image 2026-10-27 at 8.47" in fn:
            bursts["wa_burst_847"] = bursts.get("wa_burst_847", 0) + 1
        elif "WhatsApp Image 2026-10-27 at 8.55" in fn:
            bursts["wa_burst_855"] = bursts.get("wa_burst_855", 0) + 1
        elif " - " in fn:
            pname = fn.split(" - ")[-1].split(".")[0].strip()
            bursts[f"person_{pname}"] = bursts.get(f"person_{pname}", 0) + 1

    print("Detected repeated photo sessions / burst series:")
    for bname, bcount in bursts.items():
        if bcount > 1:
            print(f"  - {bname:<25}: {bcount} images of the same individual")

    print("\nAudit completed successfully.")

if __name__ == "__main__":
    run_audit()
