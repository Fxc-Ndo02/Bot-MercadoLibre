// Almacén simple en memoria para el estado de la conversación (chatId -> { mode: 'answering', questionId: '...' })
const userContexts = {};

module.exports = {
    userContexts,
};
