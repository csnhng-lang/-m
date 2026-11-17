FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN adduser --disabled-password --gecos "" --uid 10001 bot

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=bot:bot . .
RUN mkdir -p /app/data && chown -R bot:bot /app/data

USER bot

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import sys, pathlib; sys.exit(0 if pathlib.Path('data/accounts.json').exists() else 1)"

CMD ["python", "bot.py"]
