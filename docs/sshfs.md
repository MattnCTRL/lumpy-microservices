# Editing a Mac's files from a box session (SSHFS)

A Lumpy session runs on the orchestrator box, but sometimes the files you want
it to work on live on a Mac — including uncommitted changes that aren't in any
repo yet. SSHFS bridges that: the box mounts a directory from the Mac over the
tailnet, and a session can read and edit those files as if they were local.

The box is the SSHFS **client**; the Mac is the SSH **server**. Files are
mounted under the session user's home so autonomous sessions (which run as the
non-root `lumpy` user) can write to them.

## One-time setup on the Mac

1. **Enable Remote Login:** System Settings → General → Sharing → turn on
   **Remote Login**. (This starts the Mac's SSH server.)
2. **Authorize the box's key:** the mount uses a dedicated box→Mac key so it's
   independent of any human key and easy to revoke. The first run of the mount
   script prints the public key to add to `~/.ssh/authorized_keys` on the Mac.

Both machines must be on the same tailnet (the Mac is reachable at its tailnet
IP, e.g. `100.125.22.103`).

## Mounting (on the box, as root)

```bash
cd /opt/lumpy
MAC_HOST=100.125.22.103 MAC_USER=matt bash scripts/mount-mac.sh
```

On first run, if the box can't reach the Mac yet, the script prints its public
key and exits — add that key on the Mac (step 2 above), then re-run.

Options:

| Variable       | Default               | Purpose                                            |
| -------------- | --------------------- | -------------------------------------------------- |
| `MAC_HOST`     | _(required)_          | Mac's tailnet IP or name.                          |
| `MAC_USER`     | _(required)_          | Login user on the Mac.                             |
| `MAC_PATH`     | `/Users/<MAC_USER>`   | Remote path to mount.                              |
| `NAME`         | derived from host     | Mount label under `~/macs/`.                       |
| `SESSION_USER` | `lumpy`               | Local user that owns the mount.                    |

The files land at `/home/lumpy/macs/<name>`. Point a session's workspace there
(or `cd` into it) to work on the Mac's files.

## Unmounting

```bash
fusermount -u /home/lumpy/macs/<name>
```

## Notes

- The mount is owned by the session user (`uid`/`gid` mapped), so sessions can
  edit freely; `allow_other` (enabled via `/etc/fuse.conf`) lets the session
  user reach a mount created by root.
- `reconnect` + `ServerAliveInterval` keep the mount alive across brief network
  blips; if the Mac sleeps, the mount stalls until it wakes.
- This is a manual mount today. A persistent/auto-remount on boot (systemd
  automount) is a planned extension; for now re-run the script after a reboot.
- Revoke access by removing the `lumpy-mac-mount@box` key line from the Mac's
  `~/.ssh/authorized_keys`.
