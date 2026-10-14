import asyncio
import json
import urllib.request
import websockets

def test_flow():
    # 1. Spawn a threat
    print("--- 1. SPAWN THREAT ---")
    req = urllib.request.Request(
        "http://localhost:8000/api/threat/spawn",
        data=json.dumps({"threat_type": "HYPERSONIC_MISSILE", "x": 18000.0, "y": 14000.0, "z": 4000.0}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    res = urllib.request.urlopen(req).read().decode("utf-8")
    print(res)

    # 2. Engage
    print("\n--- 2. EXECUTE UNARY ENGAGE ---")
    req2 = urllib.request.Request(
        "http://localhost:8000/api/tactical-command",
        data=json.dumps({"action": "ENGAGE"}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    res2 = urllib.request.urlopen(req2).read().decode("utf-8")
    print(res2)

    # 3. Stream telemetry frames
    print("\n--- 3. OBSERVING INTERCEPTION STREAM ---")
    async def monitor():
        async with websockets.connect("ws://localhost:8000/ws/telemetry?rate_hz=20") as ws:
            for i in range(180):
                raw = await ws.recv()
                msg = json.loads(raw)
                threat = msg["data"]["active_threat"]
                d1 = msg["data"]["drones"][0]
                dist = threat["distance_to_base_meters"]
                status = d1["status"]
                is_dead = threat["is_neutralized"]
                print(f"Frame {i+1:02d} | Threat Dist: {dist:07.1f}m | D1 Status: {status} (Mach {d1['velocity_mach']}) | Neutralized: {is_dead}")
                if is_dead:
                    print("\n>>> [SUCCESS] KINETIC KILL CONFIRMED! DRONES ENGAGED AND NEUTRALIZED TARGET! <<<")
                    break

    asyncio.run(monitor())

if __name__ == "__main__":
    test_flow()
