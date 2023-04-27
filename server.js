const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const sheets = google.sheets('v4');

const express = require('express');
const session = require('express-session');
const request = require('request');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
require('dotenv').config()

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const redirect_uri = 'http://localhost:8888/callback';
const stateKey = 'spotify_auth_state';

let oneDay = 1000 * 60 * 60 * 24;
let app = express();
let sess;
let code = null;

app.use(express.static(__dirname + '/public'))
  .use(express.json())
  .use(express.urlencoded({ extended: true }))
  .use(cors())
  .use(cookieParser())
  .use(session({
    secret: generateRandomString(16),
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: true,
      maxAge: oneDay,
    }
  }));

app.get('/login', function(req, res) {

  req.session.state = generateRandomString(16);
  sess = req.session;

  const scope = 'user-read-recently-played user-read-currently-playing';

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: process.env.CLIENT_ID,
      scope: scope,
      redirect_uri: redirect_uri,
      state: req.session.state
    }));
});

app.get('/get-recent', function(req, res) {

  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (new Buffer.from(process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET).toString('base64'))
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {

      var access_token = body.access_token,
          refresh_token = body.refresh_token;

      var getRecentPlays = {
        url: 'https://api.spotify.com/v1/me/player/recently-played?limit=50',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
      };

      request.get(getRecentPlays, function(error, response, body) {

        var history = body.items;
        var data = [];

        for(var i = 0; i< history.length; i++) {

          var songName = history[i].track.name;
          var artistName = history[i].track.artists[0].name;
          var albumName = history[i].track.album.name;
          var timePlayed = history[i].played_at;

          let row = [songName, artistName, albumName, timePlayed];
          data.push(row);
        }

        // send spotify music history to client
        res.json(history);

        // authenticate for drive api
        authorize(authClient => {

          appendToSheet(authClient, data);
        });

        // authorize().then(appendToSheet).then(
        //   function (result) {
        //     console.log(result.data)
        //   }
        // );
      });

    } else {
      res.redirect('/#' +
        querystring.stringify({
          error: 'invalid_token'
        }));

      console.log("error invalid token");
    }
  });
});

app.get('/callback', function(req, res) {

  const state = req.query.state;
  const storedState = sess.state;
  code = req.query.code || null;

  if (state != storedState) return res.status(401).send("Invalid state");

  if (state === null) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));

    console.log("error: state mismatch");
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer.from(process.env.CLIENT_ID + ':' + process.env.CLIENT_SECRET).toString('base64'))
      },
      json: true
    };

    console.log("ready for spotify api requests");
  }

  res.redirect('/');
});

function generateRandomString(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};


// drive api 
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

// drive api 
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

// drive api 
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  
  if (client) {
    console.log('drive api client already exists');
    return client;
  }

  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  
  if (client.credentials) {
    console.log('drive api credentials were stored')
    await saveCredentials(client);
  }

  return client;
}

// drive api
async function getSpecificSheet(authClient) {
  var spreadsheetId = process.env.SPREADSHEET_ID;
  var range = "Sheet1";

  const service = google.sheets({version: 'v4', auth: authClient});

  const result = await service.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  
  const numRows = result.data.values ? result.data.values.length : 0;
  
  console.log(numRows + ' rows in sheet\n');  
  return result;
}

// drive api
async function appendToSheet(authClient, data) {

  const request = {
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Sheet1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: {
      "majorDimension": "ROWS",
      "values": data,
    },
    auth: authClient,
  }

  const response = await sheets.spreadsheets.values.append(request);

  return response;
}

app.listen(8888);
console.log("Listening on 8888\n");