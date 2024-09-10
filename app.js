const express = require("express");
const bodyParser = require("body-parser");
const twilioRoute = require("./routes/twilioRoute");

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Use the Twilio route at the root path
app.use("/twilio", twilioRoute);
app.use("/", twilioRoute);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
