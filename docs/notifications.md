# Notifications

The `notify` module pushes actionable alerts to [ntfy](https://ntfy.sh). It
subscribes to the event spine and turns selected events into phone
notifications — including approve/reject buttons for session permission prompts.

## What triggers a notification

| Event                                  | Notification                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A session enters `awaiting_permission` | "&lt;name&gt; needs you" — with **Approve** / **Reject** action buttons when a public URL is configured. |
| A server goes `offline`                | "&lt;name&gt; is offline" — with a link to the Fleet view.                                               |

More triggers (alert rules, remediation outcomes) will publish here as those
modules land. Notifications are edge-triggered, so you get one per transition,
not a stream.

## Setup

1. Pick a **hard-to-guess topic** name (on the public ntfy.sh, anyone who knows
   the topic can read and post to it — treat it like a secret).
2. Install the **ntfy app** on your phone and subscribe to that topic.
3. Configure the orchestrator:

   ```bash
   LUMPY_NTFY_TOPIC=lumpy-7c3f9a2b-...     # your secret topic
   LUMPY_PUBLIC_URL=http://<tailscale-ip>:4317   # optional, enables links + buttons
   ```

   With no topic set, notifications are disabled (the module logs and stays
   dormant).

## Approve / reject from your phone

When `LUMPY_PUBLIC_URL` is set, permission notifications include **Approve** and
**Reject** buttons. Tapping them sends an HTTP request from the ntfy app to the
orchestrator's session input endpoint (Approve = Enter, Reject = Esc). For this
to work your phone must be able to reach `LUMPY_PUBLIC_URL` — i.e. be on the same
Tailscale tailnet. This is the remote-control loop: a session asks for
permission, your phone buzzes, you approve from the lock screen.

## Self-hosting ntfy

To keep everything private, run your own ntfy server and point the orchestrator
at it:

```bash
LUMPY_NTFY_URL=https://ntfy.your-tailnet.ts.net
```

Self-hosting is recommended once notifications carry sensitive context. See
[security.md](security.md).
