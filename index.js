// index.js (Usando Axios y añadiendo comandos de Telegram)

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios'); // <-- Usamos Axios para solicitudes HTTP

const app = express();
const PORT = process.env.PORT || 3000; 

// Obtener las credenciales de Telegram desde las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// TELEGRAM_CHAT_ID se usa para enviar notificaciones de Mercado Libre
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 

// Función para enviar mensajes a Telegram
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('|❌| Error: TELEGRAM_BOT_TOKEN no está configurado.');
    return;
  }
  
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    await axios.post(telegramApiUrl, {
      chat_id: chatId,
      text: text,
    });
    console.log('|✅| Notificación de Telegram enviada con éxito.');
  } catch (error) {
    // Manejar errores de Axios, por ejemplo, si el chat_id es inválido o el bot está bloqueado
    console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? error.response.data : error.message);
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
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Falta el código de autorización.');
  }

  try {
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const data = response.data;

    if (data.access_token) {
      if (TELEGRAM_CHAT_ID) {
          await sendTelegramMessage(TELEGRAM_CHAT_ID, '|✅| *¡CosmeticaSPA-BOT se ha vinculado correctamente!*');
      }
      
      console.log('|✅| ¡Autenticado correctamente!');
      fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
      console.log('|💾| Tokens guardados en tokens.json');
      
      res.send('<h3>Cuenta vinculada correctamente!</h3><p>Ya podés recibir notificaciones y usar la API.</p>');
    } else {
      console.error('|❌| Error al obtener token:', data);
      res.status(500).send('No se pudo autenticar. Revisa la consola.');
    }
  } catch (error) {
    console.error('|❌| Error en la solicitud de token:', error);
    res.status(500).send('Error interno del servidor.'); 
  }
});

// 7. Ruta webhook para recibir notificaciones de Mercado Libre
app.post('/webhook', async (req, res) => {
  try {
    console.log('|📩| Notificación de Mercado Libre recibida:', req.body);
    
    if (!TELEGRAM_CHAT_ID) {
        console.error('|❌| "TELEGRAM_CHAT_ID" no configurado. No se puede enviar notificación a Telegram.');
        res.sendStatus(200);
        return;
    }

    const notification = req.body;
    let message = 'Nueva notificación de Mercado Libre recibida.\n';
    
    if (notification.topic === 'questions') {
      message += `|💬| *¡Nueva Pregunta recibida!*\nRecurso: ${notification.resource}`;
    } else if (notification.topic === 'orders_v2') {
      message += `|🛒| *¡Nueva Venta!*\nRecurso: ${notification.resource}`;
    } else {
      message += `Tipo: ${notification.topic}`;
      message += `\nRecurso: ${notification.resource}`;
    }

    await sendTelegramMessage(TELEGRAM_CHAT_ID, message);

    // Confirmar la recepción a Mercado Libre
    res.sendStatus(200); 
  } catch (error) {
    console.error('|❌| Error en el procesamiento del webhook de Mercado Libre:', error);
    res.status(500).send('Error interno del servidor.');
  }
});

// --------------------------------------------------------
// NUEVA RUTA PARA WEBHOOK DE TELEGRAM Y COMANDOS
// --------------------------------------------------------

// Esta ruta recibirá todas las actualizaciones (mensajes, comandos) de Telegram
app.post('/telegram-webhook', async (req, res) => {
    const update = req.body;
    const message = update.message;
    
    if (message && message.text) {
        const chatId = message.chat.id;
        const text = message.text;

        console.log(`|☑️| Comando recibido desde Telegram: ${text} (Chat ID: ${chatId})`);

        // Manejar el comando /status
        if (text === '/status') {
            const statusMessage = `|🤖👋| *CosmeticaSPA-BOT* esta activo\n*-Última verificación:* ${new Date().toLocaleString('es-AR')}`;
            await sendTelegramMessage(chatId, statusMessage);

        // Manejar el comando /menu o /help
        } else if (text === '/menu' || text === '/help') {
            const menuMessage = `
|🛠️| *Comandos Disponibles:*
*/status* - Verifica si el bot está activo en Render.com.
*/menu* - Muestra este menú de comandos.
`;
            // Nota: Aquí enviamos el mensaje con formato Markdown básico si es necesario.
            await sendTelegramMessage(chatId, menuMessage);

        } else {
            // Manejar otros mensajes o comandos no reconocidos
            // Opcional: enviar un mensaje predeterminado si el usuario envía algo que no es un comando
            // await sendTelegramMessage(chatId, 'Hola! Soy tu bot. Envía /menu para ver los comandos.');
        }
    }

    // Responder 200 OK a Telegram para confirmar la recepción
    res.sendStatus(200);
});

// --------------------------------------------------------

// 8. Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});
