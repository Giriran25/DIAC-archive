"""Start the DAIC ARCHIVE edge server on the LAN.

The tablet must reach the laptop by its LAN IP - never localhost - so the
host defaults to 0.0.0.0 and the reachable addresses are printed at startup.
"""

import socket

import uvicorn

from .app.core import config


def lan_addresses() -> list[str]:
    """Best-effort list of addresses the tablet could use."""
    found = []
    try:
        # Opening a UDP socket to a public IP reveals the preferred outbound
        # interface without sending anything.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in found and not ip.startswith("127."):
                found.append(ip)
    except OSError:
        pass
    return found


def main() -> None:
    print(f"\n  {config.ARCHIVE_NAME} - edge server")
    print(f"  archive db : {config.DB_PATH}")
    print(f"  local      : http://127.0.0.1:{config.PORT}/api/health")
    for ip in lan_addresses():
        print(f"  tablet     : http://{ip}:{config.PORT}/api/health")
    print()
    uvicorn.run("backend.app.main:app", host=config.HOST, port=config.PORT, log_level="info")


if __name__ == "__main__":
    main()
