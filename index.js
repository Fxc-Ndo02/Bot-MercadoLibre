// index.js (Versión mejorada y corregida)

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Obtener las credenciales de Telegram desde las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Función auxiliar para escapar caracteres especiales de Markdown
function escapeMarkdown(text) {
    if (text === null || text === undefined) {
        return '';
    }
    // Escapa caracteres especiales para Markdown V1/V2 de Telegram
    return text.toString().replace(/([_*`[\]()~>#+=|{}.!-])/g, '\\$1');
}


// Función para enviar mensajes a Telegram (con estilo y Markdown)
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
      parse_mode: 'Markdown', 
    });
    console.log('|☑️| Notificación de Telegram enviada con éxito.');
  } catch (error) {
    console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? error.response.data : error.message);
  }
}

// --- LÓGICA DE TOKEN DE ACCESO Y RENOVACIÓN ---

// Función para refrescar el token de acceso
async function refreshAccessToken(refreshToken) {
    console.log('|🔄| Intentando refrescar el token de acceso...');
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', 
            new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                refresh_token: refreshToken,
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );
       
        const data = response.data;
        data.expires_at = Date.now() + (data.expires_in * 1000); 

        fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
        console.log('|💾| Token de acceso refrescado y guardado.');
        return data.access_token;

    } catch (error) {
        console.error('|❌| Error al refrescar el token:', error.response ? error.response.data : error.message);
        throw new Error('Error al refrescar el token de acceso.');
    }
}

// Función para asegurar que tenemos un token válido
async function ensureAccessToken() {
    try {
        if (!fs.existsSync('tokens.json')) {
            console.error('|❌| El archivo tokens.json no existe. Autenticación requerida.');
            return null;
        }

        const tokensData = fs.readFileSync('tokens.json', 'utf8');
        let tokens = JSON.parse(tokensData);
       
        // Verificar si el token está a punto de expirar (margen de 1 minuto)
        if (tokens.expires_at && Date.now() >= tokens.expires_at - 60000) {
            console.log('|⏳| El token de acceso ha expirado o está a punto de expirar.');
           
            await refreshAccessToken(tokens.refresh_token);
            tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8')); // Recargar tokens actualizados
        }

        return tokens;

    } catch (error) {
        console.error('|❌| Error al verificar o cargar el token de acceso:', error.message);
        return null;
    }
}

// --------------------------------------------------------

// Funciones Auxiliares para /productinfo
async function getUserItems(userId, accessToken) {
    const response = await axios.get(`https://api.mercadolibre.com/users/${userId}/items/search`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: { status: 'active', limit: 50 } 
    });
    return response.data.results; 
}

async function getItemsDetails(itemIds, accessToken) {
    if (itemIds.length === 0) return [];
   
    const url = `https://api.mercadolibre.com/items?ids=${itemIds.join(',')}&attributes=id,title,price,available_quantity,sold_quantity,status,permalink,currency_id`;
   
    const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
   
    return response.data.map(result => result.body).filter(item => item !== undefined); 
}

// --------------------------------------------------------

// Middleware para leer JSON
app.use(express.json());

// Ruta inicial para iniciar el flujo de autenticación OAuth
app.get('/', (req, res) => {
  const redirectURIEncoded = encodeURIComponent(process.env.REDIRECT_URI);
  const authURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectURIEncoded}`;
  res.send(`<h2>Vincular cuenta Mercado Libre</h2><a href="${authURL}">Haz clic para vincular tu cuenta</a>`);
});

// Ruta callback para recibir el código de autorización y pedir tokens
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
     
      data.expires_at = Date.now() + (data.expires_in * 1000); 

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

// Ruta webhook para recibir notificaciones de Mercado Libre
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
      message += `|💬| ¡Nueva Pregunta recibida!\nRecurso: ${notification.resource}`;
    } else if (notification.topic === 'orders_v2') {
      message += `|🛒| ¡Nueva Venta!\nRecurso: ${notification.resource}`;
    } else {
      message += `Tipo: ${notification.topic}`;
      message += `\nRecurso: ${notification.resource}`;
    }

    await sendTelegramMessage(TELEGRAM_CHAT_ID, message);
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
            const statusMessage = `|🤖👋| CosmeticaSPA-BOT esta activo\n-Última verificación: ${new Date().toLocaleString('es-AR')}`;
            await sendTelegramMessage(chatId, statusMessage);
            return res.sendStatus(200);

        } else if (text === '/menu' || text === '/help') {
            const menuMessage = `
|🛠️| **Comandos Disponibles:**
/status - Verifica si CosmeticaSPA-BOT está activo.
/menu - Muestra este menú de comandos.
/checksales - Verifica si hay ventas recientes.
/checkquestions - Verifica si hay preguntas recientes.
/productinfo - Obtiene información de tus productos activos.
`;
            await sendTelegramMessage(chatId, menuMessage);
            return res.sendStatus(200);
        }

        // --- Comandos que requieren el token de Mercado Libre ---
        const tokens = await ensureAccessToken(); 

        if (!tokens || !tokens.access_token) {
            await sendTelegramMessage(chatId, '|⚠️| *Token de Mercado Libre no encontrado o no válido.* Por favor, visita la URL de tu bot para autenticar tu cuenta.');
            return res.sendStatus(200);
        }
       
        const accessToken = tokens.access_token;
        const userId = tokens.user_id;

        // Manejar /checksales
        if (text === '/checksales') {
            try {
                const response = await axios.get('https://api.mercadolibre.com/orders/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: {
                        seller: userId,
                        sort: 'date_desc' 
                    }
                });

                const orders = response.data.results;
                let reply = '|🛒| **Ventas Recientes (Últimas 5):**\n\n';

                if (orders.length === 0) {
                    reply = '|🔎| No se encontraron ventas recientes.';
                } else {
                    orders.slice(0, 5).forEach(order => {
                        const statusText = order.status || (order.status_detail ? order.status_detail.status : 'Desconocido');
                       
                        // **MEJORA**: Escapamos el '*' de la viñeta para evitar errores de Markdown en Telegram
                        reply += `\\* Venta ID: ${escapeMarkdown(order.id)}\n`;
                        reply += `  Estado: ${escapeMarkdown(statusText)}\n`;
                        reply += `  Total: ${escapeMarkdown(order.currency_id)} ${escapeMarkdown(order.total_amount)}\n`;
                        reply += `  Fecha: ${escapeMarkdown(new Date(order.date_created).toLocaleString())}\n\n`;
                    });
                }
                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('|❌| Error al obtener ventas:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar ventas. Asegúrate de que el token es válido o intenta de nuevo más tarde.');
            }
            return res.sendStatus(200);
        }

        // Manejar /checkquestions
        if (text === '/checkquestions') {
            try {
                const response = await axios.get('https://api.mercadolibre.com/questions/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: { 
                        status: 'UNANSWERED',
                        seller_id: userId 
                    }
                });

                const questions = response.data.questions;
                let reply = '|💬| **Preguntas Pendientes de Responder (Últimas 5):**\n\n';

                if (!questions || questions.length === 0) {
                    reply = '|🔎| No hay preguntas pendientes de responder.';
                } else {
                    questions.slice(0, 5).forEach(question => {
                        // **MEJORA**: Escapamos el '*' de la viñeta para evitar errores de Markdown
                        reply += `\\* Pregunta ID: ${escapeMarkdown(question.id)}\n`;
                        reply += `  Item ID: ${escapeMarkdown(question.item_id)}\n`;
                        reply += `  Texto: "${escapeMarkdown(question.text)}"\n`;
                        reply += `  Fecha: ${escapeMarkdown(new Date(question.date_created).toLocaleString())}\n\n`;
                    });
                }
                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('|❌| Error al obtener preguntas:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar preguntas. Asegúrate de que el token es válido o intenta de nuevo más tarde.');
            }
            return res.sendStatus(200);
        }

        // Manejar /productinfo
        if (text === '/productinfo') {
            try {
                const itemIds = await getUserItems(userId, accessToken);

                if (itemIds.length === 0) {
                    await sendTelegramMessage(chatId, '|🔎| No se encontraron publicaciones activas en tu cuenta.');
                    return res.sendStatus(200);
                }

                const itemsDetails = await getItemsDetails(itemIds, accessToken);
                let reply = `|📦| **Información de ${itemsDetails.length} Productos Activos:**\n\n`;

                itemsDetails.forEach(item => {
                    reply += `**${escapeMarkdown(item.title)}**\n`;
                    // **MEJORA**: Escapamos el '*' de la viñeta para evitar errores de Markdown
                    reply += `\\* ID: ${escapeMarkdown(item.id)}\n`;
                    reply += `\\* Precio: ${escapeMarkdown(item.currency_id)} ${escapeMarkdown(item.price)}\n`;
                    reply += `\\* Stock disponible: ${escapeMarkdown(item.available_quantity)}\n`;
                    reply += `\\* Ventas totales: ${escapeMarkdown(item.sold_quantity)}\n`;
                    reply += `\\* Estado: ${escapeMarkdown(item.status)}\n`;
                    reply += `\\* Ver: ${escapeMarkdown(item.permalink)}\n\n`;
                });

                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('|❌| Error al obtener información de productos:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar información de productos. Hubo un problema al consultar la API.');
            }
            return res.sendStatus(200);
        }
       
        // Manejar mensajes no reconocidos
        await sendTelegramMessage(chatId, '|❓| Comando no reconocido. Envía /menu para ver los comandos disponibles.');
        return res.sendStatus(200);
    }

    // Si el update de Telegram no es un mensaje con texto, respondemos 200 OK
    res.sendStatus(200);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});// index.js (Versión mejorada y corregida)

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Obtener las credenciales de Telegram desde las variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Función auxiliar para escapar caracteres especiales de Markdown
function escapeMarkdown(text) {
    if (text === null || text === undefined) {
        return '';
    }
    // Escapa caracteres especiales para Markdown V1/V2 de Telegram
    return text.toString().replace(/([_*`[\]()~>#+=|{}.!-])/g, '\\$1');
}


// Función para enviar mensajes a Telegram (con estilo y Markdown)
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
      parse_mode: 'Markdown', 
    });
    console.log('|☑️| Notificación de Telegram enviada con éxito.');
  } catch (error) {
    console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? error.response.data : error.message);
  }
}

// --- LÓGICA DE TOKEN DE ACCESO Y RENOVACIÓN ---

// Función para refrescar el token de acceso
async function refreshAccessToken(refreshToken) {
    console.log('|🔄| Intentando refrescar el token de acceso...');
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', 
            new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                refresh_token: refreshToken,
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );
       
        const data = response.data;
        data.expires_at = Date.now() + (data.expires_in * 1000); 

        fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
        console.log('|💾| Token de acceso refrescado y guardado.');
        return data.access_token;

    } catch (error) {
        console.error('|❌| Error al refrescar el token:', error.response ? error.response.data : error.message);
        throw new Error('Error al refrescar el token de acceso.');
    }
}

// Función para asegurar que tenemos un token válido
async function ensureAccessToken() {
    try {
        if (!fs.existsSync('tokens.json')) {
            console.error('|❌| El archivo tokens.json no existe. Autenticación requerida.');
            return null;
        }

        const tokensData = fs.readFileSync('tokens.json', 'utf8');
        let tokens = JSON.parse(tokensData);
       
        // Verificar si el token está a punto de expirar (margen de 1 minuto)
        if (tokens.expires_at && Date.now() >= tokens.expires_at - 60000) {
            console.log('|⏳| El token de acceso ha expirado o está a punto de expirar.');
           
            await refreshAccessToken(tokens.refresh_token);
            tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8')); // Recargar tokens actualizados
        }

        return tokens;

    } catch (error) {
        console.error('|❌| Error al verificar o cargar el token de acceso:', error.message);
        return null;
    }
}

// --------------------------------------------------------

// Funciones Auxiliares para /productinfo
async function getUserItems(userId, accessToken) {
    const response = await axios.get(`https://api.mercadolibre.com/users/${userId}/items/search`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: { status: 'active', limit: 50 } 
    });
    return response.data.results; 
}

async function getItemsDetails(itemIds, accessToken) {
    if (itemIds.length === 0) return [];
   
    const url = `https://api.mercadolibre.com/items?ids=${itemIds.join(',')}&attributes=id,title,price,available_quantity,sold_quantity,status,permalink,currency_id`;
   
    const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
   
    return response.data.map(result => result.body).filter(item => item !== undefined); 
}

// --------------------------------------------------------

// Middleware para leer JSON
app.use(express.json());

// Ruta inicial para iniciar el flujo de autenticación OAuth
app.get('/', (req, res) => {
  const redirectURIEncoded = encodeURIComponent(process.env.REDIRECT_URI);
  const authURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectURIEncoded}`;
  res.send(`<h2>Vincular cuenta Mercado Libre</h2><a href="${authURL}">Haz clic para vincular tu cuenta</a>`);
});

// Ruta callback para recibir el código de autorización y pedir tokens
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
     
      data.expires_at = Date.now() + (data.expires_in * 1000); 

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

// Ruta webhook para recibir notificaciones de Mercado Libre
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
      message += `|💬| ¡Nueva Pregunta recibida!\nRecurso: ${notification.resource}`;
    } else if (notification.topic === 'orders_v2') {
      message += `|🛒| ¡Nueva Venta!\nRecurso: ${notification.resource}`;
    } else {
      message += `Tipo: ${notification.topic}`;
      message += `\nRecurso: ${notification.resource}`;
    }

    await sendTelegramMessage(TELEGRAM_CHAT_ID, message);
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
            const statusMessage = `|🤖👋| CosmeticaSPA-BOT esta activo\n-Última verificación: ${new Date().toLocaleString('es-AR')}`;
            await sendTelegramMessage(chatId, statusMessage);
            return res.sendStatus(200);

        } else if (text === '/menu' || text === '/help') {
            const menuMessage = `
|🛠️| **Comandos Disponibles:**
/status - Verifica si CosmeticaSPA-BOT está activo.
/menu - Muestra este menú de comandos.
/checksales - Verifica si hay ventas recientes.
/checkquestions - Verifica si hay preguntas recientes.
/productinfo - Obtiene información de tus productos activos.
`;
            await sendTelegramMessage(chatId, menuMessage);
            return res.sendStatus(200);
        }

        // --- Comandos que requieren el token de Mercado Libre ---
        const tokens = await ensureAccessToken(); 

        if (!tokens || !tokens.access_token) {
            await sendTelegramMessage(chatId, '|⚠️| *Token de Mercado Libre no encontrado o no válido.* Por favor, visita la URL de tu bot para autenticar tu cuenta.');
            return res.sendStatus(200);
        }
       
        const accessToken = tokens.access_token;
        const userId = tokens.user_id;

        // Manejar /checksales
        if (text === '/checksales') {
            try {
                const response = await axios.get('https://api.mercadolibre.com/orders/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: {
                        seller: userId,
                        sort: 'date_desc' 
                    }
                });

                const orders = response.data.results;
                let reply = '|🛒| **Ventas Recientes (Últimas 5):**\n\n';

                if (orders.length === 0) {
                    reply = '|🔎| No se encontraron ventas recientes.';
                } else {
                    orders.slice(0, 5).forEach(order => {
                        const statusText = order.status || (order.status_detail ? order.status_detail.status : 'Desconocido');
                       
                        // **MEJORA**: Escapamos el '*' de la viñeta para evitar errores de Markdown en Telegram
                        reply += `\\* Venta ID: ${escapeMarkdown(order.id)}\n`;
                        reply += `  Estado: ${escapeMarkdown(statusText)}\n`;
                        reply += `  Total: ${escapeMarkdown(order.currency_id)} ${escapeMarkdown(order.total_amount)}\n`;
                        reply += `  Fecha: ${escapeMarkdown(new Date(order.date_created).toLocaleString())}\n\n`;
                    });
                }
                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('|❌| Error al obtener ventas:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar ventas. Asegúrate de que el token es válido o intenta de nuevo más tarde.');
            }
            return res.sendStatus(200);
        }

        // Manejar /checkquestions
        if (text === '/checkquestions') {
            try {
                const response = await axios.get('https://api.mercadolibre.com/questions/search', {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    params: { 
                        status: 'UNANSWERED',
                        seller_id: userId 
                    }
                });

                const questions = response.data.questions;
                let reply = '|💬| **Preguntas Pendientes de Responder (Últimas 5):**\n\n';

                if (!questions || questions.length === 0) {
                    reply = '|🔎| No hay preguntas pendientes de responder.';
                } else {
                    questions.slice(0, 5).forEach(question => {
                        // **MEJORA**: Escapamos el '*' de la viñeta para evitar errores de Markdown
                        reply += `\\* Pregunta ID: ${escapeMarkdown(question.id)}\n`;
                        reply += `  Item ID: ${escapeMarkdown(question.item_id)}\n`;
                        reply += `  Texto: "${escapeMarkdown(question.text)}"\n`;
                        reply += `  Fecha: ${escapeMarkdown(new Date(question.date_created).toLocaleString())}\n\n`;
                    });
                }
                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('|❌| Error al obtener preguntas:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar preguntas. Asegúrate de que el token es válido o intenta de nuevo más tarde.');
            }
            return res.sendStatus(200);
        }

        // Manejar /productinfo
        if (text === '/productinfo') {
            try {
                const itemIds = await getUserItems(userId, accessToken);

                if (itemIds.length === 0) {
                    await sendTelegramMessage(chatId, '|🔎| No se encontraron publicaciones activas en tu cuenta.');
                    return res.sendStatus(200);
                }

                const itemsDetails = await getItemsDetails(itemIds, accessToken);
                let reply = `|📦| **Información de ${itemsDetails.length} Productos Activos:**\n\n`;

                itemsDetails.forEach(item => {
                    reply += `**${escapeMarkdown(item.title)}**\n`;
                    // **MEJORA**: Escapamos el '*' de la viñeta para evitar errores de Markdown
                    reply += `\\* ID: ${escapeMarkdown(item.id)}\n`;
                    reply += `\\* Precio: ${escapeMarkdown(item.currency_id)} ${escapeMarkdown(item.price)}\n`;
                    reply += `\\* Stock disponible: ${escapeMarkdown(item.available_quantity)}\n`;
                    reply += `\\* Ventas totales: ${escapeMarkdown(item.sold_quantity)}\n`;
                    reply += `\\* Estado: ${escapeMarkdown(item.status)}\n`;
                    reply += `\\* Ver: ${escapeMarkdown(item.permalink)}\n\n`;
                });

                await sendTelegramMessage(chatId, reply);
            } catch (error) {
                console.error('|❌| Error al obtener información de productos:', error.response ? error.response.data : error.message);
                await sendTelegramMessage(chatId, '|❌| Error al verificar información de productos. Hubo un problema al consultar la API.');
            }
            return res.sendStatus(200);
        }
       
        // Manejar mensajes no reconocidos
        await sendTelegramMessage(chatId, '|❓| Comando no reconocido. Envía /menu para ver los comandos disponibles.');
        return res.sendStatus(200);
    }

    // Si el update de Telegram no es un mensaje con texto, respondemos 200 OK
    res.sendStatus(200);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en http://localhost:${PORT}`);
});
