function StatusPanel({ final }) {

  const style = {
    padding: "20px",
    marginTop: "20px",
    fontSize: "24px",
    textAlign: "center",
    backgroundColor: final ? "#ff4d4d" : "#4CAF50",
    color: "white"
  };

  return (
    <div style={style}>
      {final ? "🔴 ANOMALÍA DETECTADA" : "🟢 SIN ANOMALÍAS"}
    </div>
  );
}

export default StatusPanel;