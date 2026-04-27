import { useEffect, useState } from "react";
import { getStatus } from "../services/api";

import SensorChart from "../components/SensorChart";
import ModelChart from "../components/ModelChart";
import StatusPanel from "../components/StatusPanel";

function Dashboard() {

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  if (loading) return <p>Cargando datos del sistema...</p>;
  if (error) return <p style={{color: "red"}}>{error}</p>;
  if (!data || !data.sensors) return <p>Esperando datos del sistema...</p>;

  const sensors = data.sensors;
  const models = data.models || {};
  const final = data.final;

  return (

    <div>

      <h1>Dashboard de Anomalías del Edificio</h1>

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