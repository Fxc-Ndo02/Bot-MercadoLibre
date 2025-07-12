// index.js (Actualizado con comandos de ventas, preguntas e información de productos)

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios'); 

const app = express();
const PORT = process.env.PORT || 3000; 

// Obtener las credenciales de Telegram desde las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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
      // Usamos 'Markdown' para que los mensajes se vean mejor en Telegram
      parse_mode: 'Markdown', 
    });
    console.log('|☑️| Notificación de Telegram enviada con éxito.');
  } catch (error) {
    console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? error.response.data : error.message);
  }
}

// Función para cargar el token de acceso de Mercado Libre
function loadAccessToken() {
    try {
        const tokensData = fs.readFileSync('tokens.json', 'utf8');
        const tokens = JSON.parse(tokensData);
        // Devolvemos el access_token para usarlo en las llamadas a la API
        return tokens.access_token;
    } catch (error) {
        console.error('|❌| Error al cargar el token de acceso de Mercado Libre:', error.message);
        return null;
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
          await sendTelegramMessage(TELEGRAM_CHAT_ID, '|☑️| ¡CosmeticaSPA-BOT se ha vinculado correctamente!');
      }
      
      console.log('|☑️| ¡Autenticado correctamente!');
      // Guardamos el token en tokens.json para usarlo en los comandos
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
        console.error('❌ TELEGRAM_CHAT_ID no configurado. No se puede enviar notificación a Telegram.');
        res.sendStatus(200);
        return;
    }

    const notification = req.body;
    let message = 'Nueva notificación de Mercado Libre recibida.\n';
    
    if (notification.topic === 'questions') {
      message += `|💬| ¡Nueva Pregunta recibida!\nRecurso: ${notification.resource}`;
    } else if (notification.topic === 'orders_v2') {
      message += `|🛒| ¡Nueva Venta!\nRecurso: ${notification.resource}`;
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
// WEBHOOK DE TELEGRAM Y MANEJO DE COMANDOS
// --------------------------------------------------------

app.post('/telegram-webhook', async (req, res) => {
    const update = req.body;
    const message = update.message;
    
    if (message && message.text) {
        const chatId = message.chat.id;
        const text = message.text;

        console.log(`|☑️| Comando recibido desde Telegram: ${text} (Chat ID: ${chatId})`);

        // Comandos que no requieren token
        if (text === '/status') {
            const statusMessage = `|👋🤖| CosmeticaSPA-BOT esta activo\nÚltima verificación: ${new Date().toLocaleString('es-AR')}`;
            await sendTelegramMessage(chatId, statusMessage);
            return res.sendStatus(200);

        } else if (text === '/menu' || text === '/help') {
            const menuMessage = `
|🛠️| Comandos Disponibles:
|/status| - Verifica si CosmeticaSPA-BOT está activo.
|/menu| - Muestra este menú de comandos.
|/checksales| - Verifica si hay ventas recientes.
|/checkquestions| - Verifica si hay preguntas recientes.
|/productinfo <ID>| - Obtiene detalles de un producto.
`;
            await sendTelegramMessage(chatId, menuMessage);
            return res.sendStatus(200);
        }

        // Comandos que requieren el token de Mercado Libre
        const accessToken = loadAccessToken();
        if (!accessToken) {
            await sendTelegramMessage(chatId, '|❌| Error: No se pudo cargar el token de acceso de Mercado Libre. Por favor, ve a la ruta inicial de tu bot en Render para autenticar tu cuenta.');
            return res.sendStatus(200);
        }

        // Manejar /checksales
        if (text === '/checksales') {
            try {
                // Usamos la API de Orders de Mercado Libre
                const response = await axios.get('https://api.mercadolibre.com/orders/search/recent', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                const orders = response.data.results;
                let reply = '|🛒| Ventas Recientes (Últimas 5):\n\n';

                if (orders.length === 0) {
                    reply = 'No se encontraron ventas recientes.';
                } else {
                    orders.slice(0, 5).forEach(order => {
                        reply += `* Venta ID: ${order.id}\n`;
                        reply += `  Estado: ${order.status_detail.status}\n`;
                        reply += `  Total: $${order.total_amount} ${order.currency_id}\n`;
                        reply += `  Fecha: ${new Date(order.date_created).toLocaleString()}\n\n`;
                    });
                }
                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('❌ Error al obtener ventas:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar ventas. Asegúrate de que el token es válido o intenta de nuevo más tarde.');
            }
            return res.sendStatus(200);
        }

        // Manejar /checkquestions
        if (text === '/checkquestions') {
            try {
                // Usamos la API de Questions de Mercado Libre
                const response = await axios.get('https://api.mercadolibre.com/questions/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: { 
                        // Filtramos solo las preguntas sin responder
                        status: 'UNANSWERED' 
                    }
                });

                const questions = response.data.questions;
                let reply = '|💬| Preguntas Pendientes de Responder (Últimas 5):\n\n';

                if (!questions || questions.length === 0) {
                    reply = 'No hay preguntas pendientes de responder.';
                } else {
                    questions.slice(0, 5).forEach(question => {
                        reply += `* Pregunta ID: ${question.id}\n`;
                        reply += `  Item ID: ${question.item_id}\n`;
                        reply += `  Texto: "${question.text}"\n`;
                        reply += `  Fecha: ${new Date(question.date_created).toLocaleString()}\n\n`;
                    });
                }
                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('❌ Error al obtener preguntas:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar preguntas. Asegúrate de que el token es válido o intenta de nuevo más tarde.');
            }
            return res.sendStatus(200);
        }

        // Manejar /productinfo <item_id>
        if (text.startsWith('/productinfo')) {
            const parts = text.split(' ');
            if (parts.length < 2) {
                await sendTelegramMessage(chatId, '|⚠️| Formato incorrecto. Uso: /productinfo [ID_DE_PRODUCTO]');
                return res.sendStatus(200);
            }
            
            const itemId = parts[1];
            
            try {
                // Obtenemos la información principal del ítem
                const itemResponse = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const itemData = itemResponse.data;

                // Obtenemos las visitas de la publicación (Visitas no siempre están disponibles públicamente o requieren permisos especiales, usamos el endpoint de items directamente)
                
                // Nota: El número de ventas se extrae de la propiedad initial_quantity - available_quantity + sold_quantity
                // Pero la API de Mercado Libre simplifica esto con 'sold_quantity' para productos activos.

                let reply = `|📦| Información del Producto:\n\n`;
                reply += `* |Título|: ${itemData.title}\n`;
                reply += `* |ID|: ${itemData.id}\n`;
                reply += `* |Estado de la publicación|: ${itemData.status}\n`;
                reply += `* |Precio|: ${itemData.currency_id} ${itemData.price}\n`;
                reply += `* |Stock disponible|: ${itemData.available_quantity}\n`;
                reply += `* |Ventas totales| (aproximadas): ${itemData.sold_quantity}\n`;
                // No es posible obtener "visitas" directamente desde el endpoint /items/ID, se omite por ahora.
                reply += `* |Ver publicación|: ${itemData.permalink}\n`;

                await sendTelegramMessage(chatId, reply);

            } catch (error) {
                console.error('|❌| Error al obtener información del producto:', error.response ? error.response.data : error.message);
                if (error.response && error.response.status === 404) {
                    await sendTelegramMessage(chatId, `|❌| Producto con ID ${itemId} no encontrado o no autorizado.`);
                } else {
                    await sendTelegramMessage(chatId, '|❌| Error al verificar información del producto. Asegúrate de que el ID es correcto y el token es válido.');
                }
            }
            return res.sendStatus(200);
        }

        // Manejar mensajes no reconocidos después de intentar procesar comandos con token
        // Si llegamos aquí, el mensaje no fue /status, /menu, /help, /checksales, /checkquestions o /productinfo.
        await sendTelegramMessage(chatId, 'Comando no reconocido. Envía /menu para ver los comandos disponibles.');
        return res.sendStatus(200);
    }

    // Si el mensaje no tiene texto (por ejemplo, una imagen), respondemos 200 OK
    res.sendStatus(200);
});

// 8. Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});
