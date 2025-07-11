require('dotenv').config();
const express = require('express');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();

// Puerto dinámico que asigna Render (o 3000 si es local)
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  const redirectURI = encodeURIComponent(process.env.REDIRECT_URI);
  const authURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectURI}`;
  res.send(`<h2>Vincular cuenta Mercado Libre</h2><a href="${authURL}">Haz clic para vincular tu cuenta</a>`);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Falta el código de autorización.');

  try {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
      console.log('✅ Autenticado correctamente');
      res.send('<h3>Cuenta vinculada correctamente!</h3><p>Ya podés usar la API.</p>');
    } else {
      console.error('Error al obtener token:', data);
      res.status(500).send('Error al obtener token.');
    }
  } catch (error) {
    console.error('Error en la solicitud:', error);
    res.status(500).send('Error interno del servidor.');
  }
});

app.post('/webhook', (req, res) => {
  console.log('Notificación recibida:', req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
