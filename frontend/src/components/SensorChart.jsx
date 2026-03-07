import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement
} from "chart.js";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement);

function SensorChart({ sensors }) {

  const data = {
    labels: ["Temperatura", "Humedad", "CO2", "Energía"],
    datasets: [
      {
        label: "Valores sensores",
        data: [
          sensors.temperature,
          sensors.humidity,
          sensors.co2,
          sensors.energy
        ]
      }
    ]
  };

  return (
    <div>
      <h3>Datos de Sensores</h3>
      <Line data={data} />
    </div>
  );
}

export default SensorChart;