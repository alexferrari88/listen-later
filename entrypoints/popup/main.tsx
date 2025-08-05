import ReactDOM from "react-dom/client";
import Popup from "../../components/Popup";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");
const root = ReactDOM.createRoot(rootElement);
root.render(<Popup />);
