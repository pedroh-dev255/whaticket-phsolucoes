import React, { useContext, useEffect } from "react";
import Paper from "@material-ui/core/Paper";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import { makeStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";

import useTickets from "../../hooks/useTickets";
import { AuthContext } from "../../context/Auth/AuthContext";
import { i18n } from "../../translate/i18n";

const useStyles = makeStyles((theme) => ({
  container: {
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(4),
  },
  fixedHeightPaper: {
    padding: theme.spacing(2),
    display: "flex",
    overflow: "auto",
    flexDirection: "column",
    height: 240,
  },
  customFixedHeightPaper: {
    padding: theme.spacing(2),
    display: "flex",
    overflow: "auto",
    flexDirection: "column",
    height: 120,
  },
  customFixedHeightPaperLg: {
    padding: theme.spacing(2),
    display: "flex",
    overflow: "auto",
    flexDirection: "column",
    height: "100%",
  },
  fullHeight: {
    height: "100vh",
  },
}));


const DashboardAV = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);

  useEffect(() => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://lookerstudio.google.com/s/r7DxPAMyhS8";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    document.getElementById("iframeContainer").appendChild(iframe);
  }, []);

  return (
    <div>
      <Container maxWidth="lg" className={classes.container}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Paper
              className={classes.fixedHeightPaper}
              id="iframeContainer"
            ></Paper>
          </Grid>
        </Grid>
      </Container>
    </div>
  );
};

export default DashboardAV;
