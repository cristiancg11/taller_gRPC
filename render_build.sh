#!/usr/bin/env bash
# Instalar dependencias y compilar frontend
cd frontend
npm install
npm run build
cd ..

# Instalar dependencias de Python y compilar protos
pip install -r backend/requirements.txt
python -m grpc_tools.protoc -Iproto --python_out=backend/grpc_server --grpc_python_out=backend/grpc_server proto/defense.proto
python -m grpc_tools.protoc -Iproto --python_out=backend/gateway --grpc_python_out=backend/gateway proto/defense.proto
python backend/grpc_server/compile_proto.py
