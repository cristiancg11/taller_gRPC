import React, { useState, useEffect, useRef } from 'react'

// Web Audio Synthesizer for Military Sound FX (Zero external dependencies)
class TacticalAudio {
  constructor() {
    this.ctx = null
    this.enabled = true
  }
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (AudioContext) this.ctx = new AudioContext()
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }
  playPing() {
    if (!this.enabled) return
    this.init()
    if (!this.ctx) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, this.ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15)
    osc.connect(gain)
    gain.connect(this.ctx.destination)
    osc.start()
    osc.stop(this.ctx.currentTime + 0.15)
  }
  playEngage() {
    if (!this.enabled) return
    this.init()
    if (!this.ctx) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, this.ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(880, this.ctx.currentTime + 0.25)
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3)
    osc.connect(gain)
    gain.connect(this.ctx.destination)
    osc.start()
    osc.stop(this.ctx.currentTime + 0.3)
  }
  playKill() {
    if (!this.enabled) return
    this.init()
    if (!this.ctx) return
    const bufferSize = this.ctx.sampleRate * 0.4
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }
    const noise = this.ctx.createBufferSource()
    noise.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(800, this.ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.4)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4)
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(this.ctx.destination)
    noise.start()
  }
}

const audioSys = new TacticalAudio()

export default function App() {
  const [telemetry, setTelemetry] = useState(null)
  const [metrics, setMetrics] = useState({
    protobuf_bytes: 484,
    json_equivalent_bytes: 1480,
    bandwidth_saving_pct: 67.3,
    stream_hz: 20,
    measured_hz: 20
  })
  const [connected, setConnected] = useState(false)
  const [tactic, setTactic] = useState("DEFENSIVE_ORBIT")
  const [targetHz, setTargetHz] = useState(20)
  const [commandLog, setCommandLog] = useState([])
  const [unaryLatency, setUnaryLatency] = useState(0.043)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [radarRangeKm, setRadarRangeKm] = useState(50)
  const [totalPackets, setTotalPackets] = useState(0)
  const [totalBytesSaved, setTotalBytesSaved] = useState(0)
  const [neutralizedAnim, setNeutralizedAnim] = useState(false)

  const wsRef = useRef(null)
  const packetCountRef = useRef(0)
  const lastHzCalcRef = useRef(Date.now())
  const lastNeutralizedRef = useRef(false)

  // Connect to WebSocket Gateway
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host || 'localhost:8000'
    const wsUrl = `${protocol}//${host}/ws/telemetry?rate_hz=${targetHz}`

    function connect() {
      console.log("[C2-LINK] Connecting to Tactical Gateway WebSocket:", wsUrl)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log("[C2-LINK] Connected to Air Defense Gateway.")
        setConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === "TELEMETRY_FRAME") {
            const data = msg.data
            const m = msg.metrics
            setTelemetry(data)

            // Check for threat neutralization transition
            if (data.active_threat && data.active_threat.is_neutralized && !lastNeutralizedRef.current) {
              audioSys.playKill()
              setNeutralizedAnim(true)
              setTimeout(() => setNeutralizedAnim(false), 3000)
            }
            lastNeutralizedRef.current = data.active_threat?.is_neutralized || false

            // Update metrics & savings
            const saved = (m.json_equivalent_bytes - m.protobuf_bytes)
            setTotalBytesSaved(prev => prev + (saved > 0 ? saved : 0))
            setTotalPackets(prev => prev + 1)

            packetCountRef.current++
            const now = Date.now()
            if (now - lastHzCalcRef.current >= 1000) {
              const measured = Math.round((packetCountRef.current * 1000) / (now - lastHzCalcRef.current))
              packetCountRef.current = 0
              lastHzCalcRef.current = now
              setMetrics({
                ...m,
                measured_hz: measured
              })
            } else {
              setMetrics(prev => ({
                ...prev,
                protobuf_bytes: m.protobuf_bytes,
                json_equivalent_bytes: m.json_equivalent_bytes,
                bandwidth_saving_pct: m.bandwidth_saving_pct,
                stream_hz: m.stream_hz
              }))
            }
          }
        } catch (err) {
          console.error("[C2-LINK] Parsing error:", err)
        }
      }

      ws.onclose = () => {
        console.warn("[C2-LINK] Disconnected. Retrying in 2.5s...")
        setConnected(false)
        setTimeout(connect, 2500)
      }

      ws.onerror = (e) => {
        console.error("[C2-LINK] WebSocket error:", e)
      }
    }

    connect()

    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  // Send live gRPC streaming rate change to Gateway
  const handleRateChange = (newHz) => {
    setTargetHz(newHz)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "SET_RATE",
        rate_hz: newHz
      }))
    }
  }

  // Dispatch Tactical Command (Unary RPC)
  const sendTacticalCommand = async (action, targetId = null) => {
    audioSys.init()
    if (action === "ENGAGE") audioSys.playEngage()
    else audioSys.playPing()

    const t0 = performance.now()
    try {
      const resp = await fetch("/api/tactical-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action,
          command_id: `CMD-${Date.now().toString().slice(-6)}`,
          target_id: targetId || telemetry?.active_threat?.threat_id || "BOGEY"
        })
      })
      const res = await resp.json()
      const rtt = performance.now() - t0
      setUnaryLatency(res.grpc_latency_ms || 0.05)
      setTactic(action)

      setCommandLog(prev => [
        {
          id: res.command_id || `CMD-${Date.now()}`,
          action: action,
          success: res.success,
          message: res.message,
          grpc_latency_ms: res.grpc_latency_ms,
          rtt_ms: rtt.toFixed(2),
          time: new Date().toLocaleTimeString()
        },
        ...prev.slice(0, 9)
      ])
    } catch (err) {
      console.error("Failed to execute tactical command:", err)
    }
  }

  // Spawn or Reset Hostile Bogey
  const handleSpawnThreat = async (x = 38000, y = 32000, z = 11000) => {
    audioSys.init()
    audioSys.playPing()
    try {
      await fetch("/api/threat/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threat_type: "HYPERSONIC_MISSILE",
          x: x, y: y, z: z
        })
      })
    } catch (e) {
      console.error("Error spawning threat:", e)
    }
  }

  const threatActive = telemetry?.active_threat && !telemetry?.active_threat?.is_neutralized
  const threatDistanceKm = telemetry?.active_threat ? (telemetry.active_threat.distance_to_base_meters / 1000).toFixed(1) : "--"

  return (
    <div className="flex flex-col min-h-screen p-3 md:p-6 space-y-4 max-w-[1720px] mx-auto text-slate-100">
      {/* TOP TACTICAL HEADER */}
      <header className="tactical-box p-4 flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-emerald-500">
        <div className="flex items-center space-x-3">
          <div className="relative w-10 h-10 flex items-center justify-center bg-emerald-500/10 border border-emerald-500 rounded">
            <span className="text-emerald-400 font-bold text-xl animate-pulse">☩</span>
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-wider text-slate-100 font-tactical flex items-center gap-2">
              AEGIS-SWARM AI <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">C2 CORE</span>
            </h1>
            <p className="text-xs text-slate-400">
              Tactical Drone Air Defense & Kinematic Telemetry Control Center // gRPC + Protobuf over HTTP/2
            </p>
          </div>
        </div>

        {/* DEFCON & Status Bar */}
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded border text-xs font-bold tracking-widest uppercase flex items-center gap-2 ${
            threatActive 
              ? 'bg-red-500/20 border-red-500 text-red-400 glow-red animate-alert' 
              : 'bg-emerald-500/20 border-emerald-500 text-emerald-400 glow-green'
          }`}>
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-current animate-pulse"></span>
            {threatActive ? 'DEFCON 1 // HOSTILE CONTACT' : 'DEFCON 4 // AIRSPACE SECURE'}
          </div>

          <div className="px-3 py-1 bg-slate-900 border border-slate-700 rounded text-xs flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`}></span>
            <span className="text-slate-300 font-mono">PORT 50051: {connected ? 'ACTIVE (HTTP/2)' : 'OFFLINE'}</span>
          </div>

          <button 
            onClick={() => {
              audioSys.enabled = !audioEnabled
              setAudioEnabled(!audioEnabled)
              if (!audioEnabled) audioSys.playPing()
            }}
            className="px-2.5 py-1 text-xs border border-slate-700 hover:border-emerald-500 rounded bg-slate-900 text-slate-300 transition-colors"
            title="Toggle Tactical Audio Feedback"
          >
            {audioEnabled ? '🔊 SONAR ON' : '🔇 MUTED'}
          </button>
        </div>
      </header>

      {/* MAIN TACTICAL WORKSPACE (GRID) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* LEFT / CENTER: TACTICAL RADAR CANVAS (7 COLS) */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          <div className={`tactical-box p-3 relative ${threatActive ? 'tactical-box-red border-glow-red' : ''}`}>
            <div className="flex justify-between items-center mb-2 px-1">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-emerald-400 tracking-widest font-tactical">
                  RADAR TÁCTICO 360° // SECTOR ALPHA-7
                </span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                  RANGE: {radarRangeKm} KM
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-slate-400">CLICK EN EL RADAR PARA SPAWN MANUAL</span>
                <button 
                  onClick={() => setRadarRangeKm(r => r === 50 ? 75 : (r === 75 ? 30 : 50))}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-700 text-cyan-400"
                >
                  ZOOM RANGE
                </button>
              </div>
            </div>

            {/* Radar Canvas with 360 Sweep and Kinematics */}
            <div className="relative aspect-square w-full max-h-[640px] rounded overflow-hidden border border-slate-800 bg-[#030814]">
              <TacticalRadarCanvas 
                telemetry={telemetry}
                rangeKm={radarRangeKm}
                onRadarClick={(x, y) => handleSpawnThreat(x, y, 9000)}
                neutralizedAnim={neutralizedAnim}
              />

              {/* Neutralized Overlay Banner */}
              {telemetry?.active_threat?.is_neutralized && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 font-bold px-4 py-1.5 rounded shadow-lg tracking-widest border border-white text-xs animate-bounce font-tactical">
                  ✓ IMPACTO CINÉTICO CONFIRMADO // AMENAZA NEUTRALIZADA
                </div>
              )}

              {/* Incoming Bogey Warning Banner */}
              {threatActive && (
                <div className="absolute bottom-4 left-4 right-4 bg-red-600/90 text-white px-3 py-2 rounded flex items-center justify-between font-tactical border border-red-300 shadow-xl animate-alert text-xs md:text-sm">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">⚠</span>
                    <span className="font-bold tracking-wider">
                      ALERTA CRÍTICA: MISIL HIPERSÓNICO RUMBO A BASE
                    </span>
                  </div>
                  <div className="font-mono text-xs">
                    DIST: <span className="text-yellow-200 font-bold">{threatDistanceKm} KM</span> | MACH 4.5
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* OPERATOR COMMAND CONSOLE */}
          <div className="tactical-box p-4 space-y-4">
            <div className="text-xs font-bold text-amber-400 tracking-widest uppercase font-tactical flex items-center justify-between">
              <span>CONSOLA DE ÓRDENES TÁCTICAS (UNARY RPC &lt; 5 MS)</span>
              <span className="text-[10px] text-slate-400 font-mono">LATENCIA RPC: {unaryLatency.toFixed(3)} ms</span>
            </div>

            {/* HIGH PRIORITY BUTTONS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => sendTacticalCommand("ENGAGE")}
                disabled={!threatActive}
                className={`py-3.5 px-4 rounded font-tactical font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 transition-all shadow-lg ${
                  threatActive
                    ? 'bg-red-600 hover:bg-red-500 text-white border-2 border-red-400 animate-pulse shadow-[0_0_25px_rgba(239,68,68,0.7)] cursor-pointer'
                    : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                }`}
              >
                <span className="text-lg">⚡</span> AUTORIZAR INTERCEPTACIÓN (MACH 2.5)
              </button>

              <button
                onClick={() => handleSpawnThreat()}
                className="py-3.5 px-4 rounded font-tactical font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/50 hover:border-amber-400 transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)]"
              >
                <span>🎯</span> LANZAR AMENAZA HOSTIL (BOGEY)
              </button>
            </div>

            {/* TACTIC PRESETS & STREAM FREQUENCY */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
              <div>
                <label className="text-[11px] text-slate-400 uppercase tracking-wider block mb-1.5">
                  Directiva de Enjambre (Táctica)
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => sendTacticalCommand("DEFENSIVE_ORBIT")}
                    className={`py-1.5 px-2 text-xs rounded font-mono border transition-all ${
                      tactic === "DEFENSIVE_ORBIT"
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    Órbita Def.
                  </button>
                  <button
                    onClick={() => sendTacticalCommand("SEARCH_PERIMETER")}
                    className={`py-1.5 px-2 text-xs rounded font-mono border transition-all ${
                      tactic === "SEARCH_PERIMETER"
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    Búsqueda 22k
                  </button>
                  <button
                    onClick={() => sendTacticalCommand("ABORT")}
                    className={`py-1.5 px-2 text-xs rounded font-mono border transition-all ${
                      tactic === "ABORT"
                        ? 'bg-amber-500/20 border-amber-500 text-amber-400 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    Abortar
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] text-slate-400 uppercase tracking-wider">
                    Tasa gRPC Stream (Hz)
                  </label>
                  <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                    {targetHz} Hz ({Math.round(1000/targetHz)} ms)
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={targetHz}
                  onChange={(e) => handleRateChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                  <span>5 Hz (Low Bandwidth)</span>
                  <span>30 Hz (Tactical)</span>
                  <span>60 Hz (High Precision)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR: METRICS MONITOR & FLEET STATUS (5 COLS) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          
          {/* ACADEMIC BENCHMARK & gRPC METRICS MONITOR */}
          <div className="tactical-box p-4 border-l-4 border-l-cyan-500 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-cyan-400 tracking-widest font-tactical">
                MONITOR DE RENDIMIENTO gRPC vs REST/JSON
              </span>
              <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono">
                HTTP/2 PROTOBUF
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">Tamaño Paquete Protobuf</span>
                <span className="text-lg font-bold font-mono text-emerald-400">
                  {metrics.protobuf_bytes} <span className="text-xs font-normal">Bytes</span>
                </span>
                <span className="text-[10px] text-emerald-400/80 block mt-0.5">Binario Compacto</span>
              </div>

              <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">Equivalente JSON</span>
                <span className="text-lg font-bold font-mono text-slate-300">
                  {metrics.json_equivalent_bytes} <span className="text-xs font-normal">Bytes</span>
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Sobrecarga Textual</span>
              </div>
            </div>

            <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Ahorro de Ancho de Banda:</span>
                <span className="text-emerald-400 font-bold">
                  {metrics.bandwidth_saving_pct}% REDUCCIÓN
                </span>
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${metrics.bandwidth_saving_pct}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1.5">
                <span>Paquetes procesados: {totalPackets}</span>
                <span>Ahorro acum: {(totalBytesSaved / 1024).toFixed(1)} KB</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-slate-900/50 p-2 rounded border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Stream Real:</span>
                <span className="text-cyan-400 font-bold">{metrics.measured_hz} Hz</span>
              </div>
              <div className="bg-slate-900/50 p-2 rounded border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">gRPC Server RPC:</span>
                <span className="text-emerald-400 font-bold">{unaryLatency.toFixed(3)} ms</span>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-800 pt-2 italic">
              * gRPC utiliza multiplexación en una única conexión TCP/HTTP/2 y serialización Protobuf sin parsing de texto, eliminando el jitter y reduciendo la latencia de 120ms (REST típico) a sub-milisegundos.
            </p>
          </div>

          {/* ENJAMBRE DE DRONES - STATUS DETALLADO */}
          <div className="tactical-box p-4 space-y-3 flex-1 flex flex-col">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-emerald-400 tracking-widest font-tactical">
                TELEMETRÍA DE INTERCEPTORES ({telemetry?.drones?.length || 0}/6 ACTIVOS)
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                LISTO: {telemetry?.interception_readiness_pct || 98}%
              </span>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[340px] pr-1">
              {telemetry?.drones?.map((drone) => (
                <div 
                  key={drone.drone_id}
                  className="p-2 rounded bg-slate-900/70 border border-slate-800 hover:border-emerald-500/50 transition-colors flex items-center justify-between text-xs font-mono"
                >
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${
                      drone.status === 'INTERCEPTING' ? 'bg-red-500 animate-ping' :
                      drone.status === 'LOCKED' ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}></span>
                    <div>
                      <span className="font-bold text-slate-200">{drone.drone_id}</span>
                      <span className="text-[10px] text-slate-400 ml-2">
                        [{drone.position.x > 0 ? '+' : ''}{(drone.position.x/1000).toFixed(1)}, {(drone.position.y/1000).toFixed(1)}] km
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] text-cyan-400 font-bold">
                      Mach {drone.velocity_mach}
                    </span>
                    <div className="flex items-center space-x-1" title={`Batería: ${drone.battery_percentage}%`}>
                      <span className="text-[10px] text-slate-400">{drone.battery_percentage}%</span>
                      <div className="w-8 h-2 bg-slate-800 rounded overflow-hidden">
                        <div 
                          className={`h-full ${drone.battery_percentage > 50 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                          style={{ width: `${drone.battery_percentage}%` }}
                        ></div>
                      </div>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                      drone.status === 'INTERCEPTING' ? 'bg-red-900/60 text-red-300 border border-red-700 animate-pulse' :
                      drone.status === 'LOCKED' ? 'bg-amber-900/60 text-amber-300 border border-amber-700' :
                      'bg-emerald-900/40 text-emerald-300'
                    }`}>
                      {drone.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TACTICAL AUDIT / COMMAND EXECUTION LOG */}
          <div className="tactical-box p-3 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 tracking-wider font-tactical uppercase block">
              REGISTRO DE COMANDOS TÁCTICOS UNARY RPC
            </span>
            <div className="space-y-1 font-mono text-[10px] max-h-32 overflow-y-auto">
              {commandLog.length === 0 && (
                <div className="text-slate-600 italic">No hay órdenes tácticas ejecutadas en esta sesión.</div>
              )}
              {commandLog.map((log) => (
                <div key={log.id} className="p-1 rounded bg-slate-900/50 border border-slate-800/80 flex justify-between items-center">
                  <span className="text-slate-400">{log.time}</span>
                  <span className="text-amber-400 font-bold">{log.action}</span>
                  <span className="text-slate-300 truncate max-w-[160px]">{log.message}</span>
                  <span className="text-emerald-400">{log.grpc_latency_ms} ms</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function TacticalRadarCanvas({ telemetry, rangeKm, onRadarClick, neutralizedAnim }) {
  const canvasRef = useRef(null)
  const angleRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId

    function render() {
      const w = canvas.width = canvas.parentElement.clientWidth
      const h = canvas.height = canvas.parentElement.clientHeight
      const centerX = w / 2
      const centerY = h / 2
      const maxRadius = Math.min(centerX, centerY) - 15
      const scale = maxRadius / (rangeKm * 1000)

      ctx.fillStyle = '#030814'
      ctx.fillRect(0, 0, w, h)

      ctx.strokeStyle = 'rgba(34, 197, 94, 0.2)'
      ctx.lineWidth = 1
      const rings = [0.25, 0.5, 0.75, 1.0]
      rings.forEach(fraction => {
        const r = maxRadius * fraction
        ctx.beginPath()
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2)
        ctx.stroke()

        ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'
        ctx.font = '10px monospace'
        ctx.fillText(`${(rangeKm * fraction).toFixed(0)} km`, centerX + 4, centerY - r + 12)
      })

      ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)'
      ctx.beginPath()
      ctx.moveTo(centerX - maxRadius, centerY)
      ctx.lineTo(centerX + maxRadius, centerY)
      ctx.moveTo(centerX, centerY - maxRadius)
      ctx.lineTo(centerX, centerY + maxRadius)
      ctx.stroke()

      ctx.setLineDash([2, 4])
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.12)'
      ctx.beginPath()
      const diag = maxRadius * 0.7071
      ctx.moveTo(centerX - diag, centerY - diag)
      ctx.lineTo(centerX + diag, centerY + diag)
      ctx.moveTo(centerX - diag, centerY + diag)
      ctx.lineTo(centerX + diag, centerY - diag)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#22c55e'
      ctx.font = 'bold 11px monospace'
      ctx.fillText('N 000°', centerX - 18, centerY - maxRadius + 14)
      ctx.fillText('S 180°', centerX - 18, centerY + maxRadius - 6)
      ctx.fillText('E 090°', centerX + maxRadius - 40, centerY - 4)
      ctx.fillText('W 270°', centerX - maxRadius + 6, centerY - 4)

      ctx.fillStyle = '#22c55e'
      ctx.beginPath()
      ctx.arc(centerX, centerY, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#22c55e'
      ctx.beginPath()
      ctx.arc(centerX, centerY, 8, 0, Math.PI * 2)
      ctx.stroke()

      angleRef.current = (angleRef.current + 0.035) % (Math.PI * 2)
      const sweepAngle = angleRef.current

      const sweepGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius)
      sweepGrad.addColorStop(0, 'rgba(34, 197, 94, 0.25)')
      sweepGrad.addColorStop(1, 'rgba(34, 197, 94, 0.01)')

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(centerX, centerY)
      ctx.arc(centerX, centerY, maxRadius, sweepAngle - 0.45, sweepAngle)
      ctx.closePath()
      ctx.fillStyle = sweepGrad
      ctx.fill()

      ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(centerX, centerY)
      ctx.lineTo(
        centerX + maxRadius * Math.cos(sweepAngle),
        centerY + maxRadius * Math.sin(sweepAngle)
      )
      ctx.stroke()
      ctx.restore()

      if (telemetry?.drones) {
        telemetry.drones.forEach((d) => {
          const dx = centerX + d.position.x * scale
          const dy = centerY - d.position.y * scale

          const isIntercepting = d.status === 'INTERCEPTING'
          ctx.fillStyle = isIntercepting ? '#ef4444' : '#22c55e'
          ctx.beginPath()
          ctx.arc(dx, dy, isIntercepting ? 5 : 4, 0, Math.PI * 2)
          ctx.fill()

          ctx.strokeStyle = isIntercepting ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.5)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(dx, dy, isIntercepting ? 9 : 7, 0, Math.PI * 2)
          ctx.stroke()

          ctx.fillStyle = isIntercepting ? '#f87171' : '#86efac'
          ctx.font = '9px monospace'
          const shortId = d.drone_id.replace('AEGIS-', '')
          ctx.fillText(`${shortId} [M${d.velocity_mach}]`, dx + 8, dy - 4)
        })
      }

      const threat = telemetry?.active_threat
      if (threat) {
        const tx = centerX + threat.position.x * scale
        const ty = centerY - threat.position.y * scale

        if (threat.is_neutralized) {
          ctx.strokeStyle = '#64748b'
          ctx.lineWidth = 1.5
          ctx.strokeRect(tx - 6, ty - 6, 12, 12)
          ctx.fillStyle = '#94a3b8'
          ctx.font = 'bold 9px monospace'
          ctx.fillText('KILL', tx + 8, ty + 3)
        } else {
          const pulse = (Math.sin(Date.now() / 120) + 1) / 2
          const rSize = 7 + pulse * 4

          ctx.fillStyle = '#ef4444'
          ctx.beginPath()
          ctx.moveTo(tx, ty - rSize)
          ctx.lineTo(tx + rSize, ty)
          ctx.lineTo(tx, ty + rSize)
          ctx.lineTo(tx - rSize, ty)
          ctx.closePath()
          ctx.fill()

          ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + pulse * 0.6})`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(tx, ty, rSize + 8, 0, Math.PI * 2)
          ctx.stroke()

          ctx.setLineDash([3, 3])
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'
          ctx.beginPath()
          ctx.moveTo(tx, ty)
          ctx.lineTo(centerX, centerY)
          ctx.stroke()
          ctx.setLineDash([])

          ctx.fillStyle = '#fca5a5'
          ctx.font = 'bold 10px monospace'
          const distKm = (threat.distance_to_base_meters / 1000).toFixed(1)
          ctx.fillText(`! ${threat.threat_id}`, tx + 12, ty - 4)
          ctx.fillText(`${distKm} km | M4.5`, tx + 12, ty + 8)
        }
      }

      if (neutralizedAnim) {
        const burstTime = (Date.now() % 1000) / 1000
        const burstRadius = burstTime * 60
        const opacity = 1 - burstTime
        ctx.strokeStyle = `rgba(34, 197, 94, ${opacity})`
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(centerX, centerY, burstRadius, 0, Math.PI * 2)
        ctx.stroke()
      }

      animId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animId)
  }, [telemetry, rangeKm, neutralizedAnim])

  const handleClick = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const maxRadius = Math.min(centerX, centerY) - 15
    const scale = maxRadius / (rangeKm * 1000)

    const meterX = (px - centerX) / scale
    const meterY = (centerY - py) / scale

    onRadarClick(meterX, meterY)
  }

  return (
    <canvas
      id="tactical-radar"
      ref={canvasRef}
      onClick={handleClick}
      className="w-full h-full block cursor-crosshair"
    />
  )
}
