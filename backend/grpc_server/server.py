"""
AegisSwarm AI - Tactical Drone Air Defense & Telemetry Control Center
High-Performance gRPC Server on port 50051.
Implements:
1. Server-Streaming RPC: StreamSwarmTelemetry (High frequency 10-60 Hz telemetry)
2. Unary RPC: ExecuteTacticalCommand (Ultra-low latency tactical execution < 5ms)
"""
import time
import signal
import sys
from concurrent import futures
import grpc

try:
    from . import defense_pb2
    from . import defense_pb2_grpc
    from .simulation import simulation_instance
except (ImportError, ValueError):
    import defense_pb2
    import defense_pb2_grpc
    from simulation import simulation_instance


class DroneDefenseServicer(defense_pb2_grpc.DroneDefenseServiceServicer):
    """
    gRPC Servicer handling streaming swarm telemetry and instant tactical orders.
    """
    def StreamSwarmTelemetry(self, request: defense_pb2.TelemetrySubscription, context):
        airspace_id = request.airspace_id or "SECTOR-DEFENSE-7"
        rate_hz = request.update_rate_hz
        if rate_hz < 1 or rate_hz > 60:
            rate_hz = 20  # Default to 20 Hz
        
        interval = 1.0 / rate_hz
        print(f"[gRPC-STREAM] Client subscribed to airspace '{airspace_id}' at {rate_hz} Hz (interval={interval*1000:.1f}ms)")

        packet_count = 0
        try:
            while context.is_active():
                loop_start = time.perf_counter()

                # Step the kinematics engine
                simulation_instance.update_physics()
                snap = simulation_instance.get_snapshot()

                # Build Protobuf Response
                swarm_status = defense_pb2.SwarmStatus()
                swarm_status.timestamp_epoch_ms = snap["timestamp_epoch_ms"]
                swarm_status.interception_readiness_pct = snap["interception_readiness_pct"]

                # Populate Threat Telemetry
                t_data = snap["active_threat"]
                if t_data:
                    swarm_status.active_threat.threat_id = t_data["threat_id"]
                    swarm_status.active_threat.threat_type = t_data["threat_type"]
                    swarm_status.active_threat.position.x = t_data["position"]["x"]
                    swarm_status.active_threat.position.y = t_data["position"]["y"]
                    swarm_status.active_threat.position.z = t_data["position"]["z"]
                    swarm_status.active_threat.distance_to_base_meters = t_data["distance_to_base_meters"]
                    swarm_status.active_threat.is_neutralized = t_data["is_neutralized"]

                # Populate Drone Fleet Telemetry
                for d_data in snap["drones"]:
                    drone_msg = swarm_status.drones.add()
                    drone_msg.drone_id = d_data["drone_id"]
                    drone_msg.position.x = d_data["position"]["x"]
                    drone_msg.position.y = d_data["position"]["y"]
                    drone_msg.position.z = d_data["position"]["z"]
                    drone_msg.velocity_mach = d_data["velocity_mach"]
                    drone_msg.battery_percentage = d_data["battery_percentage"]
                    drone_msg.status = d_data["status"]

                yield swarm_status
                packet_count += 1

                elapsed = time.perf_counter() - loop_start
                sleep_time = interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)

        except Exception as e:
            print(f"[gRPC-STREAM] Stream interrupted: {e}")
        finally:
            print(f"[gRPC-STREAM] Client disconnected from '{airspace_id}'. Total packets sent: {packet_count}")

    def ExecuteTacticalCommand(self, request: defense_pb2.TacticalCommandRequest, context):
        t0 = time.perf_counter()
        
        command_id = request.command_id or "CMD-AUTO"
        action = request.action.upper()
        target_id = request.target_id

        print(f"[gRPC-UNARY] Received Tactical Command [{command_id}]: ACTION='{action}', TARGET='{target_id}'")

        success = True
        message = ""

        if action in ["ENGAGE", "DEFENSIVE_ORBIT", "ABORT", "SEARCH_PERIMETER"]:
            simulation_instance.set_tactic(action)
            if action == "ENGAGE":
                message = f"TACTICAL AUTHORIZATION GRANTED: Interceptors convergent vector Mach 2.5 on target {target_id or 'PRIMARY_BOGEY'}."
            elif action == "DEFENSIVE_ORBIT":
                message = "TACTICAL DIRECTIVE: Swarm transitioned to standard 12km hex-perimeter defensive orbit."
            elif action == "SEARCH_PERIMETER":
                message = "TACTICAL DIRECTIVE: Swarm radius expanded to 22km outer sector scanning sweep."
            elif action == "ABORT":
                message = "MISSION ABORT: Swarm disengaged pursuit vector. Returning to defensive station."
        elif action == "SPAWN_THREAT":
            new_id = simulation_instance.spawn_threat(
                threat_type="HYPERSONIC_MISSILE",
                x=38000.0, y=32000.0, z=11000.0
            )
            message = f"RADAR WARNING: Hostile bogey acquired and tracked -> ID: {new_id}"
        else:
            success = False
            message = f"REJECTED: Unknown tactical directive '{action}'"

        latency_ms = (time.perf_counter() - t0) * 1000.0
        # In-memory execution typically takes 0.05 - 0.5 ms
        print(f"[gRPC-UNARY] Executed in {latency_ms:.3f} ms. Status={success}")

        return defense_pb2.TacticalCommandResponse(
            success=success,
            message=message,
            latency_ms=latency_ms
        )


def serve():
    port = "50051"
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    defense_pb2_grpc.add_DroneDefenseServiceServicer_to_server(DroneDefenseServicer(), server)
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    print(f"============================================================")
    print(f"  AegisSwarm AI - Tactical Drone Defense gRPC Server")
    print(f"  Transport: HTTP/2 Binary Protocol Buffers")
    print(f"  Listening on: [::]:{port}")
    print(f"============================================================")

    def handle_shutdown(signum, frame):
        print("\n[!] Received shutdown signal. Stopping gRPC server gracefully...")
        server.stop(grace=2.0)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    server.wait_for_termination()


if __name__ == "__main__":
    serve()
