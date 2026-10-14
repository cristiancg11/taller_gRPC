"""
AegisSwarm AI - Tactical API Gateway & Web Intermediary
Bridges Web Clients (WebSockets / HTTP) to the High-Performance gRPC Air Defense Core.
Uses grpc.aio for non-blocking asynchronous streaming and unary RPC calls.
Serves frontend/dist production build with SPA catch-all routing.
Automatically boots the gRPC server in the background if not already running.
"""
import os
import sys
import json
import time
import asyncio
import subprocess
from typing import Optional
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import grpc
from google.protobuf.json_format import MessageToDict

# Support local or package-relative imports of protobuf stubs
try:
    from . import defense_pb2
    from . import defense_pb2_grpc
except (ImportError, ValueError):
    # Fallback to direct import if running directly
    sys.path.append(str(Path(__file__).resolve().parent))
    import defense_pb2
    import defense_pb2_grpc

GRPC_SERVER_ADDR = os.getenv("GRPC_SERVER_ADDR", "localhost:50051")
grpc_server_proc: Optional[subprocess.Popen] = None


async def get_grpc_channel():
    """Create an asynchronous gRPC channel."""
    return grpc.aio.insecure_channel(GRPC_SERVER_ADDR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI Lifespan: Automatically boots the gRPC server in the background
    if no server is detected on the configured address/port.
    """
    global grpc_server_proc

    # 1. Probe if gRPC core is already running
    server_alive = False
    try:
        channel = await get_grpc_channel()
        stub = defense_pb2_grpc.DroneDefenseServiceStub(channel)
        await asyncio.wait_for(
            stub.ExecuteTacticalCommand(
                defense_pb2.TacticalCommandRequest(
                    command_id="PROBE", action="DEFENSIVE_ORBIT", target_id="SYSTEM"
                )
            ),
            timeout=1.0
        )
        await channel.close()
        server_alive = True
        print(f"[Gateway Lifecycle] Existing gRPC core detected on {GRPC_SERVER_ADDR}.")
    except Exception:
        server_alive = False

    # 2. If not running, launch gRPC server in background
    if not server_alive:
        server_script = Path(__file__).resolve().parent.parent / "grpc_server" / "server.py"
        print(f"[Gateway Lifecycle] Starting gRPC core in background on port 50051 ({server_script})...")
        grpc_server_proc = subprocess.Popen([sys.executable, str(server_script)])
        print(f"[Gateway Lifecycle] gRPC server running in background (PID: {grpc_server_proc.pid})")
        # Allow socket initialization
        await asyncio.sleep(1.5)

    yield

    # 3. Clean up background process on shutdown
    if grpc_server_proc:
        print("[Gateway Lifecycle] Stopping background gRPC core process...")
        grpc_server_proc.terminate()
        try:
            grpc_server_proc.wait(timeout=2.0)
        except Exception:
            grpc_server_proc.kill()


app = FastAPI(
    title="AegisSwarm Tactical Defense Gateway",
    description="FastAPI Web Gateway bridging HTTP/2 gRPC to Browser WebSockets",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TacticalCommandPayload(BaseModel):
    action: str  # "ENGAGE", "DEFENSIVE_ORBIT", "ABORT", "SEARCH_PERIMETER", "SPAWN_THREAT"
    command_id: Optional[str] = None
    target_id: Optional[str] = None


class ThreatSpawnPayload(BaseModel):
    threat_type: Optional[str] = "HYPERSONIC_MISSILE"
    x: Optional[float] = 38000.0
    y: Optional[float] = 32000.0
    z: Optional[float] = 11000.0


@app.get("/api/health")
async def health_check():
    """Health check verifying gateway status and gRPC server connectivity."""
    grpc_reachable = False
    try:
        channel = await get_grpc_channel()
        stub = defense_pb2_grpc.DroneDefenseServiceStub(channel)
        resp = await asyncio.wait_for(
            stub.ExecuteTacticalCommand(
                defense_pb2.TacticalCommandRequest(
                    command_id="HEALTH-CHECK",
                    action="DEFENSIVE_ORBIT",
                    target_id="STATUS"
                )
            ),
            timeout=1.5
        )
        grpc_reachable = resp.success
        await channel.close()
    except Exception:
        grpc_reachable = False

    return {
        "status": "OPERATIONAL",
        "gateway_timestamp": int(time.time() * 1000),
        "grpc_server_target": GRPC_SERVER_ADDR,
        "grpc_core_connected": grpc_reachable
    }


@app.post("/api/tactical-command")
async def execute_tactical_command(payload: TacticalCommandPayload):
    """Translates HTTP REST command into a low-latency gRPC Unary RPC call."""
    t_start = time.perf_counter()
    cmd_id = payload.command_id or f"CMD-{int(time.time()*1000)}"
    
    channel = await get_grpc_channel()
    try:
        stub = defense_pb2_grpc.DroneDefenseServiceStub(channel)
        req = defense_pb2.TacticalCommandRequest(
            command_id=cmd_id,
            action=payload.action.upper(),
            target_id=payload.target_id or "PRIMARY_BOGEY"
        )
        
        rpc_response = await asyncio.wait_for(
            stub.ExecuteTacticalCommand(req),
            timeout=3.0
        )
        
        total_gateway_latency_ms = (time.perf_counter() - t_start) * 1000.0

        return {
            "success": rpc_response.success,
            "message": rpc_response.message,
            "grpc_latency_ms": round(rpc_response.latency_ms, 3),
            "gateway_total_latency_ms": round(total_gateway_latency_ms, 3),
            "command_id": cmd_id,
            "action": payload.action
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="gRPC core response timed out")
    except grpc.RpcError as rpc_err:
        raise HTTPException(status_code=502, detail=f"gRPC core error: {rpc_err.details()}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal gateway error: {str(e)}")
    finally:
        await channel.close()


@app.post("/api/threat/spawn")
async def spawn_threat(payload: ThreatSpawnPayload):
    """Convenience endpoint to trigger a new hostile threat via gRPC Unary RPC."""
    cmd_payload = TacticalCommandPayload(
        action="SPAWN_THREAT",
        command_id=f"SPAWN-{int(time.time())}",
        target_id=payload.threat_type
    )
    return await execute_tactical_command(cmd_payload)


@app.websocket("/ws/telemetry")
async def ws_telemetry(websocket: WebSocket, rate_hz: int = 20):
    """WebSocket endpoint streaming real-time swarm telemetry from gRPC Server-Streaming RPC."""
    await websocket.accept()
    current_hz = max(5, min(60, rate_hz))
    airspace_id = "AEGIS-SECTOR-ALPHA"

    channel = None
    stream_task = None
    stop_event = asyncio.Event()

    async def run_grpc_stream(hz: int):
        nonlocal channel
        while not stop_event.is_set():
            try:
                channel = await get_grpc_channel()
                stub = defense_pb2_grpc.DroneDefenseServiceStub(channel)
                req = defense_pb2.TelemetrySubscription(
                    airspace_id=airspace_id,
                    update_rate_hz=hz
                )

                stream = stub.StreamSwarmTelemetry(req)

                async for status_pb in stream:
                    if stop_event.is_set():
                        break

                    serialized_pb = status_pb.SerializeToString()
                    protobuf_bytes = len(serialized_pb)

                    data = MessageToDict(
                        status_pb,
                        preserving_proto_field_name=True,
                        always_print_fields_with_no_presence=True
                    )

                    json_bytes = len(json.dumps(data).encode("utf-8"))
                    saving_pct = round((1.0 - (protobuf_bytes / max(1, json_bytes))) * 100, 1)

                    web_payload = {
                        "type": "TELEMETRY_FRAME",
                        "data": data,
                        "metrics": {
                            "protobuf_bytes": protobuf_bytes,
                            "json_equivalent_bytes": json_bytes,
                            "bandwidth_saving_pct": saving_pct,
                            "stream_hz": hz,
                            "timestamp": time.time()
                        }
                    }

                    await websocket.send_text(json.dumps(web_payload))

            except asyncio.CancelledError:
                break
            except grpc.RpcError as rpc_err:
                await websocket.send_text(json.dumps({
                    "type": "STATUS_MESSAGE",
                    "level": "WARN",
                    "message": f"gRPC stream interrupted. Reconnecting: {rpc_err.code()}"
                }))
                await asyncio.sleep(2.0)
            except Exception as e:
                print(f"[Gateway WS] Stream error: {e}")
                await asyncio.sleep(2.0)
            finally:
                if channel:
                    await channel.close()

    stream_task = asyncio.create_task(run_grpc_stream(current_hz))

    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                if msg.get("action") == "SET_RATE":
                    new_hz = max(5, min(60, int(msg.get("rate_hz", 20))))
                    if new_hz != current_hz:
                        current_hz = new_hz
                        if stream_task:
                            stream_task.cancel()
                        stream_task = asyncio.create_task(run_grpc_stream(current_hz))
            except Exception:
                pass
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        stop_event.set()
        if stream_task:
            stream_task.cancel()
        if channel:
            await channel.close()


# Static files and Catch-all SPA routing
frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
dist_path = frontend_dir / "dist"
assets_path = dist_path / "assets"

# 1. Mount assets folder if present
if assets_path.exists():
    app.mount("/assets", StaticFiles(directory=str(assets_path)), name="dist_assets")

# 2. Mount dist folder if present
if dist_path.exists():
    app.mount("/dist", StaticFiles(directory=str(dist_path)), name="dist_static")

# 3. Catch-all route serving frontend/dist/index.html
@app.get("/{full_path:path}")
async def serve_spa_catch_all(full_path: str):
    """
    Catch-all route that serves static assets from frontend/dist if found,
    or returns frontend/dist/index.html for SPA client-side routing.
    """
    # Check if a specific file exists in dist (e.g. favicon.svg, icons.svg)
    candidate_file = dist_path / full_path
    if full_path and candidate_file.is_file():
        return FileResponse(str(candidate_file))

    # Return production built index.html from dist
    dist_index = dist_path / "index.html"
    if dist_index.exists():
        return FileResponse(str(dist_index))

    # Fallback to root frontend/index.html if dist is not compiled
    fallback_index = frontend_dir / "index.html"
    if fallback_index.exists():
        return FileResponse(str(fallback_index))

    raise HTTPException(status_code=404, detail="frontend/dist/index.html not found. Run npm run build first.")
