import { useEffect, useState } from "react";
import { getPredictions } from "../services/api";

import SensorChart from "../components/SensorChart";
import ModelChart from "../components/ModelChart";
import StatusPanel from "../components/StatusPanel";

function Dashboard() {

  const [data, setData] = useState(null);
/*
  useEffect(() => {

    async function fetchData() {

      const result = await getPredictions({
        standard: {},
        robust: {}
      });

      setData(result);
    }

    fetchData();

    const interval = setInterval(fetchData, 300000);

    return () => clearInterval(interval);

  }, []);*/
  useEffect(() => {

    async function fetchData() {

      const result = {
        ocsvm: { predictions: [0] },
        isoforest: { predictions: [0] },
        autoencoder: { predictions: [0] }
      };

      setData(result);
    }

    fetchData();

  }, []);

  if (!data) return <p>Cargando...</p>;

  const ocsvm = data.ocsvm.predictions[0];
  const isoforest = data.isoforest.predictions[0];
  const autoencoder = data.autoencoder.predictions[0];

  const final = (ocsvm + isoforest + autoencoder) >= 2 ? 1 : 0;

  const sensors = {
    temperature: 22,
    humidity: 45,
    co2: 500,
    energy: 120
  };

  return (
    <div>

      <h1>Dashboard de Anomalías del Edificio</h1>

      <SensorChart sensors={sensors} />

      <ModelChart
        ocsvm={ocsvm}
        isoforest={isoforest}
        autoencoder={autoencoder}
      />

      <StatusPanel final={final} />

    </div>
  );
}

export default Dashboard;