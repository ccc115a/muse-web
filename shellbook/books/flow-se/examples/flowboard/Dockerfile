# 多階段建置：Rust 後端 + Node 前端 → 單一執行 image
# NOTE：第一次 build 要下載 rust/node  base image，會花幾分鐘；之後都用快取。
FROM rust:1-alpine AS backend
WORKDIR /build
COPY backend/ .
ENV CARGO_NET_OFFLINE=true
RUN cargo build --release

FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/ .
RUN npm run build

FROM alpine:3.20
WORKDIR /app
COPY --from=backend /build/target/release/flowboard .
COPY --from=frontend /build/dist ./dist
ENV PORT=3001 \
    FRONTEND_DIR=/app/dist \
    DATA_FILE=/app/data/tasks.json
EXPOSE 3001
CMD ["./flowboard"]
