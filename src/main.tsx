import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppUpdateProvider } from "./features/update/AppUpdateProvider";
import "./styles/globals.css";
import "./styles/runtime-console.css";
import "./styles/settings-desktop.css";
import "./styles/terminal-chat-prompt.css";
import "./styles/terminal-dock.css";
import "./styles/workspace-right-panel.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppUpdateProvider>
        <App />
      </AppUpdateProvider>
    </BrowserRouter>
  </React.StrictMode>
);
