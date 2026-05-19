import React, { useState, useEffect, useMemo } from 'react';

// ==========================================
// CONFIGURACIÓN Y CONSTANTES DE SENSÓRICA
// ==========================================
const SENSORS_CLIMA = ["sensor-voc-1", "sensor-voc-2", "sensor-voc-3", "sensor-voc-4"];
const SENSORS_ELEC = ["elec_aa_1", "elec_aa_2", "elec_servicios", "elec_general"];

// Generador de datos simulados para pruebas locales interactivas
const generarDatosSimulados = (tipoEscenario = "normal", tick = 0) => {
  const baseTime = new Date(Date.now() - 75 * 60 * 1000);
  const historico = [];

  for (let i = 0; i < 5; i++) {
    const time = new Date(baseTime.getTime() + i * 15 * 60 * 1000);
    const timeStr = time.toISOString();
    
    // Ruido y ciclo normal
    const sinValue = Math.sin((time.getHours() + time.getMinutes() / 60) * Math.PI / 12);
    
    const row = {
      timestamp_rango: timeStr,
      total_alumnos: Math.round(15 + sinValue * 10 + (tipoEscenario === "ocupacion" ? 80 : 0)),
      // Electricidad
      elec_aa_1: Math.max(0, 1.2 + sinValue * 0.8 + (tipoEscenario === "hvac_error" && i === 4 ? 4.5 : 0)),
      elec_aa_2: Math.max(0, 0.9 + sinValue * 0.6),
      elec_servicios: Math.max(0, 0.5 + sinValue * 0.2),
      elec_general: Math.max(0, 3.2 + sinValue * 1.5 + (tipoEscenario === "hvac_error" && i === 4 ? 4.5 : 0))
    };

    // Sensores de Clima
    SENSORS_CLIMA.forEach((sensor, idx) => {
      let co2Base = 420 + idx * 15 + sinValue * 30;
      let tempBase = 21.5 + idx * 0.3 + sinValue * 1.2;
      let humBase = 38 + idx * 2 + sinValue * 5;
      let vocBase = 40 + idx * 12 + sinValue * 8;

      // Inyección de anomalías en el último registro (fila index 4)
      if (i === 4) {
        if (tipoEscenario === "co2_spike" && idx === 0) {
          co2Base += 680; // Pico masivo de CO2 en el sensor 1
        }
        if (tipoEscenario === "hvac_error") {
          tempBase += 6.5; // Sobrecalentamiento anormal
          humBase -= 15;
        }
      }

      row[`co2_${sensor}`] = Math.round(co2Base);
      row[`tem_${sensor}`] = parseFloat(tempBase.toFixed(1));
      row[`hum_${sensor}`] = parseFloat(humBase.toFixed(1));
      row[`par_${sensor}`] = Math.round(vocBase);
    });

    historico.push(row);
  }

  // Definición de respuestas del MS4 según escenario
  let hayAnomalia = false;
  let nivelCritico = "BAJO";
  let votos = { ocsvm: false, isoforest: false, autoencoder: false };
  let culpable = "Ninguno";
  let featureErrors = {};
  let alertasHw = [];

  if (tipoEscenario === "co2_spike") {
    hayAnomalia = true;
    nivelCritico = "ALTO";
    votos = { ocsvm: true, isoforest: true, autoencoder: true };
    culpable = "co2_sensor-voc-1";
    featureErrors = {
      "co2_sensor-voc-1": 1.82,
      "par_sensor-voc-1": 0.21,
      "tem_sensor-voc-1": 0.08,
      "total_alumnos": 0.05,
      "co2_sensor-voc-2": 0.02
    };
  } else if (tipoEscenario === "hvac_error") {
    hayAnomalia = true;
    nivelCritico = "MEDIO";
    votos = { ocsvm: false, isoforest: true, autoencoder: true };
    culpable = "tem_sensor-voc-1";
    featureErrors = {
      "tem_sensor-voc-1": 1.45,
      "elec_general": 1.12,
      "elec_aa_1": 0.98,
      "hum_sensor-voc-1": 0.72,
      "tem_sensor-voc-2": 0.15
    };
  } else if (tipoEscenario === "hardware_offline") {
    alertasHw = [
      { tipo: "OFFLINE", sensor: "sensor-voc-1", variable: "CO2", time: new Date().toISOString() },
      { tipo: "OFFLINE", sensor: "sensor-voc-1", variable: "Humidity", time: new Date().toISOString() },
      { tipo: "WARNING_AP", mensaje: "14 Puntos de acceso WiFi caídos", time: new Date().toISOString() }
    ];
  }

  return {
    timestamp: historico[4].timestamp_rango,
    consenso: {
      hay_anomalia: hayAnomalia,
      nivel_critico: nivelCritico,
      votos_detalle: votos
    },
    analisis_causa: {
      culpable_probable: culpable,
      error_distribucion: featureErrors,
      comentario: hayAnomalia ? `Desviación crítica localizada en la variable ${culpable}` : "Comportamiento y flujos termodinámicos estables."
    },
    datos_graficas: {
      actuales: historico[4],
      historico_ventana: historico
    },
    alertas_hardware: alertasHw
  };
};

export default function App() {
  const [useRealApi, setUseRealApi] = useState(false);
  const [escenarioSimulado, setEscenarioSimulado] = useState("normal");
  const [tick, setTick] = useState(0);
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [registroCausas, setRegistroCausas] = useState([]);

  // Cargar datos
  const cargarDatos = async () => {
    setLoading(true);
    setApiError(null);
    if (useRealApi) {
      try {
        const response = await fetch("http://localhost:8004/aggregate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Se asume que el MS2 provee datos válidos. En un entorno real,
            // esta llamada normalmente se gatilla automáticamente o el frontend
            // lee el último estado del MS4.
          })
        });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        setApiData(data);
        actualizarRegistroCausas(data);
      } catch (err) {
        setApiError(err.message);
        // Fallback automático al simulador para que la UI nunca se rompa
        const mock = generarDatosSimulados(escenarioSimulado, tick);
        setApiData(mock);
      }
    } else {
      // Usar simulación interactiva local
      const mock = generarDatosSimulados(escenarioSimulado, tick);
      setApiData(mock);
      actualizarRegistroCausas(mock);
    }
    setLoading(false);
  };

  const actualizarRegistroCausas = (newData) => {
    if (newData?.consenso?.hay_anomalia) {
      const nuevoRegistro = {
        time: new Date(newData.timestamp).toLocaleTimeString(),
        variable: newData.analisis_causa.culpable_probable,
        criticidad: newData.consenso.nivel_critico,
        comentario: newData.analisis_causa.comentario
      };
      setRegistroCausas(prev => {
        // Evitar duplicados consecutivos del mismo timestamp
        if (prev.length > 0 && prev[0].time === nuevoRegistro.time) return prev;
        return [nuevoRegistro, ...prev.slice(0, 9)];
      });
    }
  };

  useEffect(() => {
    cargarDatos();
  }, [useRealApi, escenarioSimulado, tick]);

  // Intervalo de auto-refresco (Simula peticiones cada 15 seg en UI para testing rápido)
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Extraer variables seguras
  const historico = apiData?.datos_graficas?.historico_ventana || [];
  const consenso = apiData?.consenso || { hay_anomalia: false, nivel_critico: "BAJO", votos_detalle: {} };
  const causa = apiData?.analisis_causa || { culpable_probable: "Ninguno", error_distribucion: {}, comentario: "" };
  const alertasHw = apiData?.alertas_hardware || [];

  // Función auxiliar para dibujar gráficos SVG limpios
  const renderSVGChart = (titulo, metricas, colorMap, minVal = 0, maxVal = 1000) => {
    if (historico.length < 2) return <div className="text-gray-500 text-sm">Cargando datos históricos...</div>;
    
    const width = 450;
    const height = 140;
    const padding = { top: 15, right: 10, bottom: 20, left: 35 };

    // Encontrar dinámicamente el min/max real de la ventana para auto-escalar
    let allValues = [];
    historico.forEach(row => {
      metricas.forEach(m => {
        if (row[m] !== undefined) allValues.push(row[m]);
      });
    });
    const realMin = allValues.length ? Math.min(...allValues) : minVal;
    const realMax = allValues.length ? Math.max(...allValues) : maxVal;
    const range = (realMax - realMin) === 0 ? 1 : (realMax - realMin) * 1.1;
    const adjustedMin = Math.max(0, realMin - range * 0.05);
    const adjustedMax = realMax + range * 0.05;

    const getX = (index) => padding.left + (index / (historico.length - 1)) * (width - padding.left - padding.right);
    const getY = (val) => height - padding.bottom - ((val - adjustedMin) / (adjustedMax - adjustedMin)) * (height - padding.top - padding.bottom);

    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 shadow-md backdrop-blur-sm">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{titulo}</h4>
          <span className="text-[10px] text-slate-400 font-mono">Último: {historico[historico.length - 1][metricas[0]]}</span>
        </div>
        
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          {/* Líneas de cuadrícula horizontal */}
          {[0, 0.5, 1].map((p, idx) => {
            const val = adjustedMin + p * (adjustedMax - adjustedMin);
            const y = getY(val);
            return (
              <g key={idx}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#334155" strokeWidth="0.5" strokeDasharray="2,2" />
                <text x={padding.left - 6} y={y + 3} fill="#94a3b8" fontSize="8" textAnchor="end" className="font-mono">
                  {Math.round(val)}
                </text>
              </g>
            );
          })}

          {/* Eje de tiempos */}
          {historico.map((row, idx) => {
            const x = getX(idx);
            const date = new Date(row.timestamp_rango);
            const label = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            return (
              <g key={idx}>
                <line x1={x} y1={height - padding.bottom} x2={x} y2={height - padding.bottom + 4} stroke="#475569" strokeWidth="1" />
                <text x={x} y={height - 6} fill="#94a3b8" fontSize="8" textAnchor="middle" className="font-mono">
                  {label}
                </text>
              </g>
            );
          })}

          {/* Trazar líneas para cada sensor */}
          {metricas.map((metrica, mIdx) => {
            const points = historico.map((row, idx) => `${getX(idx)},${getY(row[metrica])}`).join(' ');
            const color = colorMap[mIdx % colorMap.length];
            return (
              <g key={metrica}>
                <polyline fill="none" stroke={color} strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" />
                {/* Punto destacado final */}
                {historico.length > 0 && (
                  <circle cx={getX(historico.length - 1)} cy={getY(historico[historico.length - 1][metrica])} r="3.5" fill={color} stroke="#1e293b" strokeWidth="1.5" />
                )}
              </g>
            );
          })}
        </svg>

        {/* Leyenda pequeña */}
        <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-slate-700/30">
          {metricas.map((metrica, mIdx) => {
            const label = metrica.replace('co2_', '').replace('tem_', '').replace('hum_', '').replace('par_', '').replace('elec_', '');
            return (
              <div key={metrica} className="flex items-center gap-1.5 text-[9px] text-slate-400 font-mono">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: colorMap[mIdx % colorMap.length] }}></span>
                {label}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6 selection:bg-teal-500/30 selection:text-teal-200">
      
      {/* CABECERA PRINCIPAL */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
              Campus Smart Building IoT
            </span>
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
          <h1 className="text-2xl font-black bg-gradient-to-r from-teal-400 via-emerald-400 to-sky-400 bg-clip-text text-transparent mt-1">
            Plataforma FDI de Detección de Anomalías Multimodelo
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Mapeo de estado en tiempo real, calibración adaptativa y consenso inteligente para el Edificio Germán Bernácer.
          </p>
        </div>

        {/* INTERRUPTORES DE CONEXIÓN & SIMULADOR */}
        <div className="bg-slate-800/80 border border-slate-700 p-3 rounded-xl flex flex-wrap items-center gap-4 shadow-lg self-stretch md:self-auto">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300 font-semibold">Fuente:</span>
            <button
              onClick={() => setUseRealApi(false)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${!useRealApi ? 'bg-teal-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Simulador TFG
            </button>
            <button
              onClick={() => setUseRealApi(true)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${useRealApi ? 'bg-teal-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              API Real (MS4)
            </button>
          </div>

          {!useRealApi && (
            <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
              <span className="text-xs text-slate-300 font-semibold">Inyectar Caso:</span>
              <select
                value={escenarioSimulado}
                onChange={(e) => setEscenarioSimulado(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-teal-400 focus:outline-none focus:border-teal-400"
              >
                <option value="normal">Estado Estable (OK)</option>
                <option value="co2_spike">Pico Crítico CO2 (Anomalía)</option>
                <option value="hvac_error">Fallo Climatización (Anomalía)</option>
                <option value="hardware_offline">Mantenimiento (Sennsores Caídos)</option>
              </select>
            </div>
          )}
          
          <button 
            onClick={() => setTick(t => t + 1)}
            className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            title="Refrescar datos manualmente"
          >
            <svg className={`w-4 h-4 text-slate-200 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
            </svg>
          </button>
        </div>
      </header>

      {/* BANNER DE ALERTAS DE HARDWARE (MANTENIMIENTO) */}
      {alertasHw.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 p-4 rounded-xl mb-6 flex items-start gap-3 shadow-lg">
          <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold uppercase tracking-wide text-amber-300">
              Capa de Aislamiento Determinista: Alertas de Hardware Activas ({alertasHw.length})
            </h3>
            <p className="text-xs text-amber-300/80 mt-1">
              MS1 ha detectado la caída de varios dispositivos de la red. Para evitar la propagación de errores a los modelos de inteligencia artificial y la falsificación de anomalías físicas, se ha activado la imputación con caché inteligente.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-3">
              {alertasHw.map((al, idx) => (
                <div key={idx} className="bg-slate-950/40 p-2 rounded border border-amber-500/10 flex flex-col font-mono text-[11px]">
                  <span className="font-bold text-amber-400">{al.tipo}</span>
                  <span className="text-slate-300">Sensor: {al.sensor || "General"}</span>
                  {al.variable && <span className="text-slate-400">Dim: {al.variable}</span>}
                  {al.mensaje && <span className="text-slate-400">{al.mensaje}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DISEÑO EN DOS COLUMNAS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* COLUMNA IZQUIERDA Y CENTRAL: HISTÓRICO Y GRÁFICOS */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Comportamiento Termodinámico y Energético (Últimos 75 Minutos)
            </h2>
            <span className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded">5 intervalos de 15 min</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gráficas */}
            {renderSVGChart(
              "Dióxido de Carbono (CO2) - ppm", 
              SENSORS_CLIMA.map(s => `co2_${s}`), 
              ["#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59"], 
              350, 1200
            )}
            {renderSVGChart(
              "Temperatura Ambiente - ºC", 
              SENSORS_CLIMA.map(s => `tem_${s}`), 
              ["#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239"], 
              18, 32
            )}
            {renderSVGChart(
              "Humedad Relativa - %", 
              SENSORS_CLIMA.map(s => `hum_${s}`), 
              ["#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985"], 
              30, 65
            )}
            {renderSVGChart(
              "Partículas en Suspensión (VOC Index)", 
              SENSORS_CLIMA.map(s => `par_${s}`), 
              ["#c084fc", "#a855f7", "#9333ea", "#7e22ce", "#6b21a8"], 
              10, 250
            )}
            {renderSVGChart(
              "Consumo de Energía Eléctrica - kW", 
              SENSORS_ELEC, 
              ["#fbbf24", "#f59e0b", "#d97706", "#b45309"], 
              0, 12
            )}
            {renderSVGChart(
              "Afluencia / Conexiones Inalámbricas (WiFi)", 
              ["total_alumnos"], 
              ["#34d399"], 
              0, 150
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA: VOTACIÓN, CONSENSO E INTELIGENCIA DE CAUSA RAIZ */}
        <div className="space-y-6">
          
          {/* TARJETA DE VOTOS INDIVIDUALES */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full blur-2xl"></div>
            
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Comité de Sabios: Votos Individuales
            </h3>

            <div className="space-y-4">
              {/* OCSVM */}
              <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/40">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-200">One-Class SVM (MS3.1)</span>
                  <span className="text-[10px] text-slate-400">Análisis Geométrico de Fronteras</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${consenso.votos_detalle.ocsvm ? 'bg-indigo-500 shadow-lg shadow-indigo-500/50 animate-pulse' : 'bg-slate-700'}`}></span>
                  <span className="text-[11px] font-mono font-bold w-16 text-right">
                    {consenso.votos_detalle.ocsvm ? "ANOMALÍA" : "NORMAL"}
                  </span>
                </div>
              </div>

              {/* Isolation Forest */}
              <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/40">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-200">Isolation Forest (MS3.2)</span>
                  <span className="text-[10px] text-slate-400">Aislamiento por Particionado Recurrente</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${consenso.votos_detalle.isoforest ? 'bg-pink-500 shadow-lg shadow-pink-500/50 animate-pulse' : 'bg-slate-700'}`}></span>
                  <span className="text-[11px] font-mono font-bold w-16 text-right">
                    {consenso.votos_detalle.isoforest ? "ANOMALÍA" : "NORMAL"}
                  </span>
                </div>
              </div>

              {/* LSTM Autoencoder */}
              <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/40">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-200">LSTM Autoencoder (MS3.3)</span>
                  <span className="text-[10px] text-slate-400">Error Temporal Secuencial</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${consenso.votos_detalle.autoencoder ? 'bg-amber-500 shadow-lg shadow-amber-500/50 animate-pulse' : 'bg-slate-700'}`}></span>
                  <span className="text-[11px] font-mono font-bold w-16 text-right">
                    {consenso.votos_detalle.autoencoder ? "ANOMALÍA" : "NORMAL"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* TARJETA DEL RESULTADO DEL CONSENSO */}
          <div className={`border rounded-2xl p-6 shadow-xl transition-all duration-300 ${
            consenso.hay_anomalia 
              ? 'bg-rose-950/20 border-rose-500/50 text-rose-100 shadow-rose-500/5' 
              : 'bg-slate-800/80 border-slate-700 text-slate-100'
          }`}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              Vedicto de la Red de Consenso
            </h3>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-mono">ESTADO GENERAL</span>
                <h2 className={`text-2xl font-black mt-1 ${consenso.hay_anomalia ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {consenso.hay_anomalia ? "ANOMALÍA DETECTADA" : "SISTEMA ESTABLE"}
                </h2>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-mono">CRITICIDAD</span>
                <span className={`block px-3 py-1 rounded-full text-xs font-black mt-1 ${
                  consenso.nivel_critico === "ALTO" 
                    ? 'bg-rose-500 text-slate-950' 
                    : consenso.nivel_critico === "MEDIO" 
                    ? 'bg-amber-500 text-slate-950' 
                    : 'bg-emerald-500 text-slate-950'
                }`}>
                  {consenso.nivel_critico}
                </span>
              </div>
            </div>

            <p className="text-xs mt-4 text-slate-300 border-t border-slate-700/50 pt-4 leading-relaxed">
              {consenso.hay_anomalia 
                ? "Atención: La correlación espacial y secuencial de variables ha superado el umbral Z-score adaptativo de los modelos. Se requiere revisión." 
                : "La redundancia analítica no reporta desviaciones críticas. Todos los sensores operan dentro de los márgenes estacionales previstos."}
            </p>
          </div>

          {/* INTELIGENCIA DEL AUTOENCODER: CAUSA RAÍZ */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 shadow-xl">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 01-2 2h0a2 2 0 01-2-2v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Aislamiento de Causa Raíz (Análisis FDI)
            </h3>

            <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-700/50 mb-4">
              <span className="text-[10px] text-slate-400 font-mono uppercase">Sensor con mayor desviación</span>
              <div className="text-lg font-black text-teal-400 mt-1 font-mono">
                {causa.culpable_probable}
              </div>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                {causa.comentario}
              </p>
            </div>

            {/* Distribución del error de reconstrucción */}
            {consenso.hay_anomalia && Object.keys(causa.error_distribucion).length > 0 && (
              <div>
                <span className="text-[10px] text-slate-400 font-mono uppercase block mb-2">
                  Top Residuos de Reconstrucción (LSTM-AE)
                </span>
                <div className="space-y-2">
                  {Object.entries(causa.error_distribucion).map(([key, val]) => (
                    <div key={key} className="text-xs">
                      <div className="flex justify-between text-slate-300 mb-1 font-mono text-[10px]">
                        <span>{key}</span>
                        <span>{val.toFixed(3)}</span>
                      </div>
                      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-teal-500 to-emerald-400 h-1.5 rounded-full" 
                          style={{ width: `${Math.min(100, (val / 2.0) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* REGISTRO HISTÓRICO DE ALERTAS DE COMPORTAMIENTO */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 shadow-xl">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Historial de Anomalías de Comportamiento (Últimas Alertas)
            </h3>

            {registroCausas.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs italic border border-dashed border-slate-700 rounded-xl">
                No se han registrado alertas de comportamiento en esta sesión.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {registroCausas.map((reg, index) => (
                  <div key={index} className="bg-slate-900/40 p-3 rounded-lg border border-slate-700/30 flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          {reg.criticidad}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">{reg.time}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1 font-mono">{reg.variable}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{reg.comentario}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* FOOTER */}
      <footer className="mt-12 pt-6 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-500 font-mono">
        <div>
          Edificio Germán Bernácer - TFG / TFM Universidad de Alicante
        </div>
        <div>
          Desarrollado en base a Ensembles Outlier Detection & Adaptive Thresholds.
        </div>
      </footer>

    </div>
  );
}