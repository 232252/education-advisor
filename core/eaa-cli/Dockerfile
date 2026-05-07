FROM rust:1.75-slim AS builder
WORKDIR /app
COPY core/eaa-cli/ ./core/eaa-cli/
WORKDIR /app/core/eaa-cli
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/core/eaa-cli/target/release/eaa /usr/local/bin/eaa
COPY core/eaa-cli/schema/ /app/schema/
RUN mkdir -p /app/data/entities /app/data/events /app/data/logs
ENV EAA_DATA_DIR=/app/data
WORKDIR /app
ENTRYPOINT ["eaa"]
CMD ["info"]
