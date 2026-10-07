# งานสรุปข่าวเช้าของ ChatGeo

ไฟล์นี้เก็บคำสั่งของงานอัตโนมัติ "Chatgeo ข่าวเช้า" ที่รันทุกเช้าบน claude.ai/code/routines (ใช้แพ็กเกจ Claude ที่มีอยู่ ไม่มีค่า API)
งานนั้นมี prompt สั้นๆ ให้มาอ่านไฟล์นี้ แก้ไฟล์นี้แล้วอัปโหลด งานรอบถัดไปจะทำตามคำสั่งใหม่ทันที

## งานนี้ทำอะไร

1. ค้นข่าวจริง: ข่าวไทยกระจาย 6 ภาค, ข่าว AI ทั่วโลก (งานวิจัยและผลิตภัณฑ์) และข่าวต่างประเทศที่กระทบไทยเล็กน้อย
2. เก็บข้อมูลน้ำ ฝน และพยากรณ์สำรองไว้ที่ `data/live.json` ด้วย `scripts/fetch_public_data.py`
3. ตรวจข่าวด้วย `scripts/publish_brief.py` แล้วเขียน `data/latest.json` กับ `data/briefs/<วันที่>.json`
4. commit แล้ว push เข้า `main` จากนั้น GitHub Pages จะอัปเดตเว็บเองใน 1–2 นาที

## สิ่งที่ต้องตั้งไว้ในหน้า Routines

- Repository: `Choonahakarn/chatgeo`
- Environment › Network access: **Full** เพราะต้องเปิดเว็บข่าวและ API ข้อมูลน้ำได้
- Connectors: ไม่ต้องใช้

## คำสั่งของงาน

```text
You produce today's ChatGeo morning news brief (in Thai) and publish it to the public website repository. Work autonomously; nobody is watching. Do not message anyone, do not open pull requests, and change nothing except what the steps below describe.

WEBSITE REPO: github.com/Choonahakarn/chatgeo (served by GitHub Pages at https://choonahakarn.github.io/chatgeo/)
DATE: get today's date in Bangkok with bash: TZ=Asia/Bangkok date +%F  (call it DATE, format YYYY-MM-DD).

1) RESEARCH (use WebSearch/WebFetch; you may run up to 4 research subagents in parallel: Thailand North+Northeast / Thailand Central+East+West+South / AI worldwide / Markets+Thai weather+foreign news affecting Thailand)
Collect 16–20 REAL news stories published within the last ~36 hours:
- THAILAND (region "th"): 10–12 stories spread across the six regions — ภาคเหนือ, ภาคตะวันออกเฉียงเหนือ (อีสาน), ภาคกลางและกรุงเทพฯ, ภาคตะวันออก, ภาคตะวันตก, ภาคใต้. Aim for at least one story located in each region (use real local news: floods, local economy, tourism, agriculture, crime/safety, infrastructure, local politics, environment). At most 4 may be Bangkok/nationwide. Good sources: Thai PBS, Bangkok Post, The Nation, Khaosod English, Thairath, Matichon, Prachachat, Chiang Mai CityLife, The Isaan Record, The Phuket News, Pattaya Mail, regional sections of national outlets.
- AI WORLDWIDE (region "ai", layer "ai"): 5–6 stories about artificial intelligence: about half RESEARCH (new papers, benchmarks, open models, lab research results — e.g. arXiv, Hugging Face papers, Google DeepMind, OpenAI, Anthropic, Meta AI, Microsoft Research, university labs, Thai AI research such as NECTEC) and half PRODUCTS (launches, major features, company moves, important AI policy). Prefer primary sources (official lab/company blog, the paper itself) or reputable tech press (Reuters, The Verge, TechCrunch, Ars Technica, MIT Technology Review, VentureBeat). place = city of the lab/company/event (e.g. ซานฟรานซิสโก lon -122.42 lat 37.77, ลอนดอน, ปักกิ่ง, โตเกียว, กรุงเทพฯ).
- FOREIGN (region "world"): 2–3 non-AI stories from abroad or ASEAN that clearly affect Thailand (energy prices, trade, neighbours, major disasters).
Strict rules:
- Every story must have a real article URL that you actually saw in search results or opened. Never construct or guess a URL. If unsure, drop the story.
- Confirm the publication date is within the window.
- Write title/summary/why in Thai, in your own words (never copy sentences). Title ≤ 70 characters. Summary = 1–2 short sentences with the key facts as reported. Never add facts not in the source.
- why_label is "ผลต่อไทย" (direct effect on Thailand/Thai people) or "ควรรู้"; why = one short Thai sentence grounded in the article.
- place = short Thai place name; lon/lat = approximate event location (2 decimals). A Thai story must be placed in the province where it happened (that is how the site sorts it into a region). Nationwide Thai stories use Bangkok (100.50, 13.75); spread several Bangkok stories by ±0.05°.
- layer ∈ conflict (politics/conflict/security), market (economy/markets/prices), biz (companies/investment/trade), ai (technology/AI/digital), weather (weather/floods/disasters), area (environment/society/health/history/tourism), news (other).
- ids: th1, th2… / ai1, ai2… / w1…; rank 1..N by importance to Thai readers; top=true for the 5 most important.
- Verification: open at least 6 of the story URLs with WebFetch (at least 2 Thai regional, 2 AI) and confirm headline, date and facts match your summary; fix or drop mismatches.
Markets (latest close, never invent numbers — omit an item you cannot confirm): SET Index, Brent crude (USD/barrel), Thai gold bar price (บาท, ราคาขายออก) or spot gold, USD/THB. Each: name, value (formatted string), unit, change (Thai text e.g. "+4.83 (+0.31%)" or "บาทอ่อนค่า จาก 33.55"), dir ("up"/"down"/"flat"; for USD/THB use "down" when the baht weakens), source, url.
Thai weather for today from the Thai Meteorological Department (directly or via a news report of its forecast) for: ภาคเหนือ, ภาคตะวันออกเฉียงเหนือ, ภาคกลางและกรุงเทพฯ, ภาคตะวันออก, ภาคใต้ — short Thai status, level ("normal"/"watch"/"warning"), and place id th-n, th-ne, bkk, th-e, th-s respectively. Plus a one-sentence Thai weatherNote and weatherSource {name, url}.
questions: 4 short Thai questions a reader might ask about today's stories, each with a layer (first one always {"q":"สรุปข่าวเช้านี้","layer":"accent"}; include one about a Thai region and one about AI).

2) BUILD the document (JSON object) exactly in this shape:
{"date": DATE, "generatedAt": ISO-8601 time with +07:00, "generatedBy": "scheduled task",
 "stories": [{"id","rank","top","region","layer","title","summary","why_label","why","place","lon","lat","published":"YYYY-MM-DD","source","url"}],
 "markets": [{"name","value","unit","change","dir","source","url"}], "marketsAsOf": "ปิดตลาด D ต.ค. 2569"-style Thai text,
 "weather": [{"region","status","level","place"}], "weatherNote": "...", "weatherSource": {"name","url"},
 "questions": [{"q","layer"}]}
region ∈ "th", "ai", "world". Validate: JSON parses, 16–20 stories, every story has all fields, lon in [-180,180], lat in [-85,85], unique ids, layer/region values from the lists above, every url starts with https://. Save it as /tmp/brief.json (outside any git repository).
If you could not produce at least 8 verified stories, do NOT write anywhere (skip step 3) and explain why in the report.

3) WEBSITE (GitHub)
a. Find the clone of Choonahakarn/chatgeo: check whether the current directory is inside a git repository whose `git remote get-url origin` contains "Choonahakarn/chatgeo"; if not, run: find / -maxdepth 5 -type f -path '*/scripts/publish_brief.py' 2>/dev/null and check that file's repository the same way. If there is no such clone, stop and report "repository not attached to this scheduled task".
b. In the clone: git checkout main && git pull --rebase origin main
c. Run: python3 scripts/fetch_public_data.py
   It refreshes the backup copy of water level, 24-hour rain and 3-day forecast data in data/live.json. If a source cannot be reached it keeps the previous data; that is not an error — continue.
d. Run: python3 scripts/publish_brief.py /tmp/brief.json
   It re-validates and cleans the brief, writes data/briefs/DATE.json and data/latest.json, and removes briefs older than 30 days. If it exits with an error, fix /tmp/brief.json according to its messages and run it again. Never edit any other file in the repository.
e. git status --porcelain must list only paths under data/. Then: git add -A data && git commit -m "ข่าวเช้า DATE". If no git identity is configured, add -c user.name="ChatGeo bot" -c user.email="chatgeo-bot@users.noreply.github.com" to the commit command.
f. Push straight to main (no new branch, no pull request): git push origin HEAD:main. If it is rejected because main moved, run git pull --rebase origin main and push again (at most 3 attempts).
g. Confirm with: git fetch origin main && git log -1 --format='%h %s' origin/main

4) FINISH with a short Thai report: DATE, number of stories per Thai region / AI / foreign, which market/weather items were missing, whether data/live.json was refreshed, any URLs you dropped, and whether the website commit was pushed (with its short hash).
```
