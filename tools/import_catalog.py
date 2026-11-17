#!/usr/bin/env python3
"""Import the raster motifs from the Katalog PDF without rendering motif pages.

The importer intentionally treats all extracted art as provisional raster artwork:
no tracing, tiling, seamlessness, or vector claims are made.  It may be rerun;
outputs in assets/motifs and assets/sets are rebuilt deterministically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = {"P", "D", "Z", "V", "B", "G"}
CODE_RE = re.compile(r"\b([KPDZVBG])\s*[-_/]?\s*([0-9]{1,5})\b", re.I)
PERSIAN = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def canonical(text: str) -> str | None:
    text = text.translate(PERSIAN).upper().replace(" ", "")
    m = re.search(r"([KPDZVBG])[-_/]?(\d+)", text)
    return f"{m.group(1)}{int(m.group(2))}" if m else None


def code_occurrences(page: fitz.Page):
    """Return line/span-level code bboxes, retaining duplicate occurrences."""
    result = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                raw = span.get("text", "")
                for match in CODE_RE.finditer(raw.translate(PERSIAN)):
                    c = canonical(match.group(0))
                    # Catalog motif identifiers are three-or-more digit codes;
                    # a lone B0 in a shared B-label span is a PDF text artifact.
                    if c and (c.startswith("K") or len(match.group(2)) >= 3):
                        result.append({"code": c, "bbox": tuple(float(v) for v in span["bbox"]), "text": raw})
    # Some PDFs put multiple codes in one span. Their exact individual x is not
    # available; distribute them across the span in reading order.
    if not result:
        for block in page.get_text("blocks"):
            raw = block[4]
            found = [canonical(m.group(0)) for m in CODE_RE.finditer(raw.translate(PERSIAN)) if m.group(1).upper() == "K" or len(m.group(2)) >= 3]
            found = [x for x in found if x]
            if found:
                x0, y0, x1, y1 = block[:4]
                step = (x1 - x0) / max(1, len(found))
                result.extend({"code": c, "bbox": (x0 + i * step, y0, x0 + (i + 1) * step, y1), "text": raw} for i, c in enumerate(found))
    return result


def rect_iou(a, b):
    x0, y0, x1, y1 = a
    X0, Y0, X1, Y1 = b
    ix0, iy0, ix1, iy1 = max(x0, X0), max(y0, Y0), min(x1, X1), min(y1, Y1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    return inter / (((x1 - x0) * (y1 - y0)) + ((X1 - X0) * (Y1 - Y0)) - inter)


def extract_png(doc, xref: int, smask: int) -> bytes:
    # Pixmap(xref, smask) applies the PDF soft mask and preserves transparency.
    base = fitz.Pixmap(doc, xref)
    if smask:
        # Recent PyMuPDF versions accept Pixmap(base, mask), while older
        # releases accepted (document, xref, smask). Keep the portable form.
        pix = fitz.Pixmap(base, fitz.Pixmap(doc, smask))
    else:
        pix = base
    if pix.colorspace and pix.colorspace.n > 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    return pix.tobytes("png")


def normalize_png(png: bytes, matrix) -> tuple[bytes, str]:
    """Apply an occurrence's orthogonal PDF transform without resampling."""
    a, b, c, d = (float(v) for v in matrix[:4])
    eps = 1e-5
    im = Image.open(BytesIO(png)).convert("RGBA")
    if abs(a) < eps and abs(d) < eps and abs(b) > eps and abs(c) > eps:
        if b < 0 and c > 0:
            im = im.transpose(Image.Transpose.ROTATE_90)
            orientation = "ROTATE_90_CCW"
        else:
            im = im.transpose(Image.Transpose.ROTATE_270)
            orientation = "ROTATE_270"
    elif abs(b) < eps and abs(c) < eps:
        if a < 0:
            im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if d < 0:
            im = im.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        orientation = ("FLIP_X" if a < 0 else "") + ("+FLIP_Y" if d < 0 else "IDENTITY")
    else:
        # Do not silently stretch or rotate an oblique occurrence.
        orientation = "NONORTHOGONAL"
    out = BytesIO()
    im.save(out, "PNG")
    return out.getvalue(), orientation


def family_score(fam: str, rect, label):
    """Higher is better. Priors are deliberately conservative and page-local."""
    x0, y0, x1, y1 = rect
    lx0, ly0, lx1, ly1 = label
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lcx, lcy = (lx0 + lx1) / 2, (ly0 + ly1) / 2
    s = 0.0
    if fam == "P":
        s = 5 if x0 < 390 and 120 < cy < 330 else -5
    elif fam == "K":
        s = 5 if x0 > 350 and cy < 220 else -4
    elif fam == "D":
        s = 5 if x0 > 350 and 150 < cy < 700 else -4
    elif fam == "Z":
        s = 5 if x0 < 330 and 300 < cy < 700 else -4
    elif fam == "V":
        s = 6 if x0 < 260 and cy > 500 else -4
    elif fam == "B":
        s = 6 if y0 > 720 else -4
    elif fam == "G":
        # G labels share the central slot with neighbouring families; retain a
        # conservative candidate rather than losing the code to distance alone.
        s = 4
    # Prefer an image above the label, with a mild horizontal proximity term.
    vertical = max(0.0, lcy - cy) / 80.0 if cy <= lcy + 30 else 4.0
    horizontal = abs(lcx - cx) / 180.0
    return s - min(vertical, 5.0) - min(horizontal, 3.0)


def choose_candidates(fam, label, candidates):
    scored = [(family_score(fam, c["rect"], label), c) for c in candidates]
    good = [(s, c) for s, c in scored if s >= 1.0]
    if not good:
        return [], scored
    good.sort(key=lambda z: z[0], reverse=True)
    # Keep close components in the same family region (not unrelated page art).
    top = good[0][0]
    # For Z/G, a large central component can score below a small tail solely
    # because the tail sits closer to the label; retain every conservative
    # candidate so area ordering can make the main art the default.
    threshold = 1.0 if fam in {"Z", "G"} else max(1.0, top - 1.6)
    if fam in {"Z", "G"}:
        lx0, ly0, lx1, _ = label
        lcx = (lx0 + lx1) / 2
        good = [(s, c) for s, c in good if
                abs((c["rect"][0] + c["rect"][2]) / 2 - lcx) <= 140 and
                c["rect"][3] <= ly0 + 10]
    selected = [(s, c) for s, c in good if s >= threshold]
    if fam in {"Z", "G"}:
        # Main art is the largest central component above the label. Smaller
        # nearby components remain variants, but must not become the default.
        selected.sort(key=lambda z: ((z[1]["rect"][2] - z[1]["rect"][0]) * (z[1]["rect"][3] - z[1]["rect"][1])), reverse=True)
    return [c for _, c in selected], scored


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path, help="path to the source catalog PDF")
    args = ap.parse_args()
    pdf = args.pdf
    motifs_dir = ROOT / "assets" / "motifs"
    sets_dir = ROOT / "assets" / "sets"
    curation_path = ROOT / "tools" / "catalog-curation.json"
    curation = json.loads(curation_path.read_text(encoding="utf-8")) if curation_path.exists() else {"version": 1, "exclusions": []}
    exclusions_by_code = defaultdict(list)
    for item in curation.get("exclusions", []):
        exclusions_by_code[item["code"]].append(item)
    motifs_dir.mkdir(parents=True, exist_ok=True)
    sets_dir.mkdir(parents=True, exist_ok=True)
    for p in motifs_dir.glob("*.png"):
        p.unlink()
    for p in sets_dir.glob("*.jpg"):
        p.unlink()

    doc = fitz.open(pdf)
    assets_by_hash = {}
    motifs = {}
    occurrences = defaultdict(list)
    audit = {"version": 1, "source": pdf.name, "allAssociationReview": True, "pages": [], "ambiguous": [], "withoutImage": [], "unmatchedImages": 0}
    sets = []

    for page_no, page in enumerate(doc, 1):
        labels = code_occurrences(page)
        # Keep only drawable, non-trivial XObjects; rects [] are resource copies,
        # while a base image with a soft mask has a drawable rect here.
        candidates = []
        seen_rects = set()
        for item in page.get_images(full=True):
            xref, smask, w, h = int(item[0]), int(item[1]), int(item[2]), int(item[3])
            if w < 12 or h < 12:
                continue
            try:
                png = extract_png(doc, xref, smask)
            except Exception as exc:
                audit["ambiguous"].append({"page": page_no, "reason": "image-extraction-failed", "xref": xref, "detail": str(exc)[:160]})
                continue
            for rr, matrix in page.get_image_rects(xref, transform=True):
                rect = (float(rr.x0), float(rr.y0), float(rr.x1), float(rr.y1))
                normalized, orientation = normalize_png(png, matrix)
                key = (xref, tuple(round(v, 2) for v in rect), orientation)
                if key in seen_rects:
                    continue
                seen_rects.add(key)
                candidates.append({"xref": xref, "rect": rect, "png": normalized, "width": Image.open(BytesIO(normalized)).width, "height": Image.open(BytesIO(normalized)).height, "orientation": orientation, "hash": hashlib.sha256(orientation.encode() + b"\0" + normalized).hexdigest()})

        page_codes = []
        page_assignments = []
        for occ in labels:
            code, bbox = occ["code"], occ["bbox"]
            fam = code[0]
            if fam == "K":
                page_codes.append(code)
                continue
            if fam not in FAMILIES:
                continue
            selected, scored = choose_candidates(fam, bbox, candidates)
            if not selected:
                audit["withoutImage"].append({"page": page_no, "code": code, "labelBbox": list(bbox), "reason": "no-conservative-image-match"})
                page_assignments.append({"code": code, "variants": 0})
                continue
            # Repeated text (e.g. B737 twice) must not create duplicate variants.
            unique = []
            hashes = set()
            for c in selected:
                if c["hash"] not in hashes:
                    hashes.add(c["hash"]); unique.append(c)
            ranked = sorted(scored, key=lambda z: z[0], reverse=True)
            if len(selected) > 1 or (len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 0.8):
                audit["ambiguous"].append({"page": page_no, "code": code, "labelBbox": list(bbox), "candidateCount": len(selected), "note": "association is provisional; variants retained"})
            page_assignments.append({"code": code, "variants": len(unique)})
            for c in unique:
                h = c["hash"]
                if h not in assets_by_hash:
                    assets_by_hash[h] = {"png": c["png"], "width": c["width"], "height": c["height"], "pages": []}
                assets_by_hash[h]["pages"].append(page_no)
                occurrences[code].append({"hash": h, "page": page_no, "rect": c["rect"], "label": bbox})
                if code not in motifs:
                    motifs[code] = {"code": code, "family": fam, "hashes": []}
                if h not in motifs[code]["hashes"]:
                    motifs[code]["hashes"].append(h)

        k_codes = [o["code"] for o in labels if o["code"].startswith("K")]
        kcode = k_codes[0] if k_codes else f"K{999 + page_no}"
        # Set reference thumbnails are the only low-res page renders. Motif art
        # itself always comes from image XObjects above.
        thumb = sets_dir / f"{kcode}.jpg"
        scale = min(480 / page.rect.width, 480 / page.rect.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, colorspace=fitz.csRGB)
        im = Image.open(BytesIO(pix.tobytes("png"))).convert("RGB")
        im.save(thumb, "JPEG", quality=84, optimize=True)
        sets.append({"code": kcode, "page": page_no, "thumbnail": f"assets/sets/{thumb.name}", "motifCodes": sorted({o["code"] for o in labels if o["code"][0] in FAMILIES})})
        audit["pages"].append({"page": page_no, "setCode": kcode, "labelCodes": [o["code"] for o in labels], "imageCandidates": len(candidates), "assignments": page_assignments})

    # Write deterministic asset names after all hashes are known.
    asset_paths = {}
    for code in sorted(motifs):
        for i, h in enumerate(motifs[code]["hashes"], 1):
            suffix = "" if i == 1 else f"-variant-{i}"
            path = motifs_dir / f"{code}{suffix}.png"
            path.write_bytes(assets_by_hash[h]["png"])
            asset_paths[(code, h)] = path

    out_motifs = []
    applied_exclusions = []
    for code in sorted(motifs):
        hashes = motifs[code]["hashes"]
        variants = []
        for h in hashes:
            a = asset_paths[(code, h)]
            with Image.open(a) as img:
                pw, ph = img.size
            # Use the first observed placement size, not a claim of repeat size.
            ref = next(o for o in occurrences[code] if o["hash"] == h)
            rw = max(1.0, ref["rect"][2] - ref["rect"][0]) * 25.4 / 72
            rh = max(1.0, ref["rect"][3] - ref["rect"][1]) * 25.4 / 72
            variants.append({"asset": f"assets/motifs/{a.name}", "widthMm": round(rw, 2), "heightMm": round(rh, 2), "pixelWidth": pw, "pixelHeight": ph})
        excluded = []
        kept = []
        for variant in variants:
            digest = hashlib.sha256((ROOT / variant["asset"]).read_bytes()).hexdigest()
            match = next((item for item in exclusions_by_code.get(code, []) if item.get("sha256") == digest), None)
            if match:
                record = {"excludedAsset": variant["asset"], **match}
                excluded.append(record)
                applied_exclusions.append(record)
                (ROOT / variant["asset"]).unlink()
            else:
                kept.append(variant)
        variants = kept
        if not variants:
            raise RuntimeError(f"Curation excluded every extracted image for {code}; review tools/catalog-curation.json.")
        first = variants[0]
        source_pages = sorted({o["page"] for o in occurrences[code]})
        collection_codes = sorted({s["code"] for s in sets if code in s["motifCodes"]})
        record = {"code": code, "family": code[0], "asset": first["asset"], "widthMm": first["widthMm"], "heightMm": first["heightMm"], "pixelWidth": first["pixelWidth"], "pixelHeight": first["pixelHeight"], "sourcePages": source_pages, "collectionCodes": collection_codes, "needsCalibration": True, "associationReview": True, "associationIssues": ["provisional image/code association; human review remains required"], "variants": variants, "note": "Extracted raster image; repeat boundaries and code association need one-time review"}
        if excluded:
            record["excludedVariants"] = excluded
        out_motifs.append(record)

    library = {"version": 1, "source": {"name": pdf.name, "pageCount": len(doc)}, "motifs": out_motifs, "sets": sets}
    (ROOT / "assets" / "library.json").write_text(json.dumps(library, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    all_codes = {c for p in audit["pages"] for c in p["labelCodes"] if not c.startswith("K")}
    family_counts = {fam: sum(1 for c in all_codes if c.startswith(fam)) for fam in sorted(FAMILIES)}
    audit["summary"] = {"totalUniqueCodes": len(all_codes), "familyCounts": family_counts, "usableMotifs": len(out_motifs), "uniqueCodesWithImage": len(out_motifs), "ambiguousAssociations": len(audit["ambiguous"]), "codesWithoutImage": len(audit["withoutImage"]), "extractedUniqueImages": len(assets_by_hash), "curatedVariantExclusions": len(applied_exclusions)}
    if applied_exclusions:
        audit["libraryCuration"] = {"file": "tools/catalog-curation.json", "exclusions": applied_exclusions}
    (ROOT / "assets" / "audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**audit["summary"], "sets": len(sets), "motifFiles": len(list(motifs_dir.glob("*.png")))}, ensure_ascii=False))


if __name__ == "__main__":
    main()
