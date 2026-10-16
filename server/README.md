# whatsapp-summarize server

Connects to your WhatsApp account as a linked device, stores every message (1:1, groups, archived and
muted chats) in SQLite, and exposes a small authenticated REST API for the Android app.

## Read-only guarantees

The server never sends messages, read receipts, or presence, and never marks chats as read:

- `markOnlineOnConnect: false` — the device announces itself as *unavailable*, so delivery receipts
  go out as "inactive" (like a backgrounded WhatsApp Web tab) and your phone keeps notifying you.
- `getMessage` returns nothing, so retry requests from other devices never cause a resend.
- `sendMessage`, `readMessages`, `sendReceipt(s)`, `sendPresenceUpdate`, `chatModify` and similar
  socket methods are replaced with stubs that throw (`lockDownSocket` in `src/whatsapp.ts`).

Media files are never downloaded; only the type and caption are stored.

## Run with Docker (on the server)

```bash
cp .env.example .env        # set API_TOKEN (openssl rand -hex 32)
docker compose up -d --build
docker compose logs -f      # scan the QR printed here, or open the Pairing screen in the app
```

Data (`messages.db` and `auth/`) is kept in `./data`. The API listens on `127.0.0.1:3000`; put your
HTTPS reverse proxy in front of it. Alternatively set `HOST` to the server's Tailscale IP and reach it as
`http://<tailscale-ip>:3000` from your Tailscale devices only (Tailscale already encrypts the traffic).

To use a pairing code instead of the QR, set `PAIRING_PHONE` (e.g. `905551234567`) before the first
start; the code is printed in the logs and returned by `GET /pairing`.

If you unlink the device from your phone, the server stops reconnecting and `/status` reports
`logged_out`. Delete `data/auth` and restart to pair again.

## Run locally

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

## Test

```bash
npm test
```

## Summaries

`POST /summaries` groups the messages in the range by chat, summarizes each chat separately
(large chats are split into token-bounded chunks whose briefs are merged), then writes one combined
overview. The result is validated with zod (one retry on invalid output), stored in the `summaries`
table and returned. Items the model reports are kept only if their `message_id` is a real message
from that chat; chat and sender names come from the database, not the model.

Provider is chosen with `SUMMARY_PROVIDER` (`anthropic` or `openai`) and `SUMMARY_MODEL`; keys come
only from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. To use Gemini, set `SUMMARY_PROVIDER=openai`, put the
Gemini key in `OPENAI_API_KEY`, and set `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`.
Any other OpenAI-compatible gateway works the same way, e.g. OmniRoute: `OPENAI_BASE_URL=http://<host>:20128/v1`,
the OmniRoute key in `OPENAI_API_KEY`, and one of its model ids (such as `antigravity/gemini-3.1-flash-lite`) in `SUMMARY_MODEL`.
On a free tier with a per-minute quota, set `SUMMARY_MAX_RPM` (e.g. `5`): requests are spaced out
and a 429 is retried once after a minute, so a summary takes longer but completes.
Output language is `SUMMARY_LANGUAGE` (default Turkish). Message times are shown to the model in the
server's time zone (`TZ`).

## API

Every request needs `Authorization: Bearer <API_TOKEN>`. Times are ISO 8601.

| Method | Path              | Returns |
|--------|-------------------|---------|
| GET    | `/pairing`        | `{ status, qr, pairing_code }` — `qr` is a PNG data URL while waiting for pairing |
| POST   | `/pairing/code`   | Body `{ phone }` (international format). Returns `{ pairing_code }` for WhatsApp → Linked devices → Link a device → Link with phone number instead. 409 unless waiting for pairing. |
| GET    | `/status`         | `{ connection, me, message_count, last_message_time }` |
| POST   | `/summaries`      | Body `{ since?, until?, chat_ids? }`. Default range: since the end of the last successful summary over all chats (or the last 24 hours), until now. Returns `{ id, created_at, provider, model, chat_ids, range, must_not_miss, questions_to_me, mentions_of_me, dates_and_plans, per_chat, overall }`. 409 while another summary runs, 503 if the provider is not configured, 502 if it fails. |
| GET    | `/summaries`      | List, newest first: `{ id, created_at, range, status, provider, model, chat_ids, must_not_miss_count, chat_count, error }` |
| GET    | `/summaries/:id`  | One summary (list fields plus the full result) |
| GET    | `/chats`          | `{ id, name, is_group, unread_since_last_summary, last_message_time }` per chat |

`status`/`connection` is one of `connecting`, `awaiting_pairing`, `open`, `closed`, `logged_out`.
`must_not_miss`, `questions_to_me` and `mentions_of_me` items are `{ chat, sender, message_id, reason }`;
`dates_and_plans` items are `{ what, when, chat }`; `per_chat` items are `{ chat, brief, message_count }`.
