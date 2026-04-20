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
        ],
        borderColor: [
          "#ff6384",
          "#36a2eb",
          "#ffce56",
          "#4bc0c0"
        ],
        backgroundColor: [
          "rgba(255,99,132,0.2)",
          "rgba(54,162,235,0.2)",
          "rgba(255,206,86,0.2)",
          "rgba(75,192,192,0.2)"
        ],
        pointBackgroundColor: [
          "#ff6384",
          "#36a2eb",
          "#ffce56",
          "#4bc0c0"
        ],
        borderWidth: 3
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