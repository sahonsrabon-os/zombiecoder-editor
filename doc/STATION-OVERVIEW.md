# 🧟 ZombieCoder — Mission Barisal · সম্পূর্ণ স্টেশন

**দুটো সম্পূর্ণ আলাদা ফোল্ডার — একটি স্টেশন।**

```
C:\Users\sahon\zombiecoder-station\
│
├── README.md                  ← এই ফাইল (মাস্টার ডকুমেন্ট)
│
├── zombiecoder-editor\        ← 🅰️ এডিটর স্টেশন (VS Code এক্সটেনশন)
│      package.json · src\ · doc\ · tests · out-build · VSIX
│
└── zombiecoder-server\        ← 🅱️ সার্ভার স্টেশন (গেটওয়ে + MCP)
       api.js · provider\ · agent\ · external mcp\ · tools\ · tests\
```

> **মূলনীতি:** এডিটর আর সার্ভার কখনো এক ফোল্ডারে মেশানো হয় না — এডিটর VS Code-এ চলে,
> সার্ভার আলাদা Node.js প্রসেসে। চাইলে দুটো আলাদা মেশিনেও চলতে পারে
> (সার্ভার Linux VPS-এ, এডিটর ডেস্কটপ VS Code-এ)। প্রতিটি ফোল্ডারের ভেতরে
> তার নিজস্ব ডকুমেন্টেশন আছে (নিচে তালিকা দেওয়া হলো), আর এই ফাইলটি দুইয়ের
> **মিলিত ভিত্তি-ডকুমেন্ট** — ক্লোন-ও-রান, VSIX বিল্ড, ধারাবাহিক প্রমাণ এবং
> সার্ভারের প্রতিটি কম্পোনেন্ট/টুল/MCP-এর তালিকা।

---

## 📌 ১. দ্রুত তালিকা — কী কোথায়

| জিনিস | এডিটর স্টেশন | সার্ভার স্টেশন |
|---|---|---|
| ফোল্ডার | `zombiecoder-editor/` | `zombiecoder-server/` |
| মূল এন্ট্রি | `src/extension.ts` (TS → esbuild `out/extension.js`) | `api.js` (স্টার্ট: `start.js`) |
| ভাষা | TypeScript (VS Code API) | Pure Node.js (zero-dependency) |
| ভার্সন | **1.7.1** | **3.2.1** |
| যোগাযোগের প্রোটোকল | VS Code Language Model API → `languageModelChatProviders` | HTTP · SSE · WebSocket · Unix socket (Windows: named pipe/TCP) |
| টেস্ট | **520/520 pass** (`node --test`) | 49/49 + **12/12 (নতুন hot-loop ফিক্স রিগ্রেশন)** |
| নিজস্ব ডক | `doc\` (১৪টি ফাইল) | `docs\` + `README.md` |

---

## 🅰️ ২. ZombieCoder Editor — VS Code এক্সটেনশন স্টেশন

### ২.১ কী কী
VS Code-এর `contributes.languageModelChatProviders` কন্ট্রাক্ট অনুযায়ী পরিচালিত
ZombieCoder চ্যাট প্রোভাইডার + ইনলাইন কমপ্লিশন। ব্র্যান্ডিং সম্পূর্ণ ডাইনামিক
(`src/branding.ts` — `getProductName()` = "ZombieCoder", `getPlatformName()` = "Mission Barisal"),
কোনো হার্ডকোড URL নেই (`src/config/endpoints.ts`), ট্রান্সপোর্ট ক্রস-প্ল্যাটফর্ম
(Windows: `\\.\pipe\zombiecoder-mcp` · Linux: UDS `<tmpdir>/zombiecoder/mcp.sock`),
Microsoft-এর অফিসিয়াল ডক অনুযায়ী `managementCommand` → `contributes.commands` লিংকড।

- **5টি কমান্ড:** `manage` (গেটওয়ে কনফিগ), `testConnection`, `refreshModels`, `editCustomHeaders`, `showOutput`
- **ভুমিকা:** মিশন কনটেক্সট (SSOT/সিলেবাস) তৈরি, প্রমাণ-গেট, টুল-কল রিপেয়ার, মেমরি সিস্টেম, স্ট্যাটাস বার
- **কনফিগ:** একটাই সেটিং `zombiecoder.mission-barisal.serverUrl` (খালি = স্বয়ংক্রিয় লোকাল ডিটেক্ট)

### ২.২ ডাইরেক্ট ক্লোন ও রান
```bash
# ১) ক্লোন
git clone https://github.com/sahonsrabon-os/zombiecoder-editor.git zombiecoder-editor
cd zombiecoder-editor

# ২) ডিপেন্ডেন্সি
npm install

# ৩) বিল্ড (বান্ডল)
npm run esbuild          # → out/extension.js

# ৪) VS Code-এ F5 চাপো (Extension Development Host) — অথবা:
#     Code ➤ Run and Debug ➤ "Run Extension"
```

### ২.৩ VSIX ফাইল বিল্ড (এডিটর ডিস্ট্রিবিউশন)
```bash
npm install
npm run esbuild
npm run package          # = vsce package --no-yarn
# → zombiecodercoder-mission-barisal-1.7.1.vsix
```
পরে VS Code ➤ Extensions ➤ `...` ➤ **Install from VSIX...** অথবা CLI:
```bash
code --install-extension zombiecoder-mission-barisal-1.7.1.vsix
```

### ২.৪ ধারাবাহিক প্রমাণ — এডিটর (সম্প্রতি যাচাইকৃত)
| ধাপ | কমান্ড | ফলাফল |
|---|---|---|
| 1 | `npm run test-build` | ✅ `out-test` রিজেনারেট (ক্রস-প্ল্যাটফর্ম `rmSync`, POSIX `rm -rf` না) |
| 2 | `npm test` | ✅ **520/520 pass** (`node --test out-test/**/*.test.js`) |
| 3 | `npm run test-compile` (`tsc -p ./`) | ✅ 0 error |
| 4 | `npm run lint` | ✅ 0 error (৪টা pre-existing `any` warning) |
| 5 | `npm run esbuild` | ✅ `out/extension.js` বিল্ড |
| 6 | `npm run package` | ✅ VSIX তৈরি + `managementCommand` manifest-এ validated |
| 7 | ট্রান্সপোর্ট টেস্ট | ✅ Windows named pipe + Linux UDS — দুটোই platform-aware ইউনিট টেস্ট |

### ২.৫ এডিটরের নিজস্ব ডকুমেন্টেশন (`doc\`)
`usage/install.md` · `usage/configuration.md` · `usage/commands.md` ·
`architecture/overview.md` · `architecture/provider-chain.md` · `architecture/server-contract.md` ·
`architecture/transports.md` · `development/build.md` · `development/testing.md` ·
`features/evidence-gate.md` · `features/memory-system.md` · `features/prompt-sanitizer.md` ·
`features/tool-call-repair.md` · `troubleshooting/common-issues.md`

---

## 🅱️ ৩. ZombieCoder Server — Mission Barisal গেটওয়ে স্টেশন

### ৩.১ কী কী
Zero-dependency Node.js সার্ভার — **evidence meets conversation**। MCP-তে কথা বলে
(HTTP JSON-RPC/SSE/WebSocket/Unix socket) এবং OpenAI-ও বলে (`/v1/chat/completions`)।
একই প্রসেসে: ৯ জন এজেন্ট, ৩৬-টুলের MCP বাস, প্রমাণ-গেট (anti-dote), SQLite টেলিমেট্রি,
প্রোভাইডার-ল্যাডার (লোকাল → ক্লাউড), ব্রাউজার অ্যাডমিন প্যানেল, লোকাল LLM ব্রিজ।

### ৩.২ ডাইরেক্ট ক্লোন ও রান
```bash
# ১) ক্লোন
git clone https://github.com/sahonsrabon-os/zombie-bazaar.git zombiecoder-server
cd zombiecoder-server

# ২) এনভায়রনমেন্ট (গোপন কী .env-এ — কখনও commit নয়)
copy .env.example .env        # Windows
cp .env.example .env          # Linux/macOS
# …তারপর .env-এ নিজের API key বসাও (OPENCODE_API_KEY / GROQ_API_KEY / GEMINI_API_KEY …)

# ৩) রান
node start.js                 # CONFIG ALL + START ALL (ইন্টারঅ্যাক্টিভ)
# অথবা সরাসরি:
node api.js                   # মূল গেটওয়ে (port 3000 + UDS/tcp-fallback + 3 external MCP)

# ৪) চেক
curl http://127.0.0.1:3000/health        # → {"status":"ok",…}
curl http://127.0.0.1:3000/identity      # → {domain, serverVersion, …}
open http://127.0.0.1:3000/              # অ্যাডমিন প্যানেল
```

### ৩.৩ সার্ভারের প্রতিটি কম্পোনেন্ট (সব ফাইল, সব ভূমিকা)

| কম্পোনেন্ট | ফাইল | ভূমিকা |
|---|---|---|
| গেটওয়ে কোর | `api.js` | ট্রান্সপোর্ট রেজলভার · এজেন্ট রাউটার · anti-dote চেইন · SQLite টেলিমেট্রি · ৩৬-টুল MCP বাস · OpenAI `/v1` · অ্যাডমিন API |
| স্টার্টার | `start.js` | ক্রস-প্ল্যাটফর্ম এন্ট্রি: CONFIG ALL + START ALL |
| প্রোভাইডার লেয়ার | `provider/index.js` | `chat()`/`chatStream()` + **`normalizeMessages()`** (multipart content flatten) + বাউন্ডারি ভ্যালিডেশন |
| — অ্যাডাপ্টার | `provider/openai.js` `groq.js` `gemini.js` `ollama.js` `opencode.js` | প্রতিটি প্রোভাইডারের অফিসিয়াল ডায়ালেক্ট |
| — স্কিমা/ভ্যালিডেটর | `provider/schema.json` `validator.js` | `#/$defs/chatRequest` & `chatCompletion` — request/response বাউন্ডারি |
| — ট্রান্সপোর্ট | `provider/transport.js` | আউটবাউন্ড http/https (সকেট-প্যাথ সাপোর্ট) |
| — টুল রেজিস্টার | `provider/tools.js` | টুল schema → OpenAI function-calling |
| নরমালাইজার | `normalizer/index.js` | gemini/anthropic/responses → OpenAI নরমাল ফর্ম |
| টুল-লাইব্রেরি | `tools/` | `tool-sanitizer.js` · `model-alias.js` · `context-slimmer.js` · `gen-openai-docs.js` |
| এজেন্ট | `agent/` (৯টি) | bug-hunter · code-guru · customer-experience-specialist · doc-king · ecommerce-operations-analyst · perf-wizard · qa-tyrant · security-hero · team-heart (+ index.js) |
| এজেন্ট ব্যক্তিত্ব | `PERSONAS.md` | ৯ জনার persona সোর্স |
| লোকাল LLM ব্রিজ | `local-llm-bridge.js` | Unix socket/TCP → llama.cpp (RAM-এর মধ্যে) |
| MCP ক্লায়েন্ট | `mcp-client.js` | আউটবাউন্ড MCP কল (`remote_mcp_call`) |
| এক্সটার্নাল MCP লোডার | `external-mcp.js` | `external mcp/`-এর সার্ভার চালু রাখে |
| CDP পাইপ | `cdp-pipe.js` | Chrome DevTools Protocol — পোর্ট-ফ্রি, পাইপ-ওভার |
| ডোমেইন কনফিগ | `domain-config.js` | `domain` ডিটেকশন (0.0.0.0 / 127.0.0.1 / লোকাল) |
| নোট-স্টোর | `note-store.js` | SQLite নোট/মেমরি |
| লোকাল MCP স্টার্ট | `start-local-mcp.js` | OCR/Screen/TTS লোকাল MCP চালু |
| অ্যাডমিন প্যানেল | `public/` | `index.html` + `admin.html` (ব্রাউজার UI) |
| রান-টাইম ডেটা | `data/` | `models.db` (SQLite: models/agents/usage/settings) — git-ignored |
| ডক | `docs/` | openai-tools.md + openai-schema.json + audit + **evidence/** (স্ক্রিনশট) |
| টেস্ট | `tests/` | local-tool-cap · docs-claims · **fallback-hotloop-fix** |
| এক্সটার্নাল টুল | `external tools/` | `tool.js` (ইউনিভার্সাল টুল-কল অ্যাডাপ্টার) · `appsp-internal-connection.js` · `php-broker-server.js` · `servers.json` |

### ৩.৪ প্রোভাইডার ল্যাডার (লোকাল → ক্লাউড)
```
ollama (লোকাল, priority 9) → opencode → groq → gemini → cloudflare → custom_*
```
রাউটিং পলিসি `api.js`-এ: rate-limit cooldown, provider-hop (<3), model-hop,
বাউন্ডারি reject → **fail-fast** (এখন আর infinite loop হয় না — নিচে §৩.১১ প্রমাণ)।

### ৩.৫ এজেন্ট (৯ জনা — DB-থেকে মডেল ম্যাপিং, অ্যাডমিনে বদলানো যায়)
| ID | Persona | রোল |
|---|---|---|
| `bug-hunter` | জারিন — The Hunter | ডিবাগ ও রুট-কজ |
| `code-guru` | মনু — The Architect | আর্কিটেকচার/ডিজাইন প্যাটার্ন |
| `doc-king` | হালিম — The Librarian | ডকুমেন্টেশন |
| `perf-wizard` | রাশেদ — The Optimizer | পারফরম্যান্স |
| `qa-tyrant` | মজনু — The Judge | QA/টেস্ট কভারেজ |
| `security-hero` | ব্রিশ্টি — The Guardian | নিরাপত্তা অডিট |
| `team-heart` | জারা — The Heart | টিম কোঅর্ডিনেশন |
| `customer-experience-specialist` | — | কাস্টমার এক্সপেরিয়েন্স |
| `ecommerce-operations-analyst` | — | ই-কমার্স স্ট্র্যাটেজি |

### ৩.৬ MCP টুল বাস — ৩৬টি টুল (সবগুলো)
| # | টুল | # | টুল |
|---|---|---|---|
| 1 | `agent_mission` | 19 | `ocr__ocr_screenshot` |
| 2 | `agent_single` | 20 | `open_browser` |
| 3 | `append_syllabus` | 21 | `read_file` |
| 4 | `browse_cdp` | 22 | `read_ssot` |
| 5 | `call_agent` | 23 | `remote_mcp_call` |
| 6 | `db_list_tables` | 24 | `rename_file` |
| 7 | `db_query` | 25 | `screen-recorder__screen_record_start` |
| 8 | `delete_file` | 26 | `screen-recorder__screen_record_status` |
| 9 | `env_get` | 27 | `screen-recorder__screen_record_stop` |
| 10 | `exec` | 28 | `screen-recorder__screen_screenshot` |
| 11 | `get_memory` | 29 | `set_working_dir` |
| 12 | `get_working_dir` | 30 | `system_info` |
| 13 | `glob` | 31 | `terminal` |
| 14 | `grep` | 32 | `tts__tts_play` |
| 15 | `http_request` | 33 | `tts__tts_speak` |
| 16 | `list_directory` | 34 | `tts__tts_voices` |
| 17 | `ocr__ocr_crop` | 35 | `web_search` |
| 18 | `ocr__ocr_image` | 36 | `write_file` |

*লাইভ টগল: অ্যাডমিনে কোনো টুল off করলে `tools/list` থেকে বাদ + `tools/call` চোক-পয়েন্টে ব্লক।*

### ৩.৭ এক্সটার্নাল MCP সার্ভার (লোকাল, `external mcp/` — git-ignored, স্টেশনে আছে)
| সার্ভার | ফাইল | পোর্ট | টুল/ভূমিকা |
|---|---|---|---|
| OCR | `ocr-mcp.js` | **3100** | `ocr_image` · `ocr_screenshot` · `ocr_crop` (Tesseract, বাংলা+ইংরেজি) |
| Screen Recorder | `screen-recorder-mcp.js` | **3101** | `screen_screenshot` · `screen_record_start/stop/status` |
| TTS | `tts-mcp.js` | **3102** | `tts_speak` · `tts_voices` · `tts_play` (Microsoft Edge TTS — bn-BD-NabanitaNeural) |
| কম্বাইন্ড | `combined.js` | — | সব লোকাল MCP এক প্রসেসে |
| ফেসবুক অ্যাডস | `facebook-ads-mcp.js` | — | FB Ads API |
| পাবলিক API | `public-api-mcp.js` | — | পাবলিক API ব্রিজ |
| স্কিল টুল | `skill-mcp-tool.js` | — | স্কিল-ভিত্তিক টুল |
| কনফিগ | `servers.json` | — | MCP সার্ভার তালিকা (টোকেন থাকতে পারে → git-ignore) |

### ৩.৮ পোর্ট ম্যাপ
| পোর্ট | কী |
|---|---|
| **3000** | মূল গেটওয়ে (OpenAI `/v1`, MCP HTTP/SSE, অ্যাডমিন UI) |
| **3001** (TCP) / **5100** (UDS) | Windows-এ UDS নেই → TCP loopback fallback; Linux-এ UDS |
| **3100** | OCR MCP |
| **3101** | Screen Recorder MCP |
| **3102** | TTS MCP |
| **11434** | (ঐচ্ছিক) লোকাল Ollama |

### ৩.৯ এনভায়রনমেন্ট ভেরিয়েবল (`.env.example`-এ ডকুমেন্টেড)
`PORT · APP_URL · SESSION_VERIFY_URL · ADMIN_API_KEY · MCP_ADMIN_TOKEN · ADMIN_TOKEN ·
DB_REMOTE_URL · REGISTRY_REMOTE_URL · DB_SQLITE_PATH · UDS_PORT · ALLOWED_ORIGINS ·
MAX_RATE_LIMIT · ALLOWED_DIRS · OPENCODE_* · GROQ_* · GEMINI_* · OLLAMA_* ·
CUSTOM_PROVIDER_N_* · CUSTOM_PROXY_API_KEY · PUSHER_* · CACHE_* · LOG_DIR ·
ANTIDOTE_ENABLED · MAX_TOOL_ROUNDS` — সম্পূর্ণ তালিকা ও কমেন্ট: `.env.example`

### ৩.১০ সার্ভারের নিজস্ব ডকুমেন্টেশন
`README.md` (সিস্টেম আর্কিটেকচার, এজেন্ট টেবিল, লিমিটেশন) · `docs/openai-tools.md` ·
`docs/openai-schema.json` · `docs/audit/AUDIT-QUESTIONS.*` · `docs/evidence/*.jpeg` (স্ক্রিনশট প্রমাণ)

### ৩.১১ ধারাবাহিক প্রমাণ — সার্ভার (বর্তমান স্ন্যাপশট)
| ধাপ | যাচাই | ফলাফল |
|---|---|---|
| 1 | `node tests/local-tool-cap.test.js` | ✅ **49 passed / 0 failed** (+৬ fact) |
| 2 | `node tests/fallback-hotloop-fix.test.js` (নতুন) | ✅ **12/12** — hot-loop ফিক্স + content-normalization রিগ্রেশন |
| 3 | `node tests/docs-claims.test.js` | 15 pass / 3 fail — **pre-existing stale** (schema.agents mapping vs DB, gen-openai-docs sync) |
| 4 | `node --check api.js` / `provider/index.js` | ✅ syntax OK |
| 5 | **লগ-ভিত্তিক প্রমাণ** — `logs/2026-10-08.log`: | |
| 5a | ফিক্সের আগে | ❌ 47,203 fallback pair (~২৮০/সেকেন্ড), 18.6 MB লগ — PC জ্যামের কারণ |
| 5b | ফিক্সের পরে (রিস্টার্ট 21:16 UTC) | ✅ মাত্র ২টি স্বাভাবিক fallback: `ollama stream timeout` → `from: llama3.2:latest to: openai/gpt-oss-120b` — চেইন ঠিকমতো নতুন মডেলে স্যুইচ, কোনো লুপ নেই |
| 6 | `normalizeMessages` ডায়নামিক চেক | ✅ multipart array → string; boundary ভ্যালিডেশন pass (raw array আগে reject হতো) |

---

## 🔗 ৪. রিমোট রিপোজিটরি (push করা হয়েছে ✅)
| ফোল্ডার | রিমোট | main commit |
|---|---|---|
| `zombiecoder-editor` | `https://github.com/sahonsrabon-os/zombiecoder-editor.git` | `0124b0a` (136 ফাইল, TypeScript) |
| `zombiecoder-server` | `https://github.com/sahonsrabon-os/zombie-bazaar.git` | `6b41df5` (57 ফাইল, JavaScript) |

---

## 📜 ৫. ক্রেডিট
**Sahon Srabon · Developer Zone · Dhaka, Bangladesh** — `infi@zombiecoder.my.id`
আর্কিটেক্ট: **Monu — The Builder** (Mission Barisal persona)।
এডিটর LICENSE: `github-copilot-llm-gateway by arbs-io` (লিগ্যাল ক্রেডিট — ব্র্যান্ডিং নয়)।

*জেনারেটেড: 2026-10-09 · স্টেশন ভার্সন 1 — editor 1.7.1 + server 3.2.1*