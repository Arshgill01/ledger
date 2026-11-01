# Twitch notes

Observed behaviours worth remembering. Add to this when you learn something the docs don't say.

- `Send Chat Message` with `pin: true` needs `moderator:manage:chat_messages` on the token and the sender must be the broadcaster or a mod. Pin lasts 20 minutes, not configurable. Cannot combine with `reply_parent_message_id`. (Changelog 2026-05-15.)
- `Create Clip` is async: poll `Get Clips?id=` for up to ~60 s before giving up. Default clip = last 30 s of a 90 s window ending at the call.
- `channel.follow` is **v2** and requires `moderator:read:followers` plus `moderator_user_id` in the condition.
- EventSub WebSocket: subscriptions must be created within 10 s of `session_welcome`, max 300 enabled per client. Handle `session_reconnect` by connecting to the new URL *before* closing the old socket.
- Non-Affiliate test channels: `channel.subscribe` / `channel.cheer` subscriptions are accepted but will never fire. Follows and raids work. Use the Twitch CLI (`twitch event trigger`) for local mocks if needed, or demo mode.
