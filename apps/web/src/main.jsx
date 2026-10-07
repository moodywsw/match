import React from "react";
import { createRoot } from "react-dom/client";
import MatchApp from "./MatchApp.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MatchApp />
  </React.StrictMode>
);
