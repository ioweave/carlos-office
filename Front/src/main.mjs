import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppProvider } from "./AppContext";
import "./styles/main.scss";
import "./styles/process-graph.scss";

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(AppProvider, null, React.createElement(App)),
  ),
);
