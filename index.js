// index.js (Versión final con formato mejorado y links corregidos)

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Credenciales de Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// --- FUNCIONES AUXILIARES ---

// Función para escapar texto para Markdown de Telegram, sin afectar los links.
function escapeMarkdown(text) {
    if (text === null || typeof text === 'undefined') {
        return '';
    }
    // Escapa solo los caracteres que Telegram necesita para evitar errores de formato.
    // Aunque el escapeMarkdown incluye '|', las strings estáticas deben ser escapadas manualmente si se usa MarkdownV2.
    return text.toString().replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
}

// Función mejorada para enviar mensajes a Telegram
async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('|❌| Error: TELEGRAM_BOT_TOKEN no está configurado.');
        return;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: text,
            // Usamos 'MarkdownV2' que es más estricto pero más potente.
            parse_mode: 'MarkdownV2',
        });
        console.log('|☑️| Mensaje de Telegram enviado con éxito.');
    } catch (error) {
        console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

// --- LÓGICA DE TOKEN DE MERCADO LIBRE ---

async function refreshAccessToken(refreshToken) {
    console.log('|🔄| Refrescando el token de acceso...');
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            refresh_token: refreshToken,
        }));
        const data = response.data;
        data.expires_at = Date.now() + (data.expires_in * 1000);
        fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
        console.log('|💾| Token refrescado y guardado.');
        return JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
    } catch (error) {
        console.error('|❌| Error al refrescar el token:', error.message);
        throw new Error('No se pudo refrescar el token.');
    }
}

async function ensureAccessToken() {
    if (!fs.existsSync('tokens.json')) {
        console.log('|⚠️| No existe tokens.json. Se requiere autenticación.');
        return null;
    }
    const tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
    if (Date.now() >= tokens.expires_at - 60000) { // Margen de 1 minuto
        return await refreshAccessToken(tokens.refresh_token);
    }
    return tokens;
}

// --- RUTAS DEL SERVIDOR EXPRESS ---

app.use(express.json());

// 1. Ruta de Autenticación
app.get('/', (req, res) => {
    const redirectURI = encodeURIComponent(process.env.REDIRECT_URI);
    const authURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectURI}`;
    res.send(`<h2>Vincular Bot con Mercado Libre</h2><p><a href="${authURL}">Hacé clic acá para autorizar la conexión</a></p>`);
});

// 2. Ruta Callback
app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Error: Falta el código de autorización.');
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            code,
            redirect_uri: process.env.REDIRECT_URI,
        }));
        const data = response.data;
        data.expires_at = Date.now() + (data.expires_in * 1000);
        fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2));
        
        // Notificar al chat principal si está configurado
        // Modificado: Escapando los '|' del emoji
        if (process.env.TELEGRAM_CHAT_ID) {
            await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, '\\|✅\\| ¡CosmeticaSPA\\-BOT vinculado correctamente a Mercado Libre\\!');
        }
        
        res.send('<h3>¡Cuenta vinculada con éxito!</h3><p>Ya podés cerrar esta ventana y usar el bot en Telegram.</p>');
    } catch (error) {
        console.error('|❌| Error en el callback:', error.message);
        res.status(500).send('Error al obtener el token de Mercado Libre.');
    }
});

// 3. Webhook para notificaciones de Mercado Libre (opcional)
app.post('/webhook', (req, res) => {
    console.log('|📩| Notificación de ML recibida:', req.body);
    res.sendStatus(200);
});


// --- WEBHOOK DE TELEGRAM Y MANEJO DE COMANDOS ---

app.post('/telegram-webhook', async (req, res) => {
    const message = req.body.message;
    if (!message || !message.text) {
        return res.sendStatus(200);
    }

    const text = message.text;
    const chatId = message.chat.id;
    console.log(`|💬| Comando [${text}] recibido del chat [${chatId}]`);

    // --- Comandos públicos ---
    if (text === '/start' || text === '/menu' || text === '/help') {
        // Modificado: Escapando los '|' en el string de menu para MarkdownV2
        const menu = `*\\|👋\\|*\\ Estos son los comandos disponibles:\\\n\\\n` +
                     `*\\|/productinfo\\|* \\- Muestra informacion de tus productos\\.\\\n` +
                     `*\\|/checksales\\|* \\- Revisa las últimas ventas concretadas\\.\\\n` +
                     `*\\|/checkquestions\\|* \\- Muestra preguntas las preguntass pendientes\\.\\\n` +
                     `*\\|/status\\|* \\- Verifica el estado de CosmeticaSPA\\-BOT\\.`;
        await sendTelegramMessage(chatId, menu);
        return res.sendStatus(200);
    }
    
    if (text === '/status') {
        // Modificado: Escapando los '|' del emoji
        await sendTelegramMessage(chatId, '\\|✅\\| CosmeticaSPA\\-BOT está activo y funcionando correctamente\\.');
        return res.sendStatus(200);
    }

    // --- Comandos privados (requieren token) ---
    try {
        const tokens = await ensureAccessToken();
        if (!tokens) {
            // Modificado: Escapando los '|' del emoji
            await sendTelegramMessage(chatId, '\\|⚠️\\| *Error de autenticación*\\.\\\nNecesitás vincular tu cuenta de Mercado Libre primero\\. Visitá la página principal de tu bot para hacerlo\\.');
            return res.sendStatus(200);
        }

        const authHeaders = { 'Authorization': `Bearer ${tokens.access_token}` };

        // --- Comando /productinfo ---
        if (text === '/productinfo') {
            const itemsResponse = await axios.get(`https://api.mercadolibre.com/users/${tokens.user_id}/items/search`, {
                headers: authHeaders,
                params: { status: 'active', limit: 20 }
            });

            const itemIds = itemsResponse.data.results;
            if (itemIds.length === 0) {
                // Modificado: Escapando los '|' del emoji
                await sendTelegramMessage(chatId, '\\|📦\\| No tenés publicaciones activas en este momento\\.');
                return res.sendStatus(200);
            }

            const detailsResponse = await axios.get(`https://api.mercadolibre.com/items`, {
                headers: authHeaders,
                params: { ids: itemIds.join(','), attributes: 'id,title,price,currency_id,available_quantity,sold_quantity,permalink' }
            });

            // Modificado: Escapando los '|' del emoji en el título
            let reply = `*\\|📦\\|* Información de tus ${detailsResponse.data.length} productos más recientes:\\\n\\\n`;
            
            // Modificado: Usando forEach con 'index' para enumerar los productos
            detailsResponse.data.forEach((item, index) => {
                const body = item.body;
                const productIndex = index + 1; // Enumeración a partir de 1

                // Enumeración (se escapa el punto) y título
                reply += `*${productIndex}\\.* *${escapeMarkdown(body.title)}*\n`;
                // Añadimos el ID del producto
                reply += `   *\\|ID\\|:* \`${escapeMarkdown(body.id)}\`\n`; 
                reply += `   *\\|Precio\\|:* ${escapeMarkdown(body.currency_id)} ${escapeMarkdown(body.price)}\n`;
                reply += `   *\\|Stock\\|:* ${escapeMarkdown(body.available_quantity)} \\| *\\|Ventas\\|:* ${escapeMarkdown(body.sold_quantity)}\n`;
                reply += `   *\\[[Ver Producto](${body.permalink})\\]*\n\n`; // Link funcional
            });
            await sendTelegramMessage(chatId, reply);
        }

        // --- Comando /checksales ---
        else if (text === '/checksales') {
            const ordersResponse = await axios.get('https://api.mercadolibre.com/orders/search', {
                headers: authHeaders,
                params: { seller: tokens.user_id, sort: 'date_desc', limit: 5 }
            });
            
            const orders = ordersResponse.data.results;
            if (orders.length === 0) {
                // Modificado: Escapando los '|' del emoji
                await sendTelegramMessage(chatId, '\\|✅\\| No tenes ventas recientes\\.');
            } else {
                // Modificado: Escapando los '|' del emoji en el título
                let reply = '*\\|🛒\\|* Últimas 5 ventas:\\\n\\\n';
                orders.forEach(order => {
                    // Modificado: Escapando los '|' de '|ID|', '|Total|', '|Fecha|'
                    reply += `*\\|ID\\|:* \`${escapeMarkdown(order.id)}\`\n`;
                    reply += `   *\\|Total\\|:* ${escapeMarkdown(order.currency_id)} ${escapeMarkdown(order.total_amount)}\n`;
                    reply += `   *\\|Fecha\\|:* ${escapeMarkdown(new Date(order.date_created).toLocaleString('es-AR'))}\n\n`;
                });
                await sendTelegramMessage(chatId, reply);
            }
        }

        // --- Comando /checkquestions ---
        else if (text === '/checkquestions') {
            const questionsResponse = await axios.get('https://api.mercadolibre.com/questions/search', {
                headers: authHeaders,
                params: { seller_id: tokens.user_id, status: 'UNANSWERED', limit: 5 }
            });
            
            const questions = questionsResponse.data.questions;
            if (questions.length === 0) {
                // Modificado: Escapando los '|' del emoji
                await sendTelegramMessage(chatId, '\\|✅\\| No tenés preguntas pendientes para responder\\.');
            } else {
                // Modificado: Escapando los '|' del emoji en el título
                let reply = '*\\|💬\\|* Preguntas sin responder:\\\n\\\n';
                questions.forEach(q => {
                    reply += `*En el producto:* \`${escapeMarkdown(q.item_id)}\`\n`;
                    reply += `   \\- _"${escapeMarkdown(q.text)}"_\n\n`;
                });
                await sendTelegramMessage(chatId, reply);
            }
        }

        else {
             // Modificado: Escapando los '|' del emoji
             await sendTelegramMessage(chatId, '\\|🤔\\| Comando no reconocido\\. Enviá /menu para ver la lista de comandos\\.');
        }

    } catch (error) {
        console.error('|❌| Error procesando comando:', error.response ? JSON.stringify(error.response.data) : error.message);
        // Modificado: Escapando los '|' del emoji
        await sendTelegramMessage(chatId, '\\|❌\\| Hubo un error al procesar tu solicitud\\. Por favor, revisá los logs del servidor\\.');
    }
    
    res.sendStatus(200);
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`|🚀| Servidor funcionando en http://localhost:${PORT}`);
});
