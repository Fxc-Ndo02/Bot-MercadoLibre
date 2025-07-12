// utils/telegram.js

const axios = require('axios');

// Función de utilidad para escapar caracteres especiales de MarkdownV2
const escapeMarkdown = (text) => {
    if (typeof text !== 'string') {
        text = String(text);
    }
    // Escapa los caracteres reservados en MarkdownV2
    return text.replace(/([_*\[\]\(\)~`>#\+\-=\|\{\}\.!])/g, '\\$1');
};

// Función para enviar mensajes a Telegram con MarkdownV2 y opciones (incluidos botones)
const sendTelegramMessage = async (chatId, text, options = {}) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.error('|❌| TELEGRAM_BOT_TOKEN no está configurado en .env');
        return;
    }

    const telegramApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'MarkdownV2',
        // Esto permite pasar reply_markup para botones
        ...options 
    };

    try {
        await axios.post(telegramApi, payload);
        console.log('|☑️| Mensaje de Telegram enviado con éxito.');
    } catch (error) {
        console.error('|❌| Error al enviar mensaje a Telegram:', error.response ? JSON.stringify(error.response.data) : error.message);
        console.error('   |⚠️| Error de formato Markdown. Verifica los caracteres escapados.');
    }
};

module.exports = {
    escapeMarkdown,
    sendTelegramMessage,
};
