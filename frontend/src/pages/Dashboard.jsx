import { useEffect, useState } from "react";
import { getPredictions } from "../services/api";

import SensorChart from "../components/SensorChart";
import ModelChart from "../components/ModelChart";
import StatusPanel from "../components/StatusPanel";

function Dashboard() {

  const [data, setData] = useState(null);

  useEffect(() => {

    async function fetchData() {

      const result = await getStatus();
      setData(result);

    }

    fetchData();

    const interval = setInterval(fetchData, 10000); // cada 10s

    return () => clearInterval(interval);

  }, [])
  //Prueba
  /*useEffect(() => {async function fetchData() {const result = {ocsvm: { predictions: [0] },isoforest: { predictions: [0] },autoencoder: { predictions: [0] }};setData(result);}fetchData();}, []);*/

  if (!data || !data.sensors) return <p>Esperando datos del sistema...</p>;

  const sensors = data.sensors[0];

  return (

    <div>

      <h1>Dashboard de Anomalías del Edificio</h1>

      <SensorChart sensors={{
        temperature: sensors.Temp,
        humidity: sensors.Humedad,
        co2: sensors.CO2,
        energy: sensors["Energía"]
      }}/>

      <ModelChart
        ocsvm={data.models.ocsvm}
        isoforest={data.models.isoforest}
        autoencoder={data.models.autoencoder}
      />

      <StatusPanel final={data.final} />

    </div>

  );
}

export default Dashboard;