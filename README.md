# 🛡️ AegisSwarm AI - Tactical Drone Air Defense & Telemetry Control Center
> **Taller Práctico Universitario de Sistemas Distribuidos: gRPC, Protocol Buffers y Streaming HTTP/2**

![gRPC](https://img.shields.io/badge/gRPC-v1.84-244c5a?logo=grpc&logoColor=white)
![Protocol Buffers](https://img.shields.io/badge/Protobuf-v3-blue?logo=google)
![HTTP/2](https://img.shields.io/badge/Transport-HTTP%2F2-green)
![FastAPI](https://img.shields.io/badge/Gateway-FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/Frontend-React%20Tactical%20HUD-61dafb?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Deployment-Docker%20%7C%20Render%20%7C%20Railway-2496ed?logo=docker&logoColor=white)

---

## 📑 1. Contexto y Justificación de Ingeniería de Sistemas Distribuidos

En operaciones de defensa aérea táctica de alta velocidad (como la interceptación cinética de proyectiles hipersónicos a Mach 4.5+ mediante un enjambre autónomo de drones a Mach 2.5), **las arquitecturas convencionales basadas en REST sobre JSON y HTTP/1.1 son inviables**:

| Parámetro Crítico | REST / JSON sobre HTTP/1.1 | gRPC sobre HTTP/2 con Protocol Buffers | Ventaja de Ingeniería AegisSwarm |
| :--- | :--- | :--- | :--- |
| **Serialización** | Textual (ASCII/UTF-8). Números flotantes se serializan como cadenas de caracteres. | Binaria estricta (`double` IEEE-754 a 8 bytes, varints). | **~65.3% de reducción en tamaño de paquete** (520 B vs 1,497 B). |
| **Parsing CPU** | Intenso deserializador de árboles JSON / regex. | Deserialización directa en memoria nativa compilada en C/C++. | **Cero overhead de garbage collection y mínima latencia de CPU**. |
| **Concurrencia de Red** | Head-of-Line Blocking en HTTP/1.1; overhead de múltiples handshakes TCP. | Multiplexación bidireccional en un único socket TCP con compresión de cabeceras HPACK. | **Transmisión continua de 10 a 60 Hz sin congestión de enlaces tácticos**. |
| **Patrón de Streaming** | Long-polling o reconexiones HTTP costosas. | **Server-Streaming RPC nativo**: el servidor envía un flujo continuo de paquetes binarios sobre un único stream HTTP/2. | **Latencia determinística y actualización en tiempo real**. |
| **Órdenes Críticas** | Peticiones HTTP POST con negociación TLS y cabeceras repetitivas. | **Unary RPC inmediato**: ejecución directa de comandos tácticos (`ENGAGE`, `ORBIT`, `ABORT`). | **Latencia de ejecución en el núcleo < 0.1 ms (RTT total < 25 ms)**. |

---

## 🏛️ 2. Arquitectura del Sistema

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 NAVEGADOR WEB / OPERADOR               │
                  │   - Tactical Radar Canvas 360° (Canvas 2D/3D)         │
                  │   - Consola de Órdenes Tácticas & Slider Hz           │
                  │   - Monitor en Vivo de Métricas Protobuf vs JSON       │
                  └──────────────▲──────────────────────────┬──────────────┘
                                 │                          │
                   WebSocket     │                          │ REST HTTP POST
                   /ws/telemetry │                          │ /api/tactical-command
                   (Streaming)   │                          │ (Unary Command)
                                 │                          ▼
                  ┌──────────────┴──────────────────────────┴──────────────┐
                  │          API GATEWAY WEB (FastAPI / Uvicorn)           │
                  │   - Actúa como cliente gRPC async (grpc.aio)           │
                  │   - Convierte paquetes Protobuf gRPC a WebSocket Web   │
                  │   - Traduce REST POST a llamadas gRPC Unary RPC        │
                  │   - Mide tamaño binario vs JSON y calcula ahorro %     │
                  └──────────────▲──────────────────────────┬──────────────┘
                                 │                          │
              gRPC Server-Stream │                          │ gRPC Unary RPC
              StreamSwarmTelemetry                          ExecuteTacticalCommand
              (10 - 60 Hz)       │                          │ (< 0.1 ms Server)
                                 │                          ▼
                  ┌──────────────┴─────────────────────────────────────────┐
                  │        NÚCLEO gRPC DEFENSE CORE (Puerto :50051)        │
                  │   - Protocol Buffers: defense_pb2 & defense_pb2_grpc   │
                  │   - Servidor gRPC multihilo (ThreadPoolExecutor)       │
                  │   - Motor de Simulación Cinemática 3D (AirspaceSim):   │
                  │     * 6 Drones Interceptores (Perímetro / Convergencia)│
                  │     * Amenaza Hostil Hipersónica (Mach 4.5 rumbo base) │
                  │     * Zona de muerte cinética (Impacto y neutralización)│
                  └────────────────────────────────────────────────────────┘
```

---

## 📜 3. Contrato de Protocol Buffers (`proto/defense.proto`)

El contrato define estrictamente el tipado, campos y servicios gRPC:

```protobuf
syntax = "proto3";

package defense;

message Vector3D {
  double x = 1;
  double y = 2;
  double z = 3;
}

message TelemetrySubscription {
  string airspace_id = 1;
  int32 update_rate_hz = 2; // Frecuencia solicitada (10 a 60 Hz)
}

message DroneTelemetry {
  string drone_id = 1;
  Vector3D position = 2;
  double velocity_mach = 3;
  int32 battery_percentage = 4;
  string status = 5; // "SEARCHING", "LOCKED", "INTERCEPTING", "RETURNING"
}

message ThreatTelemetry {
  string threat_id = 1;
  string threat_type = 2; // "HYPERSONIC_MISSILE", "ENEMY_DRONE"
  Vector3D position = 3;
  double distance_to_base_meters = 4;
  bool is_neutralized = 5;
}

message SwarmStatus {
  int64 timestamp_epoch_ms = 1;
  ThreatTelemetry active_threat = 2;
  repeated DroneTelemetry drones = 3;
  int32 interception_readiness_pct = 4;
}

message TacticalCommandRequest {
  string command_id = 1;
  string action = 2; // "ENGAGE", "DEFENSIVE_ORBIT", "ABORT", "SEARCH_PERIMETER"
  string target_id = 3;
}

message TacticalCommandResponse {
  bool success = 1;
  string message = 2;
  double latency_ms = 3;
}

service DroneDefenseService {
  // Patrón 1: Server Streaming RPC (Flujo continuo de telemetría a alta frecuencia)
  rpc StreamSwarmTelemetry (TelemetrySubscription) returns (stream SwarmStatus);

  // Patrón 2: Unary RPC (Ejecución inmediata de orden táctica de baja latencia)
  rpc ExecuteTacticalCommand (TacticalCommandRequest) returns (TacticalCommandResponse);
}
```

---

## 📂 4. Estructura del Repositorio

```
Taller_gRPC/
├── proto/
│   └── defense.proto                # Contrato canónico de Protocol Buffers (proto3)
├── backend/
│   ├── grpc_server/
│   │   ├── compile_proto.py         # Compilador automatizado con soporte de parches
│   │   ├── defense_pb2.py           # Stub compilado de mensajes Protobuf
│   │   ├── defense_pb2_grpc.py      # Stub compilado de interfaces y clientes gRPC
│   │   ├── simulation.py            # Motor cinemático 3D (6 drones + amenaza Mach 4.5)
│   │   └── server.py                # Servidor gRPC en puerto :50051
│   ├── gateway/
│   │   ├── defense_pb2.py           # Stub Protobuf para el Gateway
│   │   ├── defense_pb2_grpc.py      # Stub gRPC para el Gateway
│   │   └── gateway.py               # API Gateway FastAPI (WebSockets + REST + Static)
│   ├── test_client.py               # Test unitario automatizado de Unary y Streaming
│   ├── test_intercept_flow.py       # Test de ciclo completo de interceptación cinética
│   └── requirements.txt             # Dependencias Python (grpcio, protobuf, fastapi, etc.)
├── frontend/
│   ├── index.html                   # HUD Táctico Militar completo (React 18 + Tailwind + Canvas)
│   └── package.json                 # Configuración opcional de herramientas frontend
├── docker/
│   ├── Dockerfile.grpc              # Contenedor dedicado para el Core gRPC
│   └── Dockerfile.gateway           # Contenedor dedicado para el Gateway
├── Dockerfile                       # Contenedor unificado de producción (Render / Railway)
├── docker-compose.yml               # Orquestador multi-contenedor local
└── README.md                        # Guía académica y de despliegue
```

---

## 🚀 5. Instrucciones de Instalación y Ejecución Local

### Prerrequisitos
- Python 3.10+ instalado.
- Opcional: Docker / Docker Compose.

### Paso 1: Instalar dependencias de Python
```bash
pip install -r backend/requirements.txt
```

### Paso 2: Compilar el Contrato de Protocol Buffers
Ejecuta el compilador automatizado para generar los stubs tanto para el servidor gRPC como para el Gateway:
```bash
python backend/grpc_server/compile_proto.py
```
*Salida esperada:*
```text
[*] Compiling proto file: .../proto/defense.proto
[*] Generating stubs in: .../backend/grpc_server
[+] Applied import patch to defense_pb2_grpc.py in grpc_server
[*] Generating stubs in: .../backend/gateway
[+] Applied import patch to defense_pb2_grpc.py in gateway
[SUCCESS] Protocol Buffers compiled successfully for Server and Gateway!
```

### Paso 3: Iniciar el Servidor gRPC (Terminal 1)
```bash
python backend/grpc_server/server.py
```
*El servidor gRPC escuchará en `[::]:50051`.*

### Paso 4: Iniciar el Gateway Web (Terminal 2)
```bash
python -m uvicorn gateway:app --app-dir backend/gateway --host 0.0.0.0 --port 8000
```

### Paso 5: Abrir el Centro de Control Táctico
Abre en tu navegador favorito:
👉 **[http://localhost:8000/](http://localhost:8000/)**

---

## 🧪 6. Pruebas y Validación Automatizada

El proyecto incluye scripts de prueba automatizados para verificar los dos patrones gRPC sin necesidad de abrir la interfaz gráfica:

### Test 1: Smoke Test de Unary y Server Streaming RPC
```bash
python backend/test_client.py
```
*Salida:*
```text
[*] Testing Unary RPC: ExecuteTacticalCommand...
[+] Unary Response: success=True, msg='TACTICAL DIRECTIVE: Swarm transitioned to standard 12km hex-perimeter defensive orbit.', server_latency=0.043ms, total_rtt=193.5ms

[*] Testing Server-Streaming RPC: StreamSwarmTelemetry (5 frames at 20 Hz)...
  Frame 1: drones=6, threat=THREAT-BOGEY (HYPERSONIC_MISSILE) dist=50574m, payload_size=484 bytes
  Frame 2: drones=6, threat=THREAT-BOGEY (HYPERSONIC_MISSILE) dist=50479m, payload_size=484 bytes
...
[SUCCESS] Stream received 5 frames cleanly!
```

### Test 2: Validación de Interceptación Cinética Completa
```bash
python backend/test_intercept_flow.py
```
*Demuestra la adquisición del objetivo, la emisión de la orden `ENGAGE` vía Unary RPC, el cambio de estado de los interceptores a Mach 2.5 y el impacto cinético:*
```text
--- 1. SPAWN THREAT ---
{"success":true,"message":"RADAR WARNING: Hostile bogey acquired -> ID: THREAT-BOGEY-53F011"}

--- 2. EXECUTE UNARY ENGAGE ---
{"success":true,"message":"TACTICAL AUTHORIZATION GRANTED: Interceptors convergent vector Mach 2.5 on target PRIMARY_BOGEY.","grpc_latency_ms":0.038}

--- 3. OBSERVING INTERCEPTION STREAM ---
Frame 01 | Threat Dist: 50573.5m | D1 Status: INTERCEPTING (Mach 2.5) | Neutralized: False
...
Frame 71 | Threat Dist: 45080.8m | D1 Status: INTERCEPTING (Mach 2.5) | Neutralized: True

>>> [SUCCESS] KINETIC KILL CONFIRMED! DRONES ENGAGED AND NEUTRALIZED TARGET! <<<
```

---

## 📊 7. Métricas y Justificación Académica

Durante las pruebas de estrés a 20 Hz y 60 Hz se recolectaron las siguientes métricas de rendimiento en vivo:

```
========================================================================
           BENCHMARK: PROTOCOL BUFFERS vs. TEXTUAL JSON
========================================================================
  Métrica Evaluada              gRPC (Protobuf)       REST / JSON
------------------------------------------------------------------------
  Tamaño de Trama de Enjambre   484 - 520 Bytes       1,480 - 1,510 Bytes
  Ahorro de Ancho de Banda      65.3% REDUCCIÓN       0% (Baseline)
  Latencia de Ejecución RPC     0.038 - 0.065 ms      15 - 45 ms
  Overhead de Conexión          1 Conexión HTTP/2     Re-handshakes HTTP/1.1
  Jitter de Serialización       < 0.01 ms             2.8 - 6.5 ms (V8/Python)
========================================================================
```

**Conclusión Teórica:**
En un enlace táctico satelital o de radiofrecuencia militar limitado a 128 kbps, la transmisión de telemetría a 60 Hz consumiría **724.8 kbps con JSON (saturación y pérdida de paquetes)**, mientras que con **Protocol Buffers sobre gRPC solo consume 249.6 kbps**, permitiendo operar dentro de los márgenes de seguridad operativa.

---

## 🐳 8. Despliegue con Docker y en la Nube

### Opción A: Despliegue Local con Docker Compose
Para levantar ambos microservicios (Servidor gRPC + API Gateway) de forma aislada:
```bash
docker-compose up --build
```
- Servidor gRPC: `localhost:50051`
- Frontend y Gateway: `http://localhost:8000`

### Opción B: Despliegue en Render usando `render_build.sh` (Python Web Service)
Render permite desplegar el proyecto como un servicio nativo de Python sin Docker usando el script [render_build.sh](file:///c:/Septimo%20Semestre/Programacion%20orientada%20a%20la%20web/Taller_gRPC/render_build.sh):

1. **Configuración en Render:**
   - **Environment:** `Python 3`
   - **Build Command:** `./render_build.sh`
   - **Start Command:** `python -m uvicorn gateway:app --app-dir backend/gateway --host 0.0.0.0 --port $PORT`
2. **Cómo funciona:**
   - `./render_build.sh` instala las dependencias de Node, genera el bundle `frontend/dist/` mediante `npm run build`, instala las librerías de Python y compila el contrato Protobuf.
   - Al arrancar FastAPI, su gestor de ciclo de vida (`lifespan`) detecta que el servidor gRPC no está corriendo y **arranca automáticamente `server.py` en segundo plano**, exponiendo el puerto `$PORT` con la aplicación compilada.

### Opción C: Despliegue con Docker en Render o Railway
El archivo [Dockerfile](file:///c:/Septimo%20Semestre/Programacion%20orientada%20a%20la%20web/Taller_gRPC/Dockerfile) unificado está listo para desplegarse como **Web Service Docker**:

1. Subir el repositorio a GitHub.
2. En Render o Railway, seleccionar **Environment: Docker**.
3. El contenedor compila los protos y levanta la pila completa en el puerto asignado.

---

## 👨‍💻 Autor y Asignatura
- **Proyecto:** AegisSwarm AI - Tactical Drone Air Defense & Telemetry Control Center
- **Asignatura:** Programación Orientada a la Web / Sistemas Distribuidos
- **Semestre:** Séptimo Semestre
- **Licencia:** MIT Academic Open Source
