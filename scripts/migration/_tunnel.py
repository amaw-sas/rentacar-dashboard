#!/usr/bin/env python3
"""SSH-tunnel ownership for the legacy log_veh extraction (issue #45, Phase 2).

Importable, reusable: launch with keepalives, probe the raw MariaDB handshake,
relaunch on silent death, tear down ONLY a forwarder the driver itself started.
Phase 1 saw the tunnel die silently (process alive, forwarding dead), so the
driver re-probes the handshake before every chunk.

Split, like the rest of Phase 2, into:
  * PURE functions at module top — `parse_handshake(first_bytes)` decides liveness
    from raw greeting bytes and is unit-tested on bare Python (no socket, no ssh).
  * Thin IO wrappers below — `probe_handshake`, `ensure_tunnel`, `relaunch_if_dead`,
    `teardown` — exercised live in Step 10, never in the unit suite.

A `TunnelState` records whether THIS driver created the forwarder (`created_by_us`)
and its PID, so `teardown` never kills a pre-existing operator tunnel (SCEN-008).
"""

from __future__ import annotations

import socket
from dataclasses import dataclass

# MariaDB/MySQL client/server protocol version that prefixes the initial
# handshake packet (the byte after the 4-byte packet header). Both MariaDB 10.x
# and MySQL 5.x/8.x speak protocol 10.
PROTOCOL_VERSION_10 = 0x0A

# An ERR packet (server refusing the connection, e.g. too many connections)
# begins with 0xFF in the payload byte — a live server, but not a usable greeting.
ERR_PACKET_MARKER = 0xFF


# --------------------------------------------------------------------------- #
# Pure parser — testable on raw bytes, no socket.
# --------------------------------------------------------------------------- #
def parse_handshake(first_bytes: bytes) -> bool:
    """Return True iff `first_bytes` is the start of a MariaDB/MySQL greeting.

    The wire format of the initial handshake packet:
        bytes 0..2  payload length (3-byte little-endian)
        byte  3     sequence id (0 for the greeting)
        byte  4     protocol version  -> 0x0A for protocol 10
        bytes 5..   NUL-terminated server version string, then more

    Liveness for the tunnel probe means: the forwarded socket actually carried a
    server greeting back, i.e. the first payload byte is the protocol-10 marker
    AND at least one printable version byte follows. Empty input (dead socket,
    forwarding broke after connect) and garbage (a captive proxy, an ERR packet,
    a TLS/HTTP banner) both return False. A 0xFF ERR packet is explicitly NOT a
    usable greeting even though it proves something answered.
    """
    if not first_bytes or len(first_bytes) < 6:
        return False
    payload_first = first_bytes[4]
    if payload_first == ERR_PACKET_MARKER:
        return False
    if payload_first != PROTOCOL_VERSION_10:
        return False
    # A real greeting carries a version string after the protocol byte. Require at
    # least one byte in the printable ASCII range so a `0x0A` that is mere noise
    # (followed by control bytes) is not mistaken for a greeting.
    version_byte = first_bytes[5]
    return 0x20 <= version_byte <= 0x7E


# --------------------------------------------------------------------------- #
# Tunnel state — records ownership so teardown is keyed on created_by_us.
# --------------------------------------------------------------------------- #
@dataclass
class TunnelState:
    """Ownership record for a local-forward SSH tunnel.

    `created_by_us` is the load-bearing flag: `teardown` kills the forwarder ONLY
    when the driver launched it. A pre-existing operator tunnel (the driver found
    the port already live and never launched its own) is left untouched.
    """

    local_port: int
    created_by_us: bool = False
    pid: int | None = None


def should_teardown(state: TunnelState) -> bool:
    """Pure decision: tear down only a forwarder this driver started AND tracked.

    Requires BOTH `created_by_us` and a recorded PID — without a PID there is
    nothing safe to kill, and we must never guess a stranger's process. A
    pre-existing operator tunnel (created_by_us False) is always left alive.
    """
    return bool(state.created_by_us and state.pid is not None)


def build_ssh_forward_argv(
    local_port: int, db_host: str, db_port: int, ssh_host: str
) -> list[str]:
    """Pure builder for the `ssh -fN -L` forward command (no secret on argv).

    Forces the local end to 127.0.0.1 (Phase-1 gotcha: a bare `localhost` lets
    libmysql bypass TCP for a Unix socket). Adds keepalives so a silently broken
    forward is dropped server-side, and `ExitOnForwardFailure` so a port clash
    fails fast instead of leaving a half-open forward.
    """
    return [
        "ssh",
        "-fN",
        "-o", "BatchMode=yes",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "ExitOnForwardFailure=yes",
        "-L", f"127.0.0.1:{local_port}:{db_host}:{db_port}",
        ssh_host,
    ]


# --------------------------------------------------------------------------- #
# Thin IO wrappers — validated live in Step 10, never in the unit suite.
# --------------------------------------------------------------------------- #
def probe_handshake(local_port: int, *, timeout: float = 5.0) -> bool:
    """Open the forwarded local port, read the first bytes, and parse the greeting.

    Read-only: it never sends the client handshake reply, so the half-open probe
    leaves no session behind. Any socket error (refused, reset, timeout) means the
    forward is dead -> False. The parse decision itself is the pure `parse_handshake`.
    """
    try:
        with socket.create_connection(("127.0.0.1", local_port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            first = sock.recv(64)
        return parse_handshake(first)
    except OSError:
        return False


def ensure_tunnel(
    local_port: int,
    db_host: str,
    db_port: int,
    ssh_host: str,
    *,
    probe_timeout: float = 5.0,
) -> TunnelState:
    """Return a live tunnel, launching one only if the port is not already serving.

    If the handshake already probes True the driver adopts the pre-existing
    forwarder WITHOUT taking ownership (`created_by_us=False`) — SCEN-008's
    operator-tunnel case. Otherwise it launches its own `ssh -fN -L`, records the
    PID, and waits for the handshake to come up. Lazy `subprocess`/`time` imports
    keep the module importable on bare Python.
    """
    import subprocess
    import time

    if probe_handshake(local_port, timeout=probe_timeout):
        return TunnelState(local_port=local_port, created_by_us=False, pid=None)

    argv = build_ssh_forward_argv(local_port, db_host, db_port, ssh_host)
    # `ssh -fN` forks to background; the parent we spawn exits immediately. We
    # cannot reliably learn the backgrounded child PID from -f, so launch WITHOUT
    # -f under our own process so the PID is ours to kill on teardown.
    argv = [a for a in argv if a != "-fN"]
    argv.insert(1, "-N")
    proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    state = TunnelState(local_port=local_port, created_by_us=True, pid=proc.pid)

    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        if probe_handshake(local_port, timeout=probe_timeout):
            return state
        if proc.poll() is not None:
            break
        time.sleep(1.0)
    # Could not bring the forward up — clean up our own process and signal failure.
    teardown(state)
    raise RuntimeError("ssh tunnel did not come up within deadline")


def relaunch_if_dead(
    state: TunnelState,
    db_host: str,
    db_port: int,
    ssh_host: str,
    *,
    probe_timeout: float = 5.0,
) -> TunnelState:
    """Probe; if dead, tear down our own forwarder (if any) and launch a fresh one.

    A pre-existing operator tunnel that dies is NOT relaunched under our ownership
    silently — we re-run `ensure_tunnel`, which will adopt a still-live operator
    tunnel or launch our own if the port is now free.
    """
    if probe_handshake(state.local_port, timeout=probe_timeout):
        return state
    if should_teardown(state):
        teardown(state)
    return ensure_tunnel(
        state.local_port, db_host, db_port, ssh_host, probe_timeout=probe_timeout
    )


def teardown(state: TunnelState) -> bool:
    """Kill the forwarder ONLY if this driver created and tracked it. Returns acted.

    Keyed on `should_teardown(state)`: a pre-existing operator tunnel
    (`created_by_us=False`) is left running. Lazy `os`/`signal` imports. A missing
    process (already gone) is treated as success.
    """
    if not should_teardown(state):
        return False
    import os
    import signal

    try:
        os.kill(state.pid, signal.SIGTERM)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return True
