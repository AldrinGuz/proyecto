import SensorChart from "./components/SensorChart";
import ModelChart from "./components/ModelChart";
import StatusPanel from "./components/StatusPanel";
import "./index.css";

function App() {

  const data = {
    sensors: {
      temperature: 22,
      humidity: 45,
      co2: 520,
      energy: 13
    },
    models: {
      ocsvm: 0,
      isoforest: 1,
      autoencoder: 0
    },
    final: false
  };

  return (
    <div className="dashboard">

      <header className="title">
        <h1>Dashboard de Anomalías del Edificio</h1>
      </header>

      <div className="panel sensors">
        <SensorChart sensors={data.sensors} />
      </div>

      <div className="panel models">
        <ModelChart
          ocsvm={data.models.ocsvm}
          isoforest={data.models.isoforest}
          autoencoder={data.models.autoencoder}
        />
      </div>

      <div className="panel status">
        <StatusPanel final={data.final} />
      </div>

    </div>
  );
}

export default App;