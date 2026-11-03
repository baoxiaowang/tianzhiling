FROM python:3.11-slim

ARG PIP_INDEX_URL=http://mirrors.tencentyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.tencentyun.com

ENV PYTHONUNBUFFERED=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}

# 用腾讯云 Debian 镜像（服务器到 deb.debian.org 很慢，apt 会卡住）
RUN set -eux; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
      [ -f "$f" ] && sed -i 's|deb.debian.org|mirrors.tencentyun.com|g' "$f" || true; \
    done; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends ffmpeg; \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir sherpa-onnx numpy soundfile

WORKDIR /app
COPY server.py /app/server.py

ENV SEP_MODEL_PATH=/models/UVR-MDX-NET-Voc_FT.onnx \
    SEP_THREADS=2 \
    SEP_MAX_SECONDS=120

EXPOSE 8900
CMD ["python3", "/app/server.py"]
