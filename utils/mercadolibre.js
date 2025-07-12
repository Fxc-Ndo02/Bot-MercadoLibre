// utils/mercadolibre.js

const axios = require('axios');
const fs = require('fs');

const TOKEN_FILE = 'tokens.json';

// Cargar y asegurar tokens, refrescándolos si es necesario
const ensureAccessToken = async () => {
    try {
        let tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));

        // Si el token expiró, intentar refrescarlo
        if (tokens.expires_at < Date.now()) {
            console.log('|🔄| Refrescando token de Mercado Libre...');
            const response = await axios.post('https://api.mercadolibre.com/oauth/token', new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                refresh_token: tokens.refresh_token,
            }));

            const newTokens = response.data;
            newTokens.expires_at = Date.now() + (newTokens.expires_in * 1000);
            newTokens.user_id = tokens.user_id; // Mantener el user_id original

            fs.writeFileSync(TOKEN_FILE, JSON.stringify(newTokens, null, 2));
            return newTokens;
        }

        return tokens;
    } catch (error) {
        console.error('|❌| Error al asegurar el token:', error.message);
        return null;
    }
};

// Función para responder a una pregunta de Mercado Libre
const answerQuestion = async (questionId, answerText) => {
    const tokens = await ensureAccessToken();
    if (!tokens) {
        throw new Error('No se pudo autenticar con Mercado Libre.');
    }

    const payload = {
        question_id: questionId,
        text: answerText,
    };

    const config = {
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
        },
    };

    // La API de respuestas a preguntas de ML usa POST
    const response = await axios.post('https://api.mercadolibre.com/answers', payload, config);
    return response.data;
};

// --- NUEVA FUNCIÓN: Actualizar Stock de un ítem ---
const updateItemStock = async (itemId, newQuantity) => {
    const tokens = await ensureAccessToken();
    if (!tokens) {
        throw new Error('No se pudo autenticar con Mercado Libre.');
    }

    // La API de actualización de ítems requiere el ID del ítem
    const apiUrl = `https://api.mercadolibre.com/items/${itemId}`;
    
    const payload = {
        available_quantity: parseInt(newQuantity)
    };

    const config = {
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
        },
    };

    // Usamos PUT para actualizar el stock
    const response = await axios.put(apiUrl, payload, config);
    return response.data;
};

// --- NUEVA FUNCIÓN: Obtener información de envío ---
const getShipmentTracking = async (shipmentId) => {
    const tokens = await ensureAccessToken();
    if (!tokens) {
        throw new Error('No se pudo autenticar con Mercado Libre.');
    }

    const apiUrl = `https://api.mercadolibre.com/shipments/${shipmentId}`;
    
    const config = {
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
        },
    };

    const response = await axios.get(apiUrl, config);
    return response.data;
};


module.exports = {
    ensureAccessToken,
    answerQuestion,
    updateItemStock,
    getShipmentTracking,
};
