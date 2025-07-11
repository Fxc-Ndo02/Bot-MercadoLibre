// index.js
require('dotenv').config(); // Cargar variables de entorno
const express = require('express');
const fs = require('fs');
// const fetch = require('node-fetch'); // <-- Eliminado. Usamos fetch nativo de Node.js 22+.

// 3. Crear la app de Express
const app = express();
// Render asigna un puerto dinámico en process.env.PORT. Usamos 3000 para desarrollo local.
const PORT = process.env.PORT || 3000; 

// 4. Middleware para leer JSON en las solicitudes POST
app.use(express.json());

// 5. Ruta inicial para iniciar el flujo de autenticación OAuth
app.get('/', (req, res) => {
  // Aseguramos que el REDIRECT_URI esté correctamente codificado
  const redirectURIEncoded = encodeURIComponent(process.env.REDIRECT_URI);
  const authURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectURIEncoded}`;
  res.send(`<h2>Vincular cuenta Mercado Libre</h2><a href="${authURL}">Haz clic para vincular tu cuenta</a>`);
});

// 6. Ruta callback para recibir el código de autorización y pedir tokens
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Falta el código de autorización.');
  }

  try {
    // Usamos fetch nativo, disponible en Node.js 22
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
      console.log('✅ ¡Autenticado correctamente!');
      console.log('🔐 ACCESS TOKEN:', data.access_token);
      console.log('🔄 REFRESH TOKEN:', data.refresh_token);
      
      // Guardar tokens en archivo
      fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
      console.log('💾 Tokens guardados en tokens.json');
      
      res.send('<h3>Cuenta vinculada correctamente!</h3><p>Ya podés recibir notificaciones y usar la API.</p>');
    } else {
      console.error('❌ Error al obtener token:', data);
      res.status(500).send('No se pudo autenticar. Revisa la consola.');
    }
  } catch (error) {
    console.error('❌ Error en la solicitud de token:', error);
    // Si el error es fetch is not a function, asegúrate de haber actualizado el código
    res.status(500).send('Error interno del servidor.'); 
  }
});

// 7. Ruta webhook para recibir notificaciones de Mercado Libre
app.post('/webhook', (req, res) => {
  console.log('📩 Notificación recibida:', req.body);
  res.sendStatus(200);
});

// 8. Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});
