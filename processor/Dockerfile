FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# El ÚNICO comando de arranque del worker. railway.json no lo repite (y ya no
# hay Procfile): así arranca igual en Railway —lea o no railway.json— y con
# un `docker run` local. Los patrones de watch viven en railway.json.
CMD ["python", "worker.py"]
