"""
Kinematic Simulation Engine for AegisSwarm Tactical Drone Air Defense.
Coordinates 6 interceptor drones and incoming hostile threats in 3D Cartesian airspace.
"""
import math
import time
import uuid
import threading
from typing import Dict, List, Optional

# Constants
MACH_1_MS = 343.0  # Speed of sound at sea level in m/s
BASE_POSITION = (0.0, 0.0, 0.0)
DEFENSE_PERIMETER_RADIUS = 15000.0  # 15 km defensive ring
KILL_RADIUS_METERS = 200.0  # Proximity fuse for kinetic kill

class Drone:
    def __init__(self, drone_id: str, angle_rad: float, radius: float = 12000.0, altitude: float = 3000.0):
        self.drone_id = drone_id
        self.angle = angle_rad
        self.orbit_radius = radius
        self.x = radius * math.cos(angle_rad)
        self.y = radius * math.sin(angle_rad)
        self.z = altitude
        self.velocity_mach = 0.95
        self.battery_pct = 95
        self.status = "DEFENSIVE_ORBIT"  # "SEARCHING", "LOCKED", "INTERCEPTING", "RETURNING"
        self.target_override: Optional[tuple] = None
        self._last_battery_drain = time.time()

    def update(self, dt: float, tactic: str, threat: Optional['Threat']):
        now = time.time()
        # Battery drain simulation
        if now - self._last_battery_drain > 15.0:
            drain = 2 if self.status == "INTERCEPTING" else 1
            self.battery_pct = max(10, self.battery_pct - drain)
            self._last_battery_drain = now

        if tactic == "ENGAGE" and threat and not threat.is_neutralized:
            self.status = "INTERCEPTING"
            self.velocity_mach = 2.5  # High-speed interception sprint
            # Tactical boost multiplier for interactive demonstration
            speed_ms = self.velocity_mach * MACH_1_MS * 6.0

            # Vector to threat
            dx = threat.x - self.x
            dy = threat.y - self.y
            dz = threat.z - self.z
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)

            if dist > 600.0:
                step_dist = speed_ms * dt
                if step_dist >= dist:
                    self.x = threat.x
                    self.y = threat.y
                    self.z = threat.z
                else:
                    self.x += (dx / dist) * step_dist
                    self.y += (dy / dist) * step_dist
                    self.z += (dz / dist) * step_dist
            else:
                # Intercept reached!
                threat.is_neutralized = True
                self.status = "RETURNING"
                self.velocity_mach = 1.1

        elif tactic == "SEARCH_PERIMETER":
            self.status = "SEARCHING"
            self.velocity_mach = 1.4
            self.angle += (self.velocity_mach * MACH_1_MS / 22000.0) * dt
            target_radius = 22000.0
            self.orbit_radius += (target_radius - self.orbit_radius) * 0.1 * dt
            self.x = self.orbit_radius * math.cos(self.angle)
            self.y = self.orbit_radius * math.sin(self.angle)
            self.z = 4500.0

        elif tactic == "ABORT" or (threat and threat.is_neutralized and self.status == "RETURNING"):
            # Return towards standard orbit perimeter
            self.status = "RETURNING"
            self.velocity_mach = 1.2
            speed_ms = self.velocity_mach * MACH_1_MS
            target_x = 12000.0 * math.cos(self.angle)
            target_y = 12000.0 * math.sin(self.angle)
            target_z = 3000.0

            dx = target_x - self.x
            dy = target_y - self.y
            dz = target_z - self.z
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)

            if dist < 500.0:
                self.status = "DEFENSIVE_ORBIT"
            else:
                step_dist = min(dist, speed_ms * dt)
                self.x += (dx / dist) * step_dist
                self.y += (dy / dist) * step_dist
                self.z += (dz / dist) * step_dist
        else:
            # Default: DEFENSIVE_ORBIT
            self.status = "LOCKED" if (threat and not threat.is_neutralized) else "DEFENSIVE_ORBIT"
            self.velocity_mach = 0.95
            self.orbit_radius = 12000.0
            self.angle += (self.velocity_mach * MACH_1_MS / self.orbit_radius) * dt
            self.x = self.orbit_radius * math.cos(self.angle)
            self.y = self.orbit_radius * math.sin(self.angle)
            self.z = 3000.0 + 300.0 * math.sin(self.angle * 2)


class Threat:
    def __init__(self, threat_id: str, threat_type: str = "HYPERSONIC_MISSILE",
                 start_x: float = 38000.0, start_y: float = 32000.0, start_z: float = 11000.0):
        self.threat_id = threat_id
        self.threat_type = threat_type
        self.x = start_x
        self.y = start_y
        self.z = start_z
        self.is_neutralized = False
        
        # Hypersonic threat moves at Mach 4.5 towards Base (0, 0, 0)
        # Enemy drone moves at Mach 1.8
        self.speed_mach = 4.5 if threat_type == "HYPERSONIC_MISSILE" else 1.8
        self.speed_ms = self.speed_mach * MACH_1_MS

    @property
    def distance_to_base(self) -> float:
        return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)

    def update(self, dt: float):
        if self.is_neutralized:
            # Remains neutralized or slowly descends
            self.z = max(0.0, self.z - 250.0 * dt)
            return

        dist = self.distance_to_base
        if dist > 500.0:
            step = self.speed_ms * dt
            # Move towards (0, 0, 0)
            self.x -= (self.x / dist) * step
            self.y -= (self.y / dist) * step
            self.z -= (self.z / dist) * step
        else:
            # Terminal impact threshold if not intercepted
            self.x = 0.0
            self.y = 0.0
            self.z = 0.0


class AirspaceSimulation:
    def __init__(self):
        self.lock = threading.Lock()
        self.active_tactic = "DEFENSIVE_ORBIT"
        self.drones: List[Drone] = []
        self.threat: Threat = None
        self._init_swarm()
        self.spawn_threat("HYPERSONIC_MISSILE", 38000.0, 32000.0, 11000.0)
        self.last_update_time = time.time()

    def _init_swarm(self):
        self.drones = []
        callsigns = [
            "AEGIS-ALPHA-1",
            "AEGIS-ALPHA-2",
            "AEGIS-BRAVO-1",
            "AEGIS-BRAVO-2",
            "AEGIS-CHARLIE-1",
            "AEGIS-CHARLIE-2"
        ]
        num_drones = len(callsigns)
        for i, callsign in enumerate(callsigns):
            angle = (2.0 * math.pi / num_drones) * i
            drone = Drone(drone_id=callsign, angle_rad=angle)
            self.drones.append(drone)

    def spawn_threat(self, threat_type: str = "HYPERSONIC_MISSILE",
                     x: float = 38000.0, y: float = 32000.0, z: float = 11000.0) -> str:
        with self.lock:
            threat_id = f"THREAT-BOGEY-{str(uuid.uuid4())[:6].upper()}"
            self.threat = Threat(threat_id=threat_id, threat_type=threat_type, start_x=x, start_y=y, start_z=z)
            return threat_id

    def set_tactic(self, action: str) -> bool:
        with self.lock:
            valid_actions = ["ENGAGE", "DEFENSIVE_ORBIT", "ABORT", "SEARCH_PERIMETER"]
            if action in valid_actions:
                self.active_tactic = action
                return True
            return False

    def update_physics(self):
        with self.lock:
            now = time.time()
            dt = now - self.last_update_time
            self.last_update_time = now

            # Clamp dt to prevent teleportation in lag spikes
            dt = max(0.001, min(dt, 0.2))

            # Update threat
            if self.threat:
                self.threat.update(dt)

            # Update drones
            for drone in self.drones:
                drone.update(dt, self.active_tactic, self.threat)

    def calculate_readiness_pct(self) -> int:
        if not self.drones:
            return 0
        total_battery = sum(d.battery_pct for d in self.drones)
        avg_battery = total_battery / len(self.drones)
        active_count = sum(1 for d in self.drones if d.battery_pct > 20)
        readiness = int((active_count / len(self.drones)) * 0.5 * 100 + (avg_battery / 100.0) * 0.5 * 100)
        return min(100, max(0, readiness))

    def get_snapshot(self) -> dict:
        with self.lock:
            threat_data = None
            if self.threat:
                threat_data = {
                    "threat_id": self.threat.threat_id,
                    "threat_type": self.threat.threat_type,
                    "position": {"x": self.threat.x, "y": self.threat.y, "z": self.threat.z},
                    "distance_to_base_meters": self.threat.distance_to_base,
                    "is_neutralized": self.threat.is_neutralized
                }

            drones_data = []
            for d in self.drones:
                drones_data.append({
                    "drone_id": d.drone_id,
                    "position": {"x": d.x, "y": d.y, "z": d.z},
                    "velocity_mach": round(d.velocity_mach, 2),
                    "battery_percentage": d.battery_pct,
                    "status": d.status
                })

            return {
                "timestamp_epoch_ms": int(time.time() * 1000),
                "active_threat": threat_data,
                "drones": drones_data,
                "interception_readiness_pct": self.calculate_readiness_pct(),
                "active_tactic": self.active_tactic
            }

# Singleton instance for the gRPC server process
simulation_instance = AirspaceSimulation()
