"""
Quick smoke test for AegisSwarm gRPC server.
Tests:
1. ExecuteTacticalCommand (Unary RPC)
2. StreamSwarmTelemetry (Server-Streaming RPC)
"""
import sys
import time
from pathlib import Path
import grpc

# Add grpc_server to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent / "grpc_server"))

import defense_pb2
import defense_pb2_grpc

def run_test():
    channel = grpc.insecure_channel("localhost:50051")
    stub = defense_pb2_grpc.DroneDefenseServiceStub(channel)

    print("[*] Testing Unary RPC: ExecuteTacticalCommand...")
    t0 = time.perf_counter()
    resp = stub.ExecuteTacticalCommand(
        defense_pb2.TacticalCommandRequest(
            command_id="TEST-001",
            action="DEFENSIVE_ORBIT",
            target_id="TEST-BOGEY"
        )
    )
    rtt_ms = (time.perf_counter() - t0) * 1000.0
    print(f"[+] Unary Response: success={resp.success}, msg='{resp.message}', server_latency={resp.latency_ms:.3f}ms, total_rtt={rtt_ms:.3f}ms")
    assert resp.success, "Unary RPC failed!"

    print("\n[*] Testing Server-Streaming RPC: StreamSwarmTelemetry (5 frames at 20 Hz)...")
    sub = defense_pb2.TelemetrySubscription(airspace_id="TEST-AIRSPACE", update_rate_hz=20)
    stream = stub.StreamSwarmTelemetry(sub)

    count = 0
    for frame in stream:
        count += 1
        pb_bytes = len(frame.SerializeToString())
        threat = frame.active_threat
        print(f"  Frame {count}: drones={len(frame.drones)}, threat={threat.threat_id} ({threat.threat_type}) dist={threat.distance_to_base_meters:.0f}m, payload_size={pb_bytes} bytes")
        if count >= 5:
            break

    print(f"[SUCCESS] Stream received {count} frames cleanly!")
    channel.close()

if __name__ == "__main__":
    run_test()
