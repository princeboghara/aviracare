const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

module.exports = {
    genAI,
    getModel: (modelName) => genAI.getGenerativeModel({ model: modelName || process.env.GEMINI_MODEL || "gemini-2.5-flash" })
};
