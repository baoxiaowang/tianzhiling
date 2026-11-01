FROM python:3.11-slim

# 国内 pypi 镜像（腾讯云内网镜像，服务器上实测最快）
ARG PIP_INDEX_URL=http://mirrors.tencentyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.tencentyun.com

ENV PYTHONUNBUFFERED=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}

RUN pip install --no-cache-dir dlib-bin numpy pillow \
 && pip install --no-cache-dir --no-deps face_recognition face-recognition-models

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8899
CMD ["python3", "/app/server.py"]
