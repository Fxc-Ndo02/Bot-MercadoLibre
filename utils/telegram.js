const axios = require('axios');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Función para escapar texto para Markdown V2 de Telegram.
function escapeMarkdown(text) {
    if (text === null || typeof text === 'undefined') {
        return '';
    }
    // Escapa todos los caracteres reservados en MarkdownV2.
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
            parse_mode: 'MarkdownV2',
        });
        console.log('|☑️| Mensaje de Telegram enviado con éxito.');
    } catch (error) {
        console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? JSON.stringify(error.response.data) : error.message);
        // Si el error es un problema de Markdown, lo registramos.
        if (error.response && error.response.data && error.response.data.description.includes("Bad Request: can't parse entities")) {
            console.error('   |⚠️| Error de formato Markdown. Verifica los caracteres escapados.');
        }
    }
}

module.exports = {
    escapeMarkdown,
    sendTelegramMessage,
};
