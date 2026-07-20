#!/usr/bin/env python3
"""Build the local CEEC 108 (111 academic year onward) vocabulary import.

The CEEC list supplies the official spelling, part of speech and level. Chinese
definitions and phonetics are matched from ECDICT, which is MIT licensed. This
script is intentionally separate from ``build_scope.py`` so a normal catalog
build never needs network access.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from urllib.request import Request, urlopen

try:
    from opencc import OpenCC  # type: ignore[import-not-found]
except ImportError:
    OpenCC = None  # type: ignore[assignment,misc]


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "imports" / "ceec-108-level-2-to-6.csv"
CEEC_JSON_URL = (
    "https://raw.githubusercontent.com/EngTW/English-for-Programmers/main/"
    "lists/Taiwan-high-school-6K-108-edition/Data/"
    "Taiwan-high-school-english-reference-vocabulary-list-108-edition.json"
)
ECDICT_CSV_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
TRADITIONALIZER = OpenCC("s2twp") if OpenCC else None


def canonicalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().strip()
    return re.sub(r"\s+", " ", value)


def fetch_text(url: str) -> io.TextIOWrapper:
    request = Request(url, headers={"User-Agent": "MorphemeDesk/1.0 (local vocabulary import)"})
    response = urlopen(request, timeout=120)
    return io.TextIOWrapper(response, encoding="utf-8", newline="")


def lookup_keys(term: str) -> list[str]:
    """Return likely ECDICT headwords for a CEEC display term."""
    values = [term]
    values.extend(part.strip() for part in term.split("/") if part.strip())
    without_parenthetical = re.sub(r"\s*\([^)]*\)", "", term).strip()
    if without_parenthetical:
        values.append(without_parenthetical)
    values.extend(
        re.sub(r"\([^)]*\)", "", part).strip()
        for part in term.split("/")
        if re.sub(r"\([^)]*\)", "", part).strip()
    )
    return list(dict.fromkeys(canonicalize(value) for value in values if value))


def load_ceec_records(url: str) -> list[dict[str, object]]:
    with fetch_text(url) as handle:
        raw = json.load(handle)

    chosen: dict[str, dict[str, object]] = {}
    for item in raw:
        level = str(item.get("Level", "")).strip()
        term = str(item.get("Word", "")).strip()
        if level not in {"2", "3", "4", "5", "6"} or not term:
            continue
        # The official list may mention a spelling once more in a different
        # presentation form. Keep the first classification for stable source
        # order and a single study card.
        key = canonicalize(term)
        chosen.setdefault(key, {"term": term, "level": level, "pos": item.get("PartsOfSpeech", [])})
    return sorted(chosen.values(), key=lambda item: (int(str(item["level"])), canonicalize(str(item["term"]))))


def load_dictionary(rows: Iterable[dict[str, str]], wanted: set[str]) -> dict[str, dict[str, str]]:
    matched: dict[str, dict[str, str]] = {}
    for row in rows:
        key = canonicalize(row.get("word", ""))
        if key in wanted and key not in matched:
            matched[key] = row
    return matched


def concise_translation(value: str) -> str:
    value = re.sub(r"\s*\n\s*", "；", value or "").strip("； ")
    value = re.sub(r"\s+", " ", value)
    return value[:240].rstrip("； ")


def to_traditional(value: str) -> str:
    return TRADITIONALIZER.convert(value) if TRADITIONALIZER else value


def build_rows(ceec_records: list[dict[str, object]], dictionary: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for item in ceec_records:
        term = str(item["term"])
        level = str(item["level"])
        entry = next((dictionary[key] for key in lookup_keys(term) if key in dictionary), None)
        translation = concise_translation(entry.get("translation", "") if entry else "")
        if not translation:
            translation = "待補中文釋義"
        parts_of_speech = item.get("pos", [])
        if not isinstance(parts_of_speech, list):
            parts_of_speech = []
        rows.append(
            {
                "source_key": f"ceec-108:level-{level}:{canonicalize(term)}",
                "term": term,
                "pronunciation": (entry.get("phonetic", "") if entry else "").strip(),
                "pos": "|".join(str(part).strip() for part in parts_of_speech if str(part).strip()),
                "definition_zh": to_traditional(translation),
                "relation_type": "",
                "relation_term": "",
                "exam_tag": "CEEC-108",
                "difficulty": level,
                "etymology": "",
                "example_en": "",
                "example_zh": "",
                "collection": "大考中心高中英文參考詞彙表（111學年度起適用）",
                "unit": f"LEVEL {level}",
                "group": "官方清單",
                "source_page": "",
                "pdf_page": "",
                "printed_page": "",
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ceec-json-url", default=CEEC_JSON_URL)
    parser.add_argument("--ecdict-csv-url", default=ECDICT_CSV_URL)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    ceec_records = load_ceec_records(args.ceec_json_url)
    wanted = {key for record in ceec_records for key in lookup_keys(str(record["term"]))}
    with fetch_text(args.ecdict_csv_url) as handle:
        dictionary = load_dictionary(csv.DictReader(handle), wanted)

    rows = build_rows(ceec_records, dictionary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    missing = sum(row["definition_zh"] == "待補中文釋義" for row in rows)
    print(json.dumps({"entries": len(rows), "dictionary_matches": len(rows) - missing, "missing": missing, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
