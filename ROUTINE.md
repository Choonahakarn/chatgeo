# งานสรุปข่าวเช้าของ ChatGeo

ไฟล์นี้เก็บคำสั่งของงานอัตโนมัติ "ChatGeo สรุปข่าวเช้า" ที่รันทุกวัน 04:48 น. (เวลาไทย) ในบัญชี Claude
งานนี้ใช้แพ็กเกจ Claude ที่มีอยู่ ไม่มีค่า API

## งานนี้ทำอะไร

1. ค้นข่าวจริง 12–16 เรื่อง (ไทย อาเซียน โลก) ตรวจลิงก์ แล้วสรุปเป็นภาษาไทยพร้อมพิกัด
2. รัน `python3 scripts/publish_brief.py` เพื่อตรวจข่าวอีกรอบ แล้วเขียน `data/latest.json` กับ `data/briefs/<วันที่>.json`
3. commit แล้ว push เข้า `main` จากนั้น GitHub Pages จะอัปเดตเว็บเองในเวลา 1–2 นาที
4. บันทึกข่าวชุดเดียวกันลงหน้า ChatGeo ในแอป Claude ด้วย

งานนี้จะ push เข้า GitHub ได้ก็ต่อเมื่อ:

- ติดตั้ง Claude GitHub App ให้รีโพ `Choonahakarn/chatgeo` แล้ว
- เพิ่มรีโพนี้ในงานที่ claude.ai/code/routines แล้ว

## ถ้าต้องสร้างงานใหม่

คัดลอกข้อความในกรอบด้านล่างทั้งหมดไปวางเป็น prompt แล้วตั้งค่าดังนี้:

- Repository: `Choonahakarn/chatgeo`
- เวลา: ทุกวัน 04:48 น. (Asia/Bangkok)

```text
You produce today's ChatGeo morning news brief (in Thai) and publish it to (A) the public website repository on GitHub and (B) the ChatGeo artifact's database. Work autonomously; nobody is watching. Do not message anyone, do not open pull requests, and change nothing except what steps 3–5 describe.

WEBSITE REPO: github.com/Choonahakarn/chatgeo (served by GitHub Pages at https://choonahakarn.github.io/chatgeo/)
ARTIFACT URL: https://claude.ai/artifact/62JQLqyS3eFGKD9gL7c3MV
DATE: get today's date in Bangkok with bash: TZ=Asia/Bangkok date +%F  (call it DATE, format YYYY-MM-DD).

1) RESEARCH (use WebSearch/WebFetch; you may run up to 4 research subagents in parallel: Thailand / ASEAN incl. South China Sea / World / Markets+Thai weather)
Collect 12–16 REAL news stories published within the last ~36 hours: about 5 Thailand (region "th"), 4 Southeast Asia (region "asean"), 5 rest of world (region "world"). Spread across categories (politics/security, economy/markets, business, tech/AI, weather/disaster, society). Prefer reputable outlets (Thai PBS, Bangkok Post, The Nation, Khaosod English, Prachachat, Thairath, Reuters, AP, BBC, Al Jazeera, Nikkei Asia, CNA, etc.).
Strict rules:
- Every story must have a real article URL that you actually saw in search results or opened. Never construct or guess a URL. If unsure, drop the story.
- Confirm the publication date is within the window.
- Write title/summary/why in Thai, in your own words (never copy sentences). Title ≤ 70 characters. Summary = 1–2 short sentences with the key facts as reported. Never add facts not in the source.
- why_label is "ผลต่อไทย" (direct effect on Thailand/Thai people) or "ควรรู้"; why = one short Thai sentence grounded in the article.
- place = short Thai place name; lon/lat = approximate event location (2 decimals). Nationwide Thai stories use Bangkok (100.50, 13.75); spread several Bangkok stories by ±0.1°.
- layer ∈ conflict (politics/conflict/security), market (economy/markets/prices), biz (companies/investment/trade), ai (technology/AI/digital), weather (weather/floods/disasters), area (environment/society/health/history), news (other).
- ids: th1, th2… / as1… / w1…; rank 1..N by importance to Thai readers; top=true for the 5 most important.
- Verification: open at least 5 of the story URLs with WebFetch and confirm headline, date and facts match your summary; fix or drop mismatches.
Markets (latest close, never invent numbers — omit an item you cannot confirm): SET Index, Brent crude (USD/barrel), Thai gold bar price (บาท, ราคาขายออก) or spot gold, USD/THB. Each: name, value (formatted string), unit, change (Thai text e.g. "+4.83 (+0.31%)" or "บาทอ่อนค่า จาก 33.55"), dir ("up"/"down"/"flat"; for USD/THB use "down" when the baht weakens), source, url.
Thai weather for today from the Thai Meteorological Department (directly or via a news report of its forecast) for: ภาคเหนือ, ภาคตะวันออกเฉียงเหนือ, ภาคกลางและกรุงเทพฯ, ภาคตะวันออก, ภาคใต้ — short Thai status, level ("normal"/"watch"/"warning"), and place id th-n, th-ne, bkk, th-e, th-s respectively. Plus a one-sentence Thai weatherNote and weatherSource {name, url}.
questions: 4 short Thai questions a reader might ask about today's top stories, each with a layer (first one always {"q":"สรุปข่าวเช้านี้","layer":"accent"}).

2) BUILD the document (JSON object) exactly in this shape:
{"date": DATE, "generatedAt": ISO-8601 time with +07:00, "generatedBy": "scheduled task",
 "stories": [{"id","rank","top","region","layer","title","summary","why_label","why","place","lon","lat","published":"YYYY-MM-DD","source","url"}],
 "markets": [{"name","value","unit","change","dir","source","url"}], "marketsAsOf": "ปิดตลาด D ต.ค. 2569"-style Thai text,
 "weather": [{"region","status","level","place"}], "weatherNote": "...", "weatherSource": {"name","url"},
 "questions": [{"q","layer"}]}
Validate: JSON parses, 12–16 stories, every story has all fields, lon in [-180,180], lat in [-85,85], unique ids, layer/region values from the lists above, every url starts with https://. Save it as /tmp/brief.json (outside any git repository).
If you could not produce at least 8 verified stories, do NOT write anywhere (skip steps 3–5) and explain why in the report.

3) WEBSITE (GitHub)
a. Find the clone of Choonahakarn/chatgeo: check whether the current directory is inside a git repository whose `git remote get-url origin` contains "Choonahakarn/chatgeo"; if not, run: find / -maxdepth 5 -type f -path '*/scripts/publish_brief.py' 2>/dev/null and check that file's repository the same way. If there is no such clone, skip step 3 and report "repository not attached to this scheduled task".
b. In the clone: git checkout main && git pull --rebase origin main
c. Run: python3 scripts/publish_brief.py /tmp/brief.json
   It re-validates and cleans the brief, writes data/briefs/DATE.json and data/latest.json, and removes briefs older than 30 days. If it exits with an error, fix /tmp/brief.json according to its messages and run it again. Never edit any other file in the repository.
d. git status --porcelain must list only paths under data/. Then: git add -A data && git commit -m "ข่าวเช้า DATE". If no git identity is configured, add -c user.name="ChatGeo bot" -c user.email="chatgeo-bot@users.noreply.github.com" to the commit command.
e. Push straight to main (no new branch, no pull request): git push origin HEAD:main. If it is rejected because main moved, run git pull --rebase origin main and push again (at most 3 attempts).
f. Confirm with: git fetch origin main && git log -1 --format='%h %s' origin/main

4) ARTIFACT DATABASE: with the ArtifactData tool, action "set", url above, collection "briefs", doc_id DATE, file_path /tmp/brief.json. If the write is refused because the document already exists, do action "get" on it and repeat the "set" with if_version set to the version you read. If the ArtifactData tool is not available, skip steps 4–5 and say so in the report.

5) HOUSEKEEPING (artifact only): action "list" on collection "briefs"; for each document whose id (a date) is more than 30 days before DATE, action "delete" with its if_version. Never delete anything else.

6) FINISH with a short Thai report: DATE, number of stories per region, which market/weather items were missing, any URLs you dropped, whether the website commit was pushed (with its short hash) and whether the artifact database was updated.
```
