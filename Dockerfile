# AegisSwarm AI - Tactical Drone Defense Unified Production Container
# Optimized for Cloud Deployment on Render, Railway, or VPS (Port 8000)

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    GRPC_SERVER_ADDR="localhost:50051" \
    PORT=8000

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy application files
COPY proto/ /app/proto/
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

# Compile Protocol Buffers
RUN python /app/backend/grpc_server/compile_proto.py

# Create entrypoint script to launch both gRPC server and Gateway
RUN echo '#!/bin/bash\n\
echo "=== Starting AegisSwarm AI Core Services ==="\n\
echo "[1/2] Launching gRPC Server on port 50051..."\n\
python /app/backend/grpc_server/server.py &\n\
GRPC_PID=$!\n\
\n\
# Wait for gRPC server to initialize\n\
sleep 2\n\
\n\
echo "[2/2] Launching Tactical FastAPI Gateway on port ${PORT:-8000}..."\n\
uvicorn gateway:app --app-dir /app/backend/gateway --host 0.0.0.0 --port ${PORT:-8000} &\n\
GATEWAY_PID=$!\n\
\n\
# Trap termination signals\n\
trap "kill -TERM $GRPC_PID $GATEWAY_PID" SIGINT SIGTERM\n\
\n\
wait -n $GRPC_PID $GATEWAY_PID\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000 50051

CMD ["/app/entrypoint.sh"]
