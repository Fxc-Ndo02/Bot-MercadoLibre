// index.js 

require('dotenv').config(); 
const express = require('express'); 
const fs = require('fs'); 
const { escapeMarkdown, sendTelegramMessage } = require('./utils/telegram'); 
const { ensureAccessToken, answerQuestion, updateItemStock, getShipmentTracking } = require('./utils/mercadolibre'); 
const { userContexts } = require('./utils/state'); 
const axios = require('axios'); 

const app = express(); 
const PORT = process.env.PORT || 3000; 

app.use(express.json()); 

// --- Rutas de Autenticación de Mercado Libre --- 

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
         
        // Guardar el token inicial 
        fs.writeFileSync('tokens.json', JSON.stringify(data, null, 2)); 

        if (process.env.TELEGRAM_CHAT_ID) { 
            await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, '\\|✅\\| ¡CosmeticaSPA\\-BOT vinculado correctamente a Mercado Libre\\!'); 
        } 
         
        res.send('<h3>¡Cuenta vinculada con éxito!</h3><p>Ya podés cerrar esta ventana y usar el bot en Telegram.</p>'); 
    } catch (error) { 
        console.error('|❌| Error en el callback:', error.message); 
        res.status(500).send('Error al obtener el token de Mercado Libre.'); 
    } 
}); 

// --- Webhooks de Mercado Libre (Notificaciones en Tiempo Real) --- 

app.post('/webhook', async (req, res) => { 
    const notification = req.body; 
    console.log('|📩| Notificación de ML recibida:', notification.topic); 

    const tokens = await ensureAccessToken(); 
    if (!tokens) { 
        console.error('|⚠️| Notificación recibida, pero no hay token de ML para procesarla.'); 
        return res.sendStatus(200); 
    } 

    try { 
        const authHeaders = { 'Authorization': `Bearer ${tokens.access_token}` }; 

        if (notification.topic === 'questions') { 
            // Notificación de nueva pregunta 
            const questionId = notification.resource.split('/').pop(); 
            const questionResponse = await axios.get(`https://api.mercadolibre.com/questions/${questionId}`, { headers: authHeaders }); 
            const question = questionResponse.data; 

            const message = `*\\|❓\\| Nueva pregunta recibida:*\\\n\\\n` + 
                           `*Producto:* ${escapeMarkdown(question.item_id)}\\\n` + 
                           `*Pregunta:* _"${escapeMarkdown(question.text)}"_\\\n\\\n` + 
                           `Puedes responder esta pregunta directamente usando: \`/responder ${questionId}\``; 
             
            // AGREGAR BOTÓN INLINE 
            const inlineKeyboard = { 
                inline_keyboard: [ 
                    [ 
                        { 
                          text: "Responder pregunta", 
                          callback_data: `answer_${questionId}` 
                        } 
                    ] 
                ] 
            }; 

            await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, message, { 
                reply_markup: inlineKeyboard 
            }); 

        } else if (notification.topic === 'orders_v2') { 
            // Notificación de nueva venta 
            const orderId = notification.resource.split('/').pop(); 
            const orderResponse = await axios.get(`https://api.mercadolibre.com/orders/${orderId}`, { headers: authHeaders }); 
            const order = orderResponse.data; 

            let shipmentMessage = ''; 
            if (order.shipping && order.shipping.id) { 
                // Si existe un ID de envío, agregamos el comando para seguimiento 
                shipmentMessage = `*ID de Envío:* \`${escapeMarkdown(order.shipping.id)}\`\\\n` + 
                                 `*Seguimiento:* \`/checkshipment ${escapeMarkdown(order.shipping.id)}\`\n`; 
            } 

            const message = `*\\|🛒\\| ¡Nueva venta recibida!*\\\n\\\n` + 
                           `*ID de venta:* \`${escapeMarkdown(order.id)}\`\\\n` + 
                           `*Total:* ${escapeMarkdown(order.currency_id)} ${escapeMarkdown(order.total_amount)}\\\n` + 
                           `*Comprador:* ${escapeMarkdown(order.buyer.nickname)}\\\n\\\n` + 
                           `${shipmentMessage}` + 
                           `*Estado:* ${escapeMarkdown(order.status)}`; 

            await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID, message); 
        } 
    } catch (error) { 
        console.error('|❌| Error procesando webhook:', error.message); 
    } 

    res.sendStatus(200); 
}); 

// --- Webhook de Telegram y Manejo de Comandos --- 

app.post('/telegram-webhook', async (req, res) => { 
    const message = req.body.message; 
    const callbackQuery = req.body.callback_query; 

    let chatId; 
    let text; 
    let queryId; 

    if (message && message.text) { 
        // Manejo de mensaje de texto normal 
        chatId = message.chat.id; 
        text = message.text; 
        console.log(`|💬| Comando [${text}] recibido del chat [${chatId}]`); 
    } else if (callbackQuery && callbackQuery.data) { 
        // Manejo de botón presionado (callback_query) 
        chatId = callbackQuery.message.chat.id; 
        text = callbackQuery.data; 
        queryId = callbackQuery.id; 
        console.log(`|🔘| Botón presionado con callback_data: [${text}] del chat [${chatId}]`); 

        // Responder al callback_query para quitar el reloj de carga en Telegram 
        try { 
            await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, { 
                callback_query_id: queryId 
            }); 
        } catch (error) { 
            console.error('|❌| Error al responder callbackQuery:', error.message); 
        } 
    } else { 
        return res.sendStatus(200); 
    } 

    // --- Procesamiento de Lógica (incluyendo callbacks) --- 
     
    // Si el callback es para responder una pregunta (ej: 'answer_12345') 
    if (text.startsWith('answer_')) { 
        const questionId = text.replace('answer_', ''); 
         
        userContexts[chatId] = { 
            mode: 'answering', 
            questionId: questionId, 
        }; 

        await sendTelegramMessage(chatId, `\\|✍️\\| Entendido\\. Respondiendo a la pregunta \`${escapeMarkdown(questionId)}\`\\.\\\nAhora, escribí tu respuesta y enviala\\.`); 
        return res.sendStatus(200); 
    } 
     
    // --- Lógica de Respuesta a Preguntas (contexto) --- 
    if (userContexts[chatId] && userContexts[chatId].mode === 'answering' && !text.startsWith('/')) { 
        try { 
            await answerQuestion(userContexts[chatId].questionId, text); 
            await sendTelegramMessage(chatId, `\\|✅\\| Tu respuesta ha sido enviada a Mercado Libre\\.`); 
            // Limpiar contexto 
            delete userContexts[chatId]; 
        } catch (error) { 
            await sendTelegramMessage(chatId, `\\|❌\\| Error al enviar la respuesta: ${escapeMarkdown(error.message)}\\.`); 
        } 
        return res.sendStatus(200); 
    } 

    // --- Manejo de Comandos --- 
     
    // Comandos públicos 
    if (text === '/start' || text === '/menu' || text === '/help') { 
        // Se agregó /setstock y /checkshipment al menú 
        const menu = `*\\|👋\\|*\\ Estos son los comandos disponibles:\\\n\\\n` + 
                     `*\\|/productinfo\\|* \\- Muestra informacion de tus productos\\.\\\n` + 
                     `*\\|/checksales\\|* \\- Revisa las últimas ventas concretadas\\.\\\n` + 
                     `*\\|/checkquestions\\|* \\- Muestra preguntas las preguntass pendientes\\.\\\n` + 
                     `*\\|/responder \\(ID\\)\\|* \\- Responde una pregunta específica por su ID\\.\\\n` + 
                     `*\\|/setstock \\(ID\\) \\(Cantidad\\)\\|* \\- Actualiza el stock de un producto\\.\\\n` + 
                     `*\\|/checkshipment \\(ID\\)\\|* \\- Muestra el estado de un envío\\.\\\n` + 
                     `*\\|/status\\|* \\- Verifica el estado de CosmeticaSPA\\-BOT\\.`; 
        await sendTelegramMessage(chatId, menu); 
        return res.sendStatus(200); 
    } 
     
    if (text === '/status') { 
        await sendTelegramMessage(chatId, '\\|✅\\| CosmeticaSPA\\-BOT está activo y funcionando correctamente\\.'); 
        return res.sendStatus(200); 
    } 

    // Comandos privados (requieren token) 
    try { 
        const tokens = await ensureAccessToken(); 
        if (!tokens) { 
            await sendTelegramMessage(chatId, '\\|⚠️\\| *Error de autenticación*\\.\\\nNecesitás vincular tu cuenta de Mercado Libre primero\\. Visitá la página principal de tu bot para hacerlo\\.'); 
            return res.sendStatus(200); 
        } 

        const authHeaders = { 'Authorization': `Bearer ${tokens.access_token}` }; 

        // --- Comando /productinfo (FORMATO CORREGIDO) --- 
        if (text === '/productinfo') { 
            const itemsResponse = await axios.get(`https://api.mercadolibre.com/users/${tokens.user_id}/items/search`, { 
                headers: authHeaders, 
                params: { status: 'active' } 
            }); 

            const itemIds = itemsResponse.data.results; 
            if (itemIds.length === 0) { 
                await sendTelegramMessage(chatId, '\\|📦\\| No tenés publicaciones activas en este momento\\.'); 
                return res.sendStatus(200); 
            } 

            const detailsResponse = await axios.get(`https://api.mercadolibre.com/items`, { 
                headers: authHeaders, 
                params: { ids: itemIds.join(','), attributes: 'id,title,price,currency_id,available_quantity,sold_quantity,permalink' } 
            }); 

            let reply = `\\|📦\\| Información de tus ${detailsResponse.data.length} productos más recientes:\n\n`; 
             
            detailsResponse.data.forEach((item, index) => { 
                const body = item.body; 
                const productIndex = index + 1; 

                // **Formato de Precio Automático**                const formattedPrice = new Intl.NumberFormat('es-AR', { style: 'currency', currency: body.currency_id }).format(body.price); 

                // Se agrega \\. para escapar el punto después del número de lista 
                reply += `${productIndex}\\. ${escapeMarkdown(body.title)}\n`; 
                reply += `\\|ID\\|: ${escapeMarkdown(body.id)}\n`; 
                reply += `\\|Precio\\|: ${escapeMarkdown(formattedPrice)}\n`; // Usamos el precio formateado 
                reply += `\\|Stock\\|: ${escapeMarkdown(body.available_quantity)}\n`; 
                reply += `\\|Ventas\\|: ${escapeMarkdown(body.sold_quantity)}\n`; 

                // **Enlace Clicable:** Usamos la sintaxis de Markdown V2 [Texto](URL) sin escapar los corchetes, 
                // asegurándonos de que sea un enlace válido y clicable. 
                reply += `[Ver Producto](${escapeMarkdown(body.permalink)})\n\n`; 
            }); 
            await sendTelegramMessage(chatId, reply); 
        } 

        // --- Comando /checksales (FORMATO CORREGIDO) --- 
        else if (text === '/checksales') { 
            const ordersResponse = await axios.get('https://api.mercadolibre.com/orders/search', { 
                headers: authHeaders, 
                params: { seller: tokens.user_id, sort: 'date_desc', limit: 5 } 
            }); 
             
            const orders = ordersResponse.data.results; 
            if (orders.length === 0) { 
                await sendTelegramMessage(chatId, '\\|✅\\| No tenes ventas recientes\\.'); 
            } else { 
                let reply = `\\|🛒\\| Últimas 5 ventas:\n\n`; 

                orders.forEach(order => { 
                    // Formato de precio con formato de moneda 
                    const formattedPrice = new Intl.NumberFormat('es-AR', { style: 'currency', currency: order.currency_id }).format(order.total_amount); 

                    // Formato de fecha y hora: 05/07/2025 / 05:23:11 
                    const orderDate = new Date(order.date_created); 
                    const formattedDate = new Intl.DateTimeFormat('es-AR', { 
                        day: '2-digit', 
                        month: '2-digit', 
                        year: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        second: '2-digit', 
                        hour12: false 
                    }).format(orderDate).replace(/, /g, ' / '); 

                    // Se usan \n para los saltos de línea reales 
                    reply += `\\|ID\\|: ${escapeMarkdown(order.id)}\n`; 
                    reply += `\\|Total\\|: ${escapeMarkdown(formattedPrice)}\n`; 
                    reply += `\\|Comprador\\|: ${escapeMarkdown(order.buyer.nickname)}\n`; 
             _message        reply += `\\|Fecha\\|: ${escapeMarkdown(formattedDate)}\n`; 
                     
                    if (order.shipping && order.shipping.id) { 
                        reply += `\\|Envío\\|: ${escapeMarkdown(`/checkshipment ${order.shipping.id}`)}\n`; 
                    } 
                    reply += `\n`; 
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
                await sendTelegramMessage(chatId, '\\|✅\\| No tenés preguntas pendientes para responder\\.'); 
            } else { 
                let reply = '*\\|💬\\|* Preguntas sin responder:\\\n\\\n'; 
                questions.forEach(q => { 
                    reply += `*ID de Pregunta:* \`${escapeMarkdown(q.id)}\`\\\n`; 
                    reply += `*En el producto:* \`${escapeMarkdown(q.item_id)}\`\n`; 
                    reply += `   \\- _"${escapeMarkdown(q.text)}"_\n\n`; 
                    reply += `*Para responder:* \`/responder ${q.id}\`\n\n`; 
                }); 
                await sendTelegramMessage(chatId, reply); 
            } 
        } 

        // --- Comando /responder <ID> (inicia el modo de respuesta) --- 
        else if (text.startsWith('/responder')) { 
            const parts = text.split(' '); 
            const questionId = parts[1]; 

            if (!questionId) { 
                await sendTelegramMessage(chatId, '\\|⚠️\\| Usá el formato: `/responder \\(ID_Pregunta\\)`'); 
                return res.sendStatus(200); 
            } 

            // Establecer el contexto del usuario en "modo de respuesta" 
            userContexts[chatId] = { 
                mode: 'answering', 
                questionId: questionId, 
            }; 

            await sendTelegramMessage(chatId, `\\|✍️\\| Entendido\\. Respondiendo a la pregunta \`${escapeMarkdown(questionId)}\`\\.\\\nAhora, escribí tu respuesta y enviala\\.`); 
            return res.sendStatus(200); 
        } 

        // --- Comando /setstock <ID> <Cantidad> (NUEVA MEJORA) --- 
        else if (text.startsWith('/setstock')) { 
            const parts = text.split(' '); 
            const itemId = parts[1]; 
            const newQuantity = parts[2]; 

            if (!itemId || !newQuantity || isNaN(newQuantity)) { 
                await sendTelegramMessage(chatId, '\\|⚠️\\| Usá el formato correcto: `/setstock \\(ID_Producto\\) \\(Cantidad\\)`'); 
                return res.sendStatus(200); 
            } 

            try { 
                // Llama a la función de utilidad para actualizar el stock 
                const result = await updateItemStock(itemId, newQuantity); 
                await sendTelegramMessage(chatId, `\\|✅\\| Stock de producto \`${escapeMarkdown(result.id)}\` actualizado a *${escapeMarkdown(result.available_quantity)}*\\.`); 
            } catch (error) { 
                console.error('|❌| Error al actualizar stock:', error.response ? JSON.stringify(error.response.data) : error.message); 
                await sendTelegramMessage(chatId, `\\|❌\\| Error al actualizar stock\\. Verifica el ID y el formato\\.`); 
            } 
            return res.sendStatus(200); 
        } 

        // --- Comando /checkshipment <ID> (NUEVA MEJORA) --- 
        else if (text.startsWith('/checkshipment')) { 
            const parts = text.split(' '); 
            const shipmentId = parts[1]; 

            if (!shipmentId) { 
                await sendTelegramMessage(chatId, '\\|⚠️\\| Usá el formato: `/checkshipment \\(ID_Envío\\)`'); 
                return res.sendStatus(200); 
            } 

            try { 
                // Llama a la función de utilidad para obtener el estado del envío 
                const shipment = await getShipmentTracking(shipmentId); 

                let reply = `*\\|🚚\\| Estado del envío \`${escapeMarkdown(shipment.id)}\`*\n\n` + 
                           `*Estado:* ${escapeMarkdown(shipment.status)}\n` + 
                           `*Subestado:* ${escapeMarkdown(shipment.substatus || 'N/A')}\n` + 
                           `*Ubicación actual:* ${escapeMarkdown(shipment.tracking_number ? shipment.tracking_number.location : 'N/A')}\n\n`; 

                if (shipment.tracking_url) { 
                    reply += `*\\[[Seguimiento completo](${escapeMarkdown(shipment.tracking_url)})\\]*`; 
                } 

                await sendTelegramMessage(chatId, reply); 

            } catch (error) { 
                console.error('|❌| Error al obtener envío:', error.response ? JSON.stringify(error.response.data) : error.message); 
                await sendTelegramMessage(chatId, `\\|❌\\| Error al obtener el estado del envío\\. Verifica el ID\\.`); 
            } 
            return res.sendStatus(200); 
        } 

        else { 
            // Modificado: Escapando los '|' del emoji 
            await sendTelegramMessage(chatId, '\\|🤔\\| Comando no reconocido\\. Enviá /menu para ver la lista de comandos\\.'); 
        } 

    } catch (error) { 
        console.error('|❌| Error procesando comando:', error.response ? JSON.stringify(error.response.data) : error.message); 
        await sendTelegramMessage(chatId, '\\|❌\\| Hubo un error al procesar tu solicitud\\. Por favor, revisá los logs del servidor\\.'); 
    } 
     
    res.sendStatus(200); 
}); 

// --- Ruta de Health Check para mantener el bot activo ---
app.get('/health', (req, res) => {
  console.log('|❤️| Ping de Health Check recibido para mantener el servicio activo.');
  res.status(200).send('OK');
});

// --- INICIAR SERVIDOR --- 
app.listen(PORT, () => { 
    console.log(`|🚀| Servidor funcionando en http://localhost:${PORT}`); 
});
