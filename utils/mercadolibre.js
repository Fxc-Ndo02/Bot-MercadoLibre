const fs = require('fs');
const axios = require('axios');

const TOKEN_FILE = 'tokens.json';

// Lógica de token de Mercado Libre
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
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
        console.log('|💾| Token refrescado y guardado.');
        return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch (error) {
        console.error('|❌| Error al refrescar el token:', error.message);
        throw new Error('No se pudo refrescar el token.');
    }
}

async function ensureAccessToken() {
    if (!fs.existsSync(TOKEN_FILE)) {
        console.log('|⚠️| No existe tokens.json. Se requiere autenticación.');
        return null;
    }
    const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    // Refresca si expira en menos de 1 minuto
    if (Date.now() >= tokens.expires_at - 60000) { 
        return await refreshAccessToken(tokens.refresh_token);
    }
    return tokens;
}

// Función para responder una pregunta de Mercado Libre
async function answerQuestion(questionId, answerText) {
    const tokens = await ensureAccessToken();
    if (!tokens) {
        throw new Error('No hay token de Mercado Libre disponible.');
    }

    try {
        await axios.post(`https://api.mercadolibre.com/answers`, 
            {
                question_id: questionId,
                text: answerText
            },
            {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` }
            }
        );
        console.log(`|✅| Pregunta ${questionId} respondida.`);
    } catch (error) {
        console.error(`|❌| Error al responder pregunta ${questionId}:`, error.response ? error.response.data : error.message);
        throw new Error('Error al enviar la respuesta a ML.');
    }
}

module.exports = {
    ensureAccessToken,
    answerQuestion,
};
