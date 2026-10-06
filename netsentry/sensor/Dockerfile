# NetSentry monitor as a container — for NAS boxes and Docker-only hosts (Unraid, Synology, TrueNAS).
# docs/SYSTEM-V3-PLAN.md §6.2. On an ordinary Linux server, the install command (a systemd service) is better.
#
# It needs to see the machine it watches, so it is run with the host's network and processes, the
# host's /proc and /sys read-only, Docker's socket, and Docker's log folder read-only — see
# deploy/compose/monitor.yaml. Docker's socket is root-equivalent: the monitor never opens a port,
# and it only ever changes anything if NETSENTRY_EXECUTOR=on is set here, by you.
FROM python:3.12-alpine
RUN apk add --no-cache docker-cli docker-cli-compose iproute2 procps
COPY netsentry_sensor /opt/netsentry/sensor/netsentry_sensor
COPY pyproject.toml /opt/netsentry/sensor/
COPY docker-entrypoint.sh /usr/local/bin/netsentry-entrypoint
RUN chmod +x /usr/local/bin/netsentry-entrypoint
WORKDIR /opt/netsentry/sensor
ENV NETSENTRY_HOST_PROC=/host/proc \
    NETSENTRY_HOST_SYS=/host/sys \
    PYTHONUNBUFFERED=1
# The executor never stops, restarts or updates the container labelled as the monitor itself.
LABEL netsentry.role="monitor" \
      org.opencontainers.image.title="NetSentry monitor" \
      org.opencontainers.image.description="Watches and (only if you allow it) manages this machine for NetSentry" \
      org.opencontainers.image.source="https://github.com/CraftOS-dev/living-ui-marketplace"
VOLUME ["/state"]
ENTRYPOINT ["netsentry-entrypoint"]
