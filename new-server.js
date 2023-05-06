require('dotenv').config('.env');
const express = require('express');
const { auth } = require('express-openid-connect');
const app = express();
const { PORT = 8888 } = process.env;
app.use(express.json());
app.use(express.urlencoded({extended:true}));

const {MY_SECRET, BASE_URL, AUTH0_CLIENT_ID, AUTH0_DOMAIN} = process.env;

const config = {
    authRequired: false,
    auth0Logout: true,
    secret: MY_SECRET,
    baseURL: BASE_URL,
    clientID: AUTH0_CLIENT_ID,
    issuerBaseURL: AUTH0_DOMAIN,
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

// req.isAuthenticated is provided from the auth router
app.get('/', (req, res) => {
  res.send(req.oidc.isAuthenticated() ? 'Logged in' : 'Logged out');
});

app.listen(PORT, () => {
  console.log(`Server is ready at http://localhost:${PORT}`);
});