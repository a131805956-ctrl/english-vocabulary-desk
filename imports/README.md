# 新增單字來源

這裡是後續新增資料的入口。原始檔請保留，不要直接覆蓋 `data/generated/` 內的產物。

目前建議流程：

1. PDF、掃描檔或既有單字書先放在這個資料夾。
2. 若已整理成表格，複製 `_vocabulary_template.csv`，每列填一個來源中的單字。
3. 在 `data/source_manifest.json` 登記來源；PDF/掃描檔需要先抽取成可校對的 Markdown 或 CSV。
4. 執行 `python scripts/build_scope.py` 重建 JSON、CSV、SQLite 與範圍報告。

同一個英文字在不同書或分類再次出現時，不要刪掉其中一筆。系統會保留每個來源出現紀錄，並用 `canonical_term` 將學習進度匯總到同一個單字。

標準 CSV 已可直接匯入。把以下物件加入 manifest 的 `sources` 陣列即可：

```json
{
  "id": "my-list",
  "title": "我的新單字表",
  "collection": "我的新單字表",
  "kind": "standard_csv",
  "csv_path": "imports/my-list.csv",
  "section": "custom",
  "enabled": true
}
```

`term` 與 `definition_zh` 必填；其餘欄位可留空並由品質報告列出。`unit`、`group` 會自動成為可勾選與合併的範圍。程式會用「單字 + unit + group」建立穩定 ID，因此重排或插入 CSV 列不會破壞既有進度；若同一 group 需要兩筆完全相同單字，請為它們填入不同的 `source_key`。
