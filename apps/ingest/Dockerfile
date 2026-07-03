FROM ghcr.io/astral-sh/uv:0.5.4-python3.12-bookworm-slim AS ingest

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV PATH="/app/apps/ingest/.venv/bin:$PATH"
ENV PYTHONPATH="/app/apps/ingest/src"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY apps/ingest/pyproject.toml apps/ingest/uv.lock apps/ingest/
COPY db db

WORKDIR /app/apps/ingest

RUN uv sync --frozen --no-dev

COPY apps/ingest/src src

ENTRYPOINT ["idx-ingest"]
CMD ["sources"]

FROM ingest AS scheduler

ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.34

RUN case "$TARGETARCH" in \
    amd64) supercronic_arch=amd64 ;; \
    arm64) supercronic_arch=arm64 ;; \
    *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && python -c "from urllib.request import urlretrieve; urlretrieve('https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${supercronic_arch}', '/usr/local/bin/supercronic')" \
  && chmod +x /usr/local/bin/supercronic \
  && supercronic -version

COPY apps/ingest/cron/ /etc/vibe-idx/

RUN chmod +x /etc/vibe-idx/run-daily.sh /etc/vibe-idx/run-monthly.sh

ENTRYPOINT ["supercronic"]
CMD ["/etc/vibe-idx/ingest.cron"]
