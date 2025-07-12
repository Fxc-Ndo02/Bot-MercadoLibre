// index.js 

require('dotenv').config();
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000; 

// Obtener las credenciales de Telegram desde las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Función para enviar mensajes a Telegram
async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no están configurados.');
    return;
  }

  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    // Usamos fetch nativo de Node.js para enviar el mensaje a la API de Telegram
    await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
      }),
    });
    console.log('✅ Notificación de Telegram enviada con éxito.');
  } catch (error) {
    console.error('❌ Error al enviar mensaje a Telegram:', error);
  }
}

// 4. Middleware para leer JSON
app.use(express.json());

// 5. Ruta inicial para iniciar el flujo de autenticación OAuth
app.get('/', (req, res) => {
  const redirectURIEncoded = encodeURIComponent(process.env.REDIRECT_URI);
  const authURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectURIEncoded}`;
  res.send(`<h2>Vincular cuenta Mercado Libre</h2><a href="${authURL}">Haz clic para vincular tu cuenta</a>`);
});

// 6. Ruta callback para recibir el código de autorización y pedir tokens
// (Esta ruta se mantiene igual que la versión mejorada anterior)
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Falta el código de autorización.');
  }

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
      // Envía una notificación a Telegram cuando la cuenta se vincule
      sendTelegramMessage('✅ ¡Tu bot de Mercado Libre se ha vinculado correctamente!');
      
      console.log('✅ ¡Autenticado correctamente!');
      console.log('🔐 ACCESS TOKEN:', data.access_token);
      console.log('🔄 REFRESH TOKEN:', data.refresh_token);
      
      fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
      console.log('💾 Tokens guardados en tokens.json');
      
      res.send('<h3>Cuenta vinculada correctamente!</h3><p>Ya podés recibir notificaciones y usar la API.</p>');
    } else {
      console.error('❌ Error al obtener token:', data);
      res.status(500).send('No se pudo autenticar. Revisa la consola.');
    }
  } catch (error) {
    console.error('❌ Error en la solicitud de token:', error);
    res.status(500).send('Error interno del servidor.'); 
  }
});

// 7. Ruta webhook para recibir notificaciones de Mercado Libre
app.post('/webhook', (req, res) => {
  console.log('📩 Notificación de Mercado Libre recibida:', req.body);

  const notification = req.body;
  let message = 'Nueva notificación de Mercado Libre recibida.\n';
  
  // Analizar la notificación y preparar un mensaje detallado para Telegram
  if (notification.topic === 'questions') {
    message += `💬 ¡Nueva Pregunta recibida!\nRecurso: ${notification.resource}`;
  } else if (notification.topic === 'orders_v2') {
    message += `🛒 ¡Nueva Venta!\nRecurso: ${notification.resource}`;
  } else {
    message += `Tipo: ${notification.topic}`;
    message += `\nRecurso: ${notification.resource}`;
  }

  // Enviar el mensaje a Telegram
  sendTelegramMessage(message);

  // Confirmar la recepción a Mercado Libre
  res.sendStatus(200); 
});

// 8. Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});
