import { useEffect, useState } from "react";
import { getStatus, saveRecord } from "../services/api";

import SensorChart from "../components/SensorChart";
import ModelChart from "../components/ModelChart";
import StatusPanel from "../components/StatusPanel";

function Dashboard() {

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  useEffect(() => {

    async function fetchData() {
      try {
        setLoading(true);
        const result = await getStatus();
        setData(result);
        setError(null);
      } catch (err) {
        setError("Error al conectar con el servidor");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();

    // Actualizar cada 5 segundos
    const interval = setInterval(fetchData, 5000);

    return () => clearInterval(interval);

  }, []);

  const handleSave = async () => {
    if (!data) return;
    
    setSaving(true);
    setSaveMessage(null);
    
    try {
      const result = await saveRecord(data);
      setSaveMessage(`✓ Guardado: ${result.message || "Registro guardado"}`);
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage("✗ Error al guardar");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Cargando datos del sistema...</p>;
  if (error) return <p style={{color: "red"}}>{error}</p>;
  if (!data || !data.sensors) return <p>Esperando datos del sistema...</p>;

  const sensors = data.sensors;
  const models = data.models || {};
  const final = data.final;

  return (

    <div>

      <h1>Dashboard de Anomalías del Edificio</h1>

      <button 
        onClick={handleSave} 
        disabled={saving}
        style={{
          padding: "10px 20px",
          margin: "10px 0",
          backgroundColor: saving ? "#ccc" : "#28a745",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: saving ? "not-allowed" : "pointer",
          fontSize: "14px"
        }}
      >
        {saving ? "Guardando..." : "💾 Guardar Registro"}
      </button>

      {saveMessage && (
        <p style={{ color: saveMessage.includes("✓") ? "green" : "red" }}>
          {saveMessage}
        </p>
      )}

      <SensorChart sensors={{
        temperature: sensors.temperature,
        humidity: sensors.humidity,
        co2: sensors.co2,
        energy: sensors.energy
      }}/>

      <ModelChart
        ocsvm={models.ocsvm}
        isoforest={models.isoforest}
        autoencoder={models.autoencoder}
      />

      <StatusPanel final={final} />

    </div>

  );
}

export default Dashboard;