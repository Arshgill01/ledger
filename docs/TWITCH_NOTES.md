# Twitch notes

Observed behaviours worth remembering. Add to this when you learn something the docs don't say.

- `Send Chat Message` with `pin: true` needs `moderator:manage:chat_messages` on the token and the sender must be the broadcaster or a mod. Pin lasts 20 minutes, not configurable. Cannot combine with `reply_parent_message_id`. (Changelog 2026-05-15.)
- `Create Clip` is async: poll `Get Clips?id=` for up to ~60 s before giving up. Default clip = last 30 s of a 90 s window ending at the call.
- `channel.follow` is **v2** and requires `moderator:read:followers` plus `moderator_user_id` in the condition.
- EventSub WebSocket: subscriptions must be created within 10 s of `session_welcome`, max 300 enabled per client. Handle `session_reconnect` by connecting to the new URL *before* closing the old socket.
- Non-Affiliate test channels: `channel.subscribe` / `channel.cheer` subscriptions are accepted but will never fire. Follows and raids work. Use the Twitch CLI (`twitch event trigger`) for local mocks if needed, or demo mode.

## Codex handoff, Nov 2

- Developer console rejected app registration for `clasher1110` with “user must have two factor auth enabled to perform this action.” Account-owner setup is required before credentials can be generated.
- Confirmed the documented `pin` behavior against [Send Chat Message](https://dev.twitch.tv/docs/api/reference/#send-chat-message). Real pinning was subsequently verified below; clips still require a live stream.
- EventSub may redeliver notifications using the same metadata `message_id`; deduplicate before changing counters. On Twitch-directed reconnect, keep the old socket until the replacement welcome arrives and do not recreate subscriptions. See [WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/). Local WebSocket tests cover these paths; they do not establish live Twitch behavior.
- After enabling 2FA, the developer console's existing session was invalidated. A fresh developer login with an authenticator code allowed registration of the confidential app **Ledger Receipts** with callback `http://localhost:3000/auth/callback`. Credentials are only in the gitignored local `.env`.
- Broadcaster OAuth succeeded for `clasher1110`; all seven subscriptions were accepted. With explicit user permission, sent a clearly labeled setup IOU through real Twitch chat, observed EventSub delivery and the bot acknowledgment, verified `!owed`, then `!due` and confirmed the pin using `GET /helix/chat/pins`. Removed only the test pin and voided the test IOU. Clips were temporarily disabled during this offline test, then restored. Restart restored auth and the persisted VOID record; no real clip/follow/microphone claim is made.
