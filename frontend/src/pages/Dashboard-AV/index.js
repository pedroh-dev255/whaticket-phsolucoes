import React, { useContext, useEffect } from "react";
import Paper from "@material-ui/core/Paper";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import { makeStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";

import { AuthContext } from "../../context/Auth/AuthContext";
import { i18n } from "../../translate/i18n";

const DashboardAV = () => {
  useEffect(() => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://lookerstudio.google.com/embed/reporting/29b4fb32-5611-4f0e-9a42-6d4eec7e1e7c/page/pM9PD";
    iframe.style.width = "100%";
    iframe.style.height = "100vh";
    iframe.style.border = "none";
    document.getElementById("iframeContainer").appendChild(iframe);
  }, []);

  return (
    <div id="iframeContainer" style={{ height: "100vh" }}></div>
  );
};

export default DashboardAV;
