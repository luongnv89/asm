# Step 2 — Snapshot pre-run skill counts

Record `skillCount` for each enabled repo **before** re-ingesting. Step 7 uses these as the "Before" column.

If a repo is enabled but has no existing index file, treat the pre-count as `0`. That repo will land in **updated** with a positive delta.

```bash
mkdir -p /tmp/refresh-index
SNAPSHOT="/tmp/refresh-index/pre-snapshot.json"
echo "{}" > "$SNAPSHOT"
for entry in $(jq -r '.repos[] | select(.enabled == true) | "\(.owner)_\(.repo)"' "$RES"); do
  file="$ROOT/data/skill-index/${entry}.json"
  if [ -f "$file" ]; then
    count=$(jq -r '.skillCount // 0' "$file")
    jq --arg k "$entry" --argjson v "$count" '. + {($k): $v}' "$SNAPSHOT" > "$SNAPSHOT.tmp" && mv "$SNAPSHOT.tmp" "$SNAPSHOT"
  fi
done
```

`$RES` and `$ROOT` are set in Step 1 of SKILL.md. Do not invent a different snapshot path — Cleanup deletes `/tmp/refresh-index`.
