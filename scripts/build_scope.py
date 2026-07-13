#!/usr/bin/env python3
"""Build the versioned vocabulary scope used by the local app.

The current source is a cleaned NotebookLM Markdown export. Source occurrences
are never merged destructively: duplicate terms keep their original unit/group,
while canonical_term provides the future app-level identity.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data" / "source_manifest.json"
OUTPUT_DIR = ROOT / "data" / "generated"
REPORT_PATH = ROOT / "docs" / "單字範圍報告.md"

PAGE_RE = re.compile(r"^###\s+\*\*【第\s*(\d+)\s*頁】\*\*")
UNIT_RE = re.compile(r"^\*\*UNIT\s+(\d+)\s+(.+?)\*\*$")
SUBTITLE_RE = re.compile(r"^\*\*(Prefix|Root|Suffix):\s*(.+?)\*\*$")
GROUP_SEGMENT_RE = re.compile(
    r"(字首|字根|字尾)\s+(\d+)\s+(.+?)(?=(?:\s*/\s*字(?:首|根|尾)\s+\d+)|$)"
)
ENTRY_RE = re.compile(
    r"^\s*(?:[-*+]\s+)?\*\*(?P<headword>.+?)\*\*\s+"
    r"\[(?P<pronunciation>[^\]]*)\]\s+(?P<meta>.*?)\s+▶\s+"
    r"\[(?P<label>[^\]]+)\]\s*$"
)
RELATION_RE = re.compile(r"\s+\((同|近|反|關|衍)\)\s*(.+?)\s*$")
INVALID_RELATION_RE = re.compile(r"\s+\(名\)\s*([A-Za-z][A-Za-z -]*?)\s*$")
POS_RE = re.compile(r"^\(([^)]+)\)")

SECTION_BY_ZH = {"字首": "prefix", "字根": "root", "字尾": "suffix"}
SECTION_ZH = {"prefix": "字首", "root": "字根", "suffix": "字尾", "custom": "自訂"}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_source_path(relative: str) -> Path:
    return (ROOT / relative).resolve()


def page_info(source: dict[str, Any], content_page: int) -> dict[str, int]:
    for mapping in source["page_map"]:
        if mapping["content_start"] <= content_page <= mapping["content_end"]:
            return {
                "content_page": content_page,
                "pdf_page": content_page + mapping["pdf_offset"],
                "printed_page": content_page + mapping["printed_offset"],
            }
    raise ValueError(f"No page map for content page {content_page}")


def canonicalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().strip()
    value = re.sub(r"\s+", " ", value)
    return value


def split_group_label(description: str) -> tuple[list[str], str]:
    description = description.strip()
    match = re.search(r"[\u3400-\u9fff]", description)
    if not match:
        return [description.rstrip("-")], ""
    forms_raw = description[: match.start()].strip()
    meaning = re.sub(r"\s*\(續\)\s*$", "", description[match.start() :]).strip()
    forms = [item.strip().rstrip("-") for item in forms_raw.split(",") if item.strip()]
    return forms, meaning


def parse_header_meta(meta: str, label: str) -> dict[str, Any]:
    rest = meta.strip()
    pos: list[str] = []
    while True:
        match = POS_RE.match(rest)
        if not match:
            break
        pos.append(match.group(1).strip())
        rest = rest[match.end() :].lstrip()

    relation_type = None
    relation_term = None
    relation = RELATION_RE.search(rest)
    invalid_relation_label = False
    if relation:
        relation_type = relation.group(1)
        relation_term = relation.group(2).strip()
        definition = rest[: relation.start()].strip()
    else:
        definition = rest.strip()
        invalid_relation_label = bool(INVALID_RELATION_RE.search(rest))

    label_match = re.match(r"(.+?)\s+(\d+)$", label.strip())
    exam_tag = label_match.group(1).strip() if label_match else label.strip()
    difficulty = int(label_match.group(2)) if label_match else None
    return {
        "parts_of_speech": pos,
        "definition_zh": definition,
        "relation_type": relation_type,
        "relation_term": relation_term,
        "exam_tag": exam_tag,
        "difficulty": difficulty,
        "_initial_quality_flags": (
            ["invalid_relation_label"] if invalid_relation_label else []
        ),
    }


def clean_content_line(raw: str) -> str:
    line = raw.strip()
    line = re.sub(r"^(?:[-*+]\s+)", "", line).strip()
    return line


def is_probable_example(line: str) -> bool:
    if not re.search(r"[A-Za-z]", line):
        return False
    ignored = (
        "Batch ",
        "UNIT ",
        "Prefix:",
        "Root:",
        "Suffix:",
        "Exported from",
    )
    return not line.startswith(ignored)


def group_id(source_id: str, section: str, index: int) -> str:
    return f"{source_id}:{section}:g{index:03d}"


def unit_id(source_id: str, section: str, index: int) -> str:
    return f"{source_id}:{section}:u{index:02d}"


def choose_group(entry: dict[str, Any], groups: dict[str, dict[str, Any]]) -> str | None:
    candidates = entry.pop("_group_candidates", [])
    # The re- header sits on a page missing from the actual PDF. Existing words
    # on printed pages 36-37 are retained under an explicitly inferred group.
    if (
        entry.get("section") == "prefix"
        and entry["content_page_start"] in (19, 20)
        and canonicalize(entry["headword"]).startswith("re")
        and re.search(r"(^|\s)re\s", (entry.get("etymology") or "").casefold())
    ):
        entry.setdefault("quality_flags", []).append("category_inferred")
        return group_id(entry["source_id"], "prefix", 22)

    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    haystack = canonicalize(
        " ".join(
            [entry.get("headword", ""), entry.get("etymology", "") or ""]
        )
    )
    scored: list[tuple[int, str]] = []
    for candidate in candidates:
        score = 0
        for form in groups[candidate].get("forms", []):
            token = canonicalize(form.rstrip("-"))
            if token and token in haystack:
                score = max(score, len(token))
        scored.append((score, candidate))
    scored.sort(reverse=True)
    return scored[0][1]


def parse_notebooklm_source(source: dict[str, Any]) -> dict[str, Any]:
    markdown_path = resolve_source_path(source["markdown_path"])
    lines = markdown_path.read_text(encoding="utf-8").splitlines()
    source_id = source["id"]

    units: dict[str, dict[str, Any]] = {}
    groups: dict[str, dict[str, Any]] = {}
    entries: list[dict[str, Any]] = []
    pages: list[int] = []
    current_page: int | None = None
    current_unit: str | None = None
    current_section: str | None = None
    current_groups: list[str] = []
    current_entry: dict[str, Any] | None = None
    page_ordinals: Counter[int] = Counter()
    missing_printed_pages = {
        page
        for gap in source.get("known_gaps", [])
        if gap.get("kind") == "missing_from_pdf"
        for page in gap.get("printed_pages", [])
    }

    def finalize_entry(extra_flag: str | None = None) -> None:
        nonlocal current_entry
        if current_entry is None:
            return
        if extra_flag:
            current_entry.setdefault("quality_flags", []).append(extra_flag)
        selected_group = choose_group(current_entry, groups)
        current_entry["group_id"] = selected_group
        if selected_group and selected_group in groups:
            current_entry["unit_id"] = groups[selected_group]["unit_id"]
            current_entry["section"] = groups[selected_group]["section"]
        else:
            current_entry["unit_id"] = current_entry.get("unit_id")

        variants = [item.strip() for item in current_entry["headword"].split("/") if item.strip()]
        current_entry["variants"] = variants
        current_entry["canonical_term"] = canonicalize(variants[0])

        required = {
            "pronunciation": "missing_pronunciation",
            "parts_of_speech": "missing_part_of_speech",
            "definition_zh": "missing_definition_zh",
            "etymology": "missing_etymology",
            "example_en": "missing_example_en",
            "example_zh": "missing_example_zh",
            "group_id": "missing_group",
        }
        flags = current_entry.setdefault("quality_flags", [])
        for field, flag in required.items():
            if not current_entry.get(field):
                flags.append(flag)
        current_entry["quality_flags"] = sorted(set(flags))
        entries.append(current_entry)
        current_entry = None

    for raw in lines:
        page_match = PAGE_RE.match(raw)
        if page_match:
            new_page = int(page_match.group(1))
            if current_entry is not None and current_page is not None:
                previous_printed = page_info(source, current_page)["printed_page"]
                next_printed = page_info(source, new_page)["printed_page"]
                entry_is_complete = all(
                    current_entry.get(field)
                    for field in ("etymology", "example_en", "example_zh")
                )
                skipped_printed = set(range(previous_printed + 1, next_printed))
                if entry_is_complete:
                    finalize_entry()
                elif skipped_printed & missing_printed_pages:
                    current_entry.setdefault("quality_flags", []).append("orphan_translation")
                    finalize_entry("source_gap_after_entry")
                elif next_printed != previous_printed + 1:
                    finalize_entry()
            current_page = new_page
            pages.append(new_page)
            continue

        unit_match = UNIT_RE.match(raw)
        if unit_match:
            finalize_entry()
            index = int(unit_match.group(1))
            title_zh = unit_match.group(2).strip()
            if "字首" in title_zh:
                current_section = "prefix"
            elif "字根" in title_zh:
                current_section = "root"
            elif "字尾" in title_zh:
                current_section = "suffix"
            else:
                raise ValueError(f"Cannot infer section from unit: {raw}")
            current_unit = unit_id(source_id, current_section, index)
            units[current_unit] = {
                "id": current_unit,
                "source_id": source_id,
                "section": current_section,
                "index": index,
                "title_zh": title_zh,
                "title_en": None,
                "content_page_start": current_page,
                "content_page_end": current_page,
            }
            current_groups = []
            continue

        subtitle_match = SUBTITLE_RE.match(raw)
        if subtitle_match and current_unit:
            units[current_unit]["title_en"] = subtitle_match.group(2).strip()
            continue

        if raw.startswith("**字") and raw.endswith("**"):
            inner = raw[2:-2]
            segments = list(GROUP_SEGMENT_RE.finditer(inner))
            if segments:
                finalize_entry()
                current_groups = []
                for segment in segments:
                    section = SECTION_BY_ZH[segment.group(1)]
                    index = int(segment.group(2))
                    forms, meaning = split_group_label(segment.group(3))
                    gid = group_id(source_id, section, index)
                    uid = current_unit
                    if uid is None or units[uid]["section"] != section:
                        raise ValueError(f"Group without matching unit: {raw}")
                    groups.setdefault(
                        gid,
                        {
                            "id": gid,
                            "source_id": source_id,
                            "section": section,
                            "index": index,
                            "unit_id": uid,
                            "forms": forms,
                            "meaning_zh": meaning,
                            "status": "complete",
                            "note": None,
                            "content_page_start": current_page,
                            "content_page_end": current_page,
                        },
                    )
                    current_groups.append(gid)
                continue

        entry_match = ENTRY_RE.match(raw)
        if entry_match:
            finalize_entry()
            if current_page is None:
                raise ValueError(f"Entry before page heading: {raw}")
            page_ordinals[current_page] += 1
            parsed_meta = parse_header_meta(
                entry_match.group("meta"), entry_match.group("label")
            )
            initial_flags = parsed_meta.pop("_initial_quality_flags")
            current_entry = {
                "id": f"{source_id}:p{current_page:03d}:e{page_ordinals[current_page]:02d}",
                "source_id": source_id,
                "source_order": len(entries) + 1,
                "headword": entry_match.group("headword").strip(),
                "pronunciation": entry_match.group("pronunciation").strip(),
                **parsed_meta,
                "etymology": None,
                "example_en": None,
                "example_zh": None,
                "content_page_start": current_page,
                "content_page_end": current_page,
                "pdf_page": page_info(source, current_page)["pdf_page"],
                "printed_page": page_info(source, current_page)["printed_page"],
                "section": current_section,
                "unit_id": current_unit,
                "_group_candidates": list(current_groups),
                "quality_flags": initial_flags,
                "raw_header": raw.strip(),
            }
            continue

        if current_entry is None:
            continue
        line = clean_content_line(raw)
        if not line or line.startswith(("---", "###", "##", "以上為", "好的，", "沒問題")):
            continue
        if line.startswith(("(解碼)", "（解碼）")):
            current_entry["etymology"] = re.sub(r"^[（(]解碼[)）]\s*", "", line).strip()
            current_entry["content_page_end"] = current_page
        elif line.startswith("▶"):
            if not current_entry.get("example_zh"):
                current_entry["example_zh"] = line[1:].strip()
                current_entry["content_page_end"] = current_page
        elif is_probable_example(line):
            if current_entry.get("example_zh"):
                continue
            if current_entry.get("example_en"):
                current_entry["example_en"] += " " + line
            else:
                current_entry["example_en"] = line
            current_entry["content_page_end"] = current_page

    finalize_entry()

    # Add explicit records for source gaps, and for the inferred re- header.
    for manual in source.get("manual_groups", []):
        gid = group_id(source_id, manual["section"], manual["index"])
        uid = unit_id(source_id, manual["section"], manual["unit_index"])
        groups.setdefault(
            gid,
            {
                "id": gid,
                "source_id": source_id,
                "section": manual["section"],
                "index": manual["index"],
                "unit_id": uid,
                "forms": manual["forms"],
                "meaning_zh": manual["meaning_zh"],
                "status": manual["status"],
                "note": manual["note"],
                "content_page_start": None,
                "content_page_end": None,
            },
        )
        if gid in groups and groups[gid]["status"] == "complete":
            continue
        groups[gid].update(
            status=manual["status"],
            note=manual["note"],
            forms=manual["forms"],
            meaning_zh=manual["meaning_zh"],
            unit_id=uid,
        )

    group_entries: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unit_entries: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        if entry.get("group_id"):
            group_entries[entry["group_id"]].append(entry)
        if entry.get("unit_id"):
            unit_entries[entry["unit_id"]].append(entry)

    for gid, group in groups.items():
        members = group_entries[gid]
        if members:
            group["content_page_start"] = min(item["content_page_start"] for item in members)
            group["content_page_end"] = max(item["content_page_end"] for item in members)
        group["entry_count"] = len(members)
        group["unique_term_count"] = len({item["canonical_term"] for item in members})

    for uid, unit in units.items():
        members = unit_entries[uid]
        if members:
            unit["content_page_start"] = min(item["content_page_start"] for item in members)
            unit["content_page_end"] = max(item["content_page_end"] for item in members)
        unit["entry_count"] = len(members)
        unit["unique_term_count"] = len({item["canonical_term"] for item in members})

    expected = source.get("expected", {})
    marker_count = sum(1 for line in lines if "▶ [" in line)
    checks = {
        "page_heading_count": len(pages),
        "page_heading_min": min(pages),
        "page_heading_max": max(pages),
        "page_heading_duplicates": len(pages) - len(set(pages)),
        "entry_marker_count": marker_count,
        "parsed_entry_count": len(entries),
    }
    if sorted(pages) != list(range(1, expected["content_pages"] + 1)):
        raise ValueError("Content page headings are not a complete consecutive range")
    if marker_count != expected["entry_markers"] or len(entries) != marker_count:
        raise ValueError(
            f"Entry regression: markers={marker_count}, parsed={len(entries)}, "
            f"expected={expected['entry_markers']}"
        )

    raw_json_path = resolve_source_path(source["raw_json_path"])
    raw_json = read_json(raw_json_path)
    raw_answers = [item.get("answer", "") for item in raw_json.get("qa_pairs", [])]
    checks.update(
        {
            "raw_turn_count": len(raw_json.get("qa_pairs", [])),
            "raw_entry_marker_count": sum(answer.count("▶ [") for answer in raw_answers),
        }
    )

    return {
        "source": {
            "id": source_id,
            "title": source["title"],
            "collection": source["collection"],
            "kind": source["kind"],
            "markdown_path": str(markdown_path),
            "pdf_path": str(resolve_source_path(source["pdf_path"])),
            "raw_json_path": str(raw_json_path),
            "markdown_sha256": sha256(markdown_path),
            "pdf_sha256": sha256(resolve_source_path(source["pdf_path"])),
            "known_gaps": source.get("known_gaps", []),
            "checks": checks,
        },
        "units": sorted(units.values(), key=lambda item: (item["section"], item["index"])),
        "groups": sorted(groups.values(), key=lambda item: (item["section"], item["index"])),
        "entries": entries,
    }


def parse_optional_int(value: str | None) -> int | None:
    value = (value or "").strip()
    return int(value) if value else None


def parse_standard_csv_source(source: dict[str, Any]) -> dict[str, Any]:
    """Parse a future user-maintained CSV without assuming an affix layout."""
    csv_path = resolve_source_path(source["csv_path"])
    source_id = source["id"]
    section = source.get("section", "custom")
    units: dict[str, dict[str, Any]] = {}
    groups: dict[str, dict[str, Any]] = {}
    entries: list[dict[str, Any]] = []
    unit_by_label: dict[str, str] = {}
    group_by_label: dict[tuple[str, str], str] = {}
    seen_entry_ids: set[str] = set()

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not {"term", "definition_zh"}.issubset(reader.fieldnames):
            raise ValueError(f"CSV source {csv_path} must contain term and definition_zh")
        for row_number, row in enumerate(reader, start=2):
            headword = (row.get("term") or "").strip()
            if not headword:
                continue
            unit_label = (row.get("unit") or "未分類").strip() or "未分類"
            group_label = (row.get("group") or unit_label).strip() or unit_label

            if unit_label not in unit_by_label:
                index = len(unit_by_label) + 1
                unit_hash = hashlib.sha256(canonicalize(unit_label).encode("utf-8")).hexdigest()[:12]
                uid = f"{source_id}:{section}:u-{unit_hash}"
                unit_by_label[unit_label] = uid
                units[uid] = {
                    "id": uid, "source_id": source_id, "section": section,
                    "index": index, "title_zh": unit_label, "title_en": None,
                    "content_page_start": None, "content_page_end": None,
                }
            uid = unit_by_label[unit_label]
            group_key = (uid, group_label)
            if group_key not in group_by_label:
                index = len(group_by_label) + 1
                group_identity = canonicalize(unit_label) + "\0" + canonicalize(group_label)
                group_hash = hashlib.sha256(group_identity.encode("utf-8")).hexdigest()[:12]
                gid = f"{source_id}:{section}:g-{group_hash}"
                group_by_label[group_key] = gid
                groups[gid] = {
                    "id": gid, "source_id": source_id, "section": section,
                    "index": index, "unit_id": uid, "forms": [group_label],
                    "meaning_zh": "", "status": "complete", "note": None,
                    "content_page_start": None, "content_page_end": None,
                }
            gid = group_by_label[group_key]

            variants = [item.strip() for item in headword.split("/") if item.strip()]
            parts_of_speech = [
                item.strip()
                for item in re.split(r"[|+,/]", (row.get("pos") or ""))
                if item.strip()
            ]
            relation_type = (row.get("relation_type") or "").strip() or None
            quality_flags: list[str] = []
            if relation_type and relation_type not in {"同", "近", "反", "關", "衍"}:
                quality_flags.append("invalid_relation_label")
            source_key = (row.get("source_key") or "").strip()
            identity = (
                "key\0" + source_key
                if source_key
                else "fields\0" + "\0".join(
                    [canonicalize(headword), canonicalize(unit_label), canonicalize(group_label)]
                )
            )
            entry_hash = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
            entry_id = f"{source_id}:csv:{entry_hash}"
            if entry_id in seen_entry_ids:
                raise ValueError(
                    f"CSV source {csv_path} has duplicate stable identity at row {row_number}; "
                    "add a unique source_key value to those rows"
                )
            seen_entry_ids.add(entry_id)
            entry = {
                "id": entry_id,
                "source_id": source_id, "source_order": len(entries) + 1,
                "headword": headword, "canonical_term": canonicalize(variants[0]),
                "variants": variants,
                "pronunciation": (row.get("pronunciation") or "").strip() or None,
                "parts_of_speech": parts_of_speech,
                "definition_zh": (row.get("definition_zh") or "").strip() or None,
                "relation_type": relation_type,
                "relation_term": (row.get("relation_term") or "").strip() or None,
                "exam_tag": (row.get("exam_tag") or "").strip() or None,
                "difficulty": parse_optional_int(row.get("difficulty")),
                "etymology": (row.get("etymology") or "").strip() or None,
                "example_en": (row.get("example_en") or "").strip() or None,
                "example_zh": (row.get("example_zh") or "").strip() or None,
                "content_page_start": parse_optional_int(row.get("source_page")),
                "content_page_end": parse_optional_int(row.get("source_page")),
                "pdf_page": parse_optional_int(row.get("pdf_page")),
                "printed_page": parse_optional_int(row.get("printed_page")),
                "section": section, "unit_id": uid, "group_id": gid,
                "quality_flags": quality_flags, "raw_header": headword,
            }
            required = {
                "pronunciation": "missing_pronunciation",
                "parts_of_speech": "missing_part_of_speech",
                "definition_zh": "missing_definition_zh",
                "example_en": "missing_example_en",
                "example_zh": "missing_example_zh",
            }
            for field, flag in required.items():
                if not entry.get(field):
                    entry["quality_flags"].append(flag)
            entry["quality_flags"] = sorted(set(entry["quality_flags"]))
            entries.append(entry)

    group_entries: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unit_entries: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        group_entries[entry["group_id"]].append(entry)
        unit_entries[entry["unit_id"]].append(entry)
    for gid, group in groups.items():
        members = group_entries[gid]
        group["entry_count"] = len(members)
        group["unique_term_count"] = len({item["canonical_term"] for item in members})
    for uid, unit in units.items():
        members = unit_entries[uid]
        unit["entry_count"] = len(members)
        unit["unique_term_count"] = len({item["canonical_term"] for item in members})

    return {
        "source": {
            "id": source_id, "title": source["title"],
            "collection": source.get("collection", source["title"]),
            "kind": source["kind"], "markdown_path": str(csv_path),
            "pdf_path": "", "raw_json_path": "",
            "markdown_sha256": sha256(csv_path), "pdf_sha256": "",
            "known_gaps": [],
            "checks": {"csv_data_rows": len(entries), "parsed_entry_count": len(entries)},
        },
        "units": list(units.values()), "groups": list(groups.values()), "entries": entries,
    }


def build_ranges(
    sources: list[dict[str, Any]],
    units: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    ranges: list[dict[str, Any]] = []

    def add(
        rid: str,
        kind: str,
        name: str,
        parent_id: str | None,
        members: list[dict[str, Any]],
        status: str = "complete",
    ) -> None:
        lexeme_ids = list(dict.fromkeys(item["lexeme_id"] for item in members))
        ranges.append(
            {
                "id": rid,
                "kind": kind,
                "name": name,
                "parent_id": parent_id,
                "status": status,
                "entry_count": len(members),
                "unique_term_count": len(lexeme_ids),
                "entry_ids": [item["id"] for item in members],
                "lexeme_ids": lexeme_ids,
            }
        )

    add("all", "all", "全部單字", None, entries)
    for source in sources:
        source_members = [item for item in entries if item["source_id"] == source["id"]]
        source_range = f"source:{source['id']}"
        add(source_range, "source", source["title"], "all", source_members)
        source_sections = sorted(
            {item.get("section") for item in source_members if item.get("section")}
        )
        for section in source_sections:
            section_members = [
                item
                for item in source_members
                if item.get("section") == section
            ]
            if not section_members:
                continue
            add(
                f"section:{source['id']}:{section}",
                "section",
                SECTION_ZH.get(section, section),
                source_range,
                section_members,
            )

    for unit in units:
        members = [item for item in entries if item.get("unit_id") == unit["id"]]
        add(
            f"range:{unit['id']}",
            "unit",
            f"{SECTION_ZH.get(unit['section'], unit['section'])} UNIT {unit['index']}｜{unit['title_zh']}",
            f"section:{unit['source_id']}:{unit['section']}",
            members,
        )

    for group in groups:
        members = [item for item in entries if item.get("group_id") == group["id"]]
        forms = ", ".join(group["forms"]) if group["forms"] else "未知"
        add(
            f"range:{group['id']}",
            "group",
            f"{SECTION_ZH.get(group['section'], group['section'])} {group['index']:03d}｜{forms}｜{group['meaning_zh']}",
            f"range:{group['unit_id']}",
            members,
            group["status"],
        )
    return ranges


def build_lexemes(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Explicit slash variants form one connected lexeme. This also lets a later
    # standalone "catalogue" source join the existing "catalog/catalogue" card.
    parent: dict[str, str] = {}

    def find(value: str) -> str:
        parent.setdefault(value, value)
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def union(left: str, right: str) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    entry_keys: dict[str, list[str]] = {}
    for entry in entries:
        keys = list(dict.fromkeys(canonicalize(item) for item in entry["variants"] if item.strip()))
        if not keys:
            keys = [entry["canonical_term"]]
        entry_keys[entry["id"]] = keys
        for key in keys[1:]:
            union(keys[0], key)
        find(keys[0])

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        grouped[find(entry_keys[entry["id"]][0])].append(entry)

    lexemes: list[dict[str, Any]] = []
    components = []
    for members in grouped.values():
        aliases = {
            key
            for member in members
            for key in entry_keys[member["id"]]
        }
        canonical_term = min(aliases, key=lambda item: (len(item), item))
        components.append((canonical_term, members))

    for canonical_term, members in sorted(components, key=lambda item: item[0]):
        lid = "lexeme:" + hashlib.sha256(canonical_term.encode("utf-8")).hexdigest()[:16]
        variants: list[str] = []
        for member in members:
            member["canonical_term"] = canonical_term
            member["lexeme_id"] = lid
            for variant in member["variants"]:
                if canonicalize(variant) not in {canonicalize(item) for item in variants}:
                    variants.append(variant)
        lexemes.append(
            {
                "id": lid,
                "canonical_term": canonical_term,
                "display_headword": members[0]["headword"],
                "variants": variants,
                "primary_entry_id": members[0]["id"],
                "entry_count": len(members),
                "entry_ids": [item["id"] for item in members],
                "source_ids": list(dict.fromkeys(item["source_id"] for item in members)),
                "has_multiple_definitions": len({item["definition_zh"] for item in members}) > 1,
            }
        )
    return lexemes


def quality_summary(entries: list[dict[str, Any]]) -> dict[str, Any]:
    canonical_counts = Counter(item["canonical_term"] for item in entries)
    duplicate_terms = {
        term: [item["id"] for item in entries if item["canonical_term"] == term]
        for term, count in sorted(canonical_counts.items())
        if count > 1
    }
    flags = Counter(flag for item in entries for flag in item["quality_flags"])
    issues = [
        {"entry_id": item["id"], "headword": item["headword"], "flags": item["quality_flags"]}
        for item in entries
        if item["quality_flags"]
    ]
    field_presence = {
        field: sum(bool(item.get(field)) for item in entries)
        for field in (
            "headword", "pronunciation", "parts_of_speech", "definition_zh",
            "exam_tag", "difficulty", "etymology", "example_en", "example_zh",
            "unit_id", "group_id",
        )
    }
    pos_distribution = Counter(
        "+".join(item["parts_of_speech"]) for item in entries
    )
    return {
        "entry_count": len(entries),
        "unique_canonical_terms": len(canonical_counts),
        "duplicate_term_group_count": len(duplicate_terms),
        "duplicate_extra_occurrences": sum(count - 1 for count in canonical_counts.values() if count > 1),
        "duplicate_terms": duplicate_terms,
        "field_presence": field_presence,
        "section_distribution": dict(sorted(Counter(item["section"] for item in entries).items())),
        "parts_of_speech_distribution": dict(sorted(pos_distribution.items())),
        "relation_distribution": dict(sorted(Counter(item["relation_type"] or "none" for item in entries).items())),
        "exam_tag_distribution": dict(
            sorted(Counter(item["exam_tag"] or "none" for item in entries).items())
        ),
        "difficulty_distribution": {
            str(key) if key is not None else "none": value
            for key, value in sorted(
                Counter(item["difficulty"] for item in entries).items(),
                key=lambda pair: (pair[0] is None, pair[0] or 0),
            )
        },
        "pronunciations_with_backtick_stress": sum(
            "`" in (item.get("pronunciation") or "") for item in entries
        ),
        "quality_flag_counts": dict(sorted(flags.items())),
        "entries_requiring_review": issues,
    }


def validate_build(build: dict[str, Any], quality: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    checks: dict[str, dict[str, Any]] = {}

    def check(name: str, actual: Any, expected: Any) -> None:
        passed = actual == expected
        checks[name] = {"actual": actual, "expected": expected, "passed": passed}
        if not passed:
            raise ValueError(f"Validation failed for {name}: actual={actual!r}, expected={expected!r}")

    enabled_sources = [source for source in manifest["sources"] if source.get("enabled", True)]
    for source in enabled_sources:
        expected = source.get("expected")
        if not expected:
            continue
        prefix = source["id"] + "."
        source_entries = [item for item in build["entries"] if item["source_id"] == source["id"]]
        source_units = [item for item in build["units"] if item["source_id"] == source["id"]]
        source_groups = [item for item in build["groups"] if item["source_id"] == source["id"]]
        source_quality = quality_summary(source_entries)
        section = Counter(item["section"] for item in source_entries)
        check(prefix + "entry_count", len(source_entries), expected["entry_markers"])
        check(prefix + "unique_canonical_terms", source_quality["unique_canonical_terms"], expected["unique_canonical_terms"])
        check(prefix + "prefix_entries", section["prefix"], expected["prefix_entries"])
        check(prefix + "root_entries", section["root"], expected["root_entries"])
        check(prefix + "unit_count", len(source_units), expected["unit_count"])
        check(prefix + "group_count", len(source_groups), expected["group_count_including_placeholders"])
        check(prefix + "duplicate_term_groups", source_quality["duplicate_term_group_count"], expected["duplicate_term_groups"])
        check(prefix + "trusted_zh_examples", source_quality["field_presence"]["example_zh"], expected["trusted_zh_examples"])
        check(prefix + "prefix_021_missing", next(group["entry_count"] for group in source_groups if group["id"].endswith(":prefix:g021")), 0)
        check(prefix + "prefix_022_inferred", next(group["entry_count"] for group in source_groups if group["id"].endswith(":prefix:g022")), 17)
    return {"generated_at": build["generated_at"], "all_passed": True, "checks": checks}


def write_csv(entries: list[dict[str, Any]]) -> None:
    path = OUTPUT_DIR / "vocabulary_review.csv"
    fields = [
        "id", "lexeme_id", "source_order", "headword", "canonical_term", "variants",
        "pronunciation", "parts_of_speech", "definition_zh", "relation_type",
        "relation_term", "exam_tag", "difficulty", "etymology", "example_en",
        "example_zh", "section", "unit_id", "group_id", "content_page_start",
        "content_page_end", "pdf_page", "printed_page", "quality_flags",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for entry in entries:
            row = {field: entry.get(field) for field in fields}
            for field in ("variants", "parts_of_speech", "quality_flags"):
                row[field] = " | ".join(row[field] or [])
            writer.writerow(row)


def write_sqlite(
    build: dict[str, Any], ranges: list[dict[str, Any]], quality: dict[str, Any]
) -> None:
    path = OUTPUT_DIR / "vocabulary.sqlite3"
    temp = OUTPUT_DIR / "vocabulary.sqlite3.tmp"
    if temp.exists():
        temp.unlink()
    connection = sqlite3.connect(temp)
    try:
        connection.executescript(
            """
            PRAGMA journal_mode = DELETE;
            PRAGMA foreign_keys = ON;
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE source (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, collection_name TEXT NOT NULL,
              kind TEXT NOT NULL, markdown_sha256 TEXT NOT NULL, pdf_sha256 TEXT NOT NULL,
              checks_json TEXT NOT NULL, gaps_json TEXT NOT NULL
            );
            CREATE TABLE unit (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL, section TEXT NOT NULL,
              unit_index INTEGER NOT NULL, title_zh TEXT NOT NULL, title_en TEXT,
              content_page_start INTEGER, content_page_end INTEGER, entry_count INTEGER NOT NULL,
              FOREIGN KEY (source_id) REFERENCES source(id)
            );
            CREATE TABLE word_group (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL, unit_id TEXT NOT NULL,
              section TEXT NOT NULL, group_index INTEGER NOT NULL, forms_json TEXT NOT NULL,
              meaning_zh TEXT NOT NULL, status TEXT NOT NULL, note TEXT,
              content_page_start INTEGER, content_page_end INTEGER, entry_count INTEGER NOT NULL,
              FOREIGN KEY (source_id) REFERENCES source(id),
              FOREIGN KEY (unit_id) REFERENCES unit(id)
            );
            CREATE TABLE lexeme (
              id TEXT PRIMARY KEY, canonical_term TEXT NOT NULL UNIQUE,
              display_headword TEXT NOT NULL, variants_json TEXT NOT NULL,
              primary_entry_id TEXT NOT NULL, entry_count INTEGER NOT NULL,
              entry_ids_json TEXT NOT NULL, source_ids_json TEXT NOT NULL,
              has_multiple_definitions INTEGER NOT NULL
            );
            CREATE TABLE entry (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_order INTEGER NOT NULL,
              headword TEXT NOT NULL, canonical_term TEXT NOT NULL, lexeme_id TEXT NOT NULL,
              variants_json TEXT NOT NULL,
              pronunciation TEXT, parts_of_speech_json TEXT NOT NULL, definition_zh TEXT,
              relation_type TEXT, relation_term TEXT, exam_tag TEXT, difficulty INTEGER,
              etymology TEXT, example_en TEXT, example_zh TEXT, section TEXT,
              unit_id TEXT, group_id TEXT, content_page_start INTEGER,
              content_page_end INTEGER, pdf_page INTEGER,
              printed_page INTEGER, quality_flags_json TEXT NOT NULL, raw_header TEXT NOT NULL,
              FOREIGN KEY (source_id) REFERENCES source(id),
              FOREIGN KEY (lexeme_id) REFERENCES lexeme(id),
              FOREIGN KEY (unit_id) REFERENCES unit(id),
              FOREIGN KEY (group_id) REFERENCES word_group(id)
            );
            CREATE TABLE range_definition (
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
              parent_id TEXT, status TEXT NOT NULL, entry_count INTEGER NOT NULL,
              unique_term_count INTEGER NOT NULL,
              FOREIGN KEY (parent_id) REFERENCES range_definition(id)
            );
            CREATE TABLE range_entry (
              range_id TEXT NOT NULL, entry_id TEXT NOT NULL,
              PRIMARY KEY (range_id, entry_id),
              FOREIGN KEY (range_id) REFERENCES range_definition(id),
              FOREIGN KEY (entry_id) REFERENCES entry(id)
            );
            CREATE TABLE range_lexeme (
              range_id TEXT NOT NULL, lexeme_id TEXT NOT NULL,
              PRIMARY KEY (range_id, lexeme_id),
              FOREIGN KEY (range_id) REFERENCES range_definition(id),
              FOREIGN KEY (lexeme_id) REFERENCES lexeme(id)
            );
            CREATE INDEX idx_entry_canonical ON entry(canonical_term);
            CREATE INDEX idx_entry_lexeme ON entry(lexeme_id);
            CREATE INDEX idx_entry_group ON entry(group_id);
            CREATE INDEX idx_entry_unit ON entry(unit_id);
            CREATE INDEX idx_range_entry_entry ON range_entry(entry_id);
            CREATE INDEX idx_range_lexeme_lexeme ON range_lexeme(lexeme_id);
            """
        )
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            [("schema_version", str(build["schema_version"])), ("generated_at", build["generated_at"])],
        )
        for source in build["sources"]:
            connection.execute(
                "INSERT INTO source VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    source["id"], source["title"], source["collection"], source["kind"],
                    source["markdown_sha256"], source["pdf_sha256"],
                    json.dumps(source["checks"], ensure_ascii=False),
                    json.dumps(source["known_gaps"], ensure_ascii=False),
                ),
            )
        for unit in build["units"]:
            connection.execute(
                "INSERT INTO unit VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    unit["id"], unit["source_id"], unit["section"], unit["index"],
                    unit["title_zh"], unit["title_en"], unit["content_page_start"],
                    unit["content_page_end"], unit["entry_count"],
                ),
            )
        for group in build["groups"]:
            connection.execute(
                "INSERT INTO word_group VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    group["id"], group["source_id"], group["unit_id"], group["section"],
                    group["index"], json.dumps(group["forms"], ensure_ascii=False),
                    group["meaning_zh"], group["status"], group["note"],
                    group["content_page_start"], group["content_page_end"], group["entry_count"],
                ),
            )
        for lexeme in build["lexemes"]:
            connection.execute(
                "INSERT INTO lexeme VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    lexeme["id"], lexeme["canonical_term"], lexeme["display_headword"],
                    json.dumps(lexeme["variants"], ensure_ascii=False),
                    lexeme["primary_entry_id"], lexeme["entry_count"],
                    json.dumps(lexeme["entry_ids"], ensure_ascii=False),
                    json.dumps(lexeme["source_ids"], ensure_ascii=False),
                    int(lexeme["has_multiple_definitions"]),
                ),
            )
        for entry in build["entries"]:
            connection.execute(
                "INSERT INTO entry VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    entry["id"], entry["source_id"], entry["source_order"], entry["headword"],
                    entry["canonical_term"], entry["lexeme_id"],
                    json.dumps(entry["variants"], ensure_ascii=False),
                    entry["pronunciation"], json.dumps(entry["parts_of_speech"], ensure_ascii=False),
                    entry["definition_zh"], entry["relation_type"], entry["relation_term"],
                    entry["exam_tag"], entry["difficulty"], entry["etymology"],
                    entry["example_en"], entry["example_zh"], entry["section"],
                    entry["unit_id"], entry["group_id"], entry["content_page_start"],
                    entry["content_page_end"], entry["pdf_page"], entry["printed_page"],
                    json.dumps(entry["quality_flags"], ensure_ascii=False), entry["raw_header"],
                ),
            )
        for item in ranges:
            connection.execute(
                "INSERT INTO range_definition VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    item["id"], item["kind"], item["name"], item["parent_id"],
                    item["status"], item["entry_count"], item["unique_term_count"],
                ),
            )
            connection.executemany(
                "INSERT INTO range_entry(range_id, entry_id) VALUES (?, ?)",
                [(item["id"], entry_id) for entry_id in item["entry_ids"]],
            )
            connection.executemany(
                "INSERT INTO range_lexeme(range_id, lexeme_id) VALUES (?, ?)",
                [(item["id"], lexeme_id) for lexeme_id in item["lexeme_ids"]],
            )
        connection.commit()
    finally:
        connection.close()
    temp.replace(path)


def write_report(build: dict[str, Any], quality: dict[str, Any]) -> None:
    entries = build["entries"]
    units = build["units"]
    groups = build["groups"]
    by_section = Counter(item["section"] for item in entries)
    unit_lines = []
    for unit in units:
        unit_lines.append(
            f"| {SECTION_ZH.get(unit['section'], unit['section'])} | {unit['index']} | {unit['title_zh']} | "
            f"{unit['entry_count']} | {unit['unique_term_count']} |"
        )
    flag_lines = [
        f"| `{flag}` | {count} |" for flag, count in quality["quality_flag_counts"].items()
    ] or ["| 無 | 0 |"]
    missing_groups = [item for item in groups if item["status"] != "complete"]
    missing_lines = [
        f"- {SECTION_ZH.get(item['section'], item['section'])} {item['index']:03d}：{item['meaning_zh']}（{item['status']}）— {item['note']}"
        for item in missing_groups
    ] or ["- 無"]
    source_lines = []
    for source in build["sources"]:
        members = [item for item in entries if item["source_id"] == source["id"]]
        source_lines.append(
            f"| {source['title']} | `{source['kind']}` | {len(members)} | "
            f"{len({item['lexeme_id'] for item in members})} |"
        )
    section_summary = "、".join(
        f"{SECTION_ZH.get(section, section)} {count} 筆"
        for section, count in sorted(by_section.items())
    )
    content = f"""# 單字範圍報告

生成時間：{build['generated_at']}

## 目前可用範圍

- 已登記來源：**{len(build['sources'])} 個**。
- 來源出現紀錄：**{len(entries)} 筆**。
- 可直接用於不重複卡組的 lexeme：**{quality['unique_canonical_terms']} 個**。
- 篇章分布：{section_summary}。
- UNIT：{len(units)} 個；原分類節點：{len(groups)} 個。
- 完全相同單字重複：{quality['duplicate_term_group_count']} 組，保留 {quality['duplicate_extra_occurrences']} 筆額外來源出現紀錄，不會破壞原分類。

| 來源 | 類型 | 出現紀錄 | 唯一詞 |
|---|---|---:|---:|
{chr(10).join(source_lines)}

## 原書分類

| 篇章 | UNIT | 原分類 | 出現紀錄 | 唯一詞 |
|---|---:|---|---:|---:|
{chr(10).join(unit_lines)}

## 已知缺口

{chr(10).join(missing_lines)}

- 原始 PDF 未包含原書第 34、35 頁；因此缺口無法靠重新解析現有檔案補回。
- PDF 第 47、48 頁是原書第 64、65 頁（筆記頁與字根篇標題頁），不屬於單字內容。
- `英單1.pdf` 共 84 頁；排除上述 2 個非單字頁後，82 個內容頁已建立頁碼映射。
- `toeic_vocabulary_notebooklm.raw.json` 僅作稽核來源；正式建檔使用已去重、已排除污染回合的 Markdown。

## 資料品質

| 檢查旗標 | 筆數 |
|---|---:|
{chr(10).join(flag_lines)}

品質旗標不會讓資料消失；App 可以正常顯示該卡，也能提供「待校對」篩選。

## 範圍合併規則

`ranges.json` 與 SQLite 的 `range_definition` / `range_entry` / `range_lexeme` 已建立以下層級：

1. 全部單字
2. 來源／單字書
3. 字首、字根、字尾篇
4. UNIT
5. 原書字首／字根分類

日後選取多個範圍時，預設對 lexeme ID 做聯集，避免同字重複出卡；需要查看不同詞義時再展開 entry。跨分類的同一 canonical term 共用學習進度，但仍保留各自例句、解碼與來源。

## App 後續資料原則

- `entry` 是來源出現紀錄；`lexeme` 是跨來源單字身分，並以 `canonical_term` 查找。
- 學習進度、FSRS 卡片狀態與 append-only 作答事件要放在營運資料庫，不回寫來源檔。
- 新增資料先進 `imports/`，完成解析與校對後再重建；不要手改 `data/generated/`。
"""
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(content, encoding="utf-8")


def main() -> None:
    manifest = read_json(MANIFEST_PATH)
    parsers = {
        "notebooklm_markdown": parse_notebooklm_source,
        "standard_csv": parse_standard_csv_source,
    }
    parsed = []
    for source in manifest["sources"]:
        if not source.get("enabled", True):
            continue
        if source["kind"] not in parsers:
            raise ValueError(f"Unsupported source kind: {source['kind']}")
        parsed.append(parsers[source["kind"]](source))
    build = {
        "schema_version": manifest["schema_version"],
        "generated_at": now_iso(),
        "sources": [item["source"] for item in parsed],
        "units": [unit for item in parsed for unit in item["units"]],
        "groups": [group for item in parsed for group in item["groups"]],
        "entries": [entry for item in parsed for entry in item["entries"]],
    }
    build["lexemes"] = build_lexemes(build["entries"])
    ranges = build_ranges(build["sources"], build["units"], build["groups"], build["entries"])
    quality = quality_summary(build["entries"])
    validation = validate_build(build, quality, manifest)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT_DIR / "vocabulary.json", build)
    write_json(
        OUTPUT_DIR / "ranges.json",
        {"schema_version": build["schema_version"], "generated_at": build["generated_at"], "ranges": ranges},
    )
    write_json(OUTPUT_DIR / "quality_report.json", quality)
    write_json(OUTPUT_DIR / "validation_report.json", validation)
    write_csv(build["entries"])
    write_sqlite(build, ranges, quality)
    write_report(build, quality)

    print(json.dumps({
        "entries": len(build["entries"]),
        "unique_terms": quality["unique_canonical_terms"],
        "units": len(build["units"]),
        "groups": len(build["groups"]),
        "ranges": len(ranges),
        "quality_flags": quality["quality_flag_counts"],
        "output": str(OUTPUT_DIR),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
