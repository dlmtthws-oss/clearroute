FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .

# -u = unbuffered so logs show up immediately in `docker logs`
CMD ["python", "-u", "worker.py"]
