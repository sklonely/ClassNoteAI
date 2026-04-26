import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import "./styles/tokens.css";  // v0.7.0 H18 design tokens (CSS vars)
import "./index.css";          // Tailwind + 舊 reset
import "./styles/global.css";  // v0.7.0 H18 base 用 vars 覆寫 body/scrollbar

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
