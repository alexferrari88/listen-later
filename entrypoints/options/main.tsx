import ReactDOM from "react-dom/client";
import Options from "../../components/Options";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");
const root = ReactDOM.createRoot(rootElement);
root.render(<Options />);
