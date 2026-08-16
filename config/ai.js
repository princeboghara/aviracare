const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🔑 Multi-Key Rotation Pool
function getApiKeys() {
    const rawKeys = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS || '';
    return rawKeys
        .split(/[,;\n]+/)
        .map(k => k.trim())
        .filter(k => k.length > 0);
}

let keyRotationIndex = 0;

function getNextGenAIInstance() {
    const keys = getApiKeys();
    if (keys.length === 0) {
        return new GoogleGenerativeAI('');
    }
    const selectedKey = keys[keyRotationIndex % keys.length];
    keyRotationIndex = (keyRotationIndex + 1) % keys.length;
    return new GoogleGenerativeAI(selectedKey);
}

// 🤖 Optimized Model Cascade Priority List (High Quota & High Speed)
const DEFAULT_MODEL_CASCADE = [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3.7-flash',
    'gemini-2.5-flash'
];

function getModelCascade() {
    const envModel = (process.env.GEMINI_MODEL || '').trim();
    const list = [...DEFAULT_MODEL_CASCADE];
    if (envModel && envModel !== 'gemini-3.6-flash' && !list.includes(envModel)) {
        list.unshift(envModel);
    } else if (envModel === 'gemini-3.5-flash') {
        // already top priority
    }
    return list;
}

/**
 * 📦 Robust AI Parcel Label Scanner with Multi-Key & Multi-Model Cascade
 */
async function scanParcelLabel(imageBuffer, mimeType = 'image/jpeg') {
    const keys = getApiKeys();
    if (keys.length === 0) {
        throw new Error('GEMINI_API_KEY is not configured in .env');
    }

    const imagePart = {
        inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: mimeType || 'image/jpeg'
        }
    };

    const prompt = `Analyze this shipping parcel label sticker carefully and extract details into strict JSON format with these exact keys:
{
    "tracking": "Tracking/Barcode number (e.g. CG135962112IN)",
    "name": "Exact Full Name directly under DELIVER TO (include full bold name across lines if present, but DO NOT include address lines, city, state, or dates)",
    "mobile": "10-digit mobile number explicitly written next to Mob: (ignore any seller Ph: numbers)",
    "pincode": "6-digit delivery pincode (e.g., 400074)"
}
Return ONLY valid JSON.`;

    const models = getModelCascade();
    let lastError = null;

    // Try keys & models systematically
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
        const apiKey = keys[(keyRotationIndex + keyIdx) % keys.length];
        const genAI = new GoogleGenerativeAI(apiKey);

        for (const modelName of models) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: { 
                        responseMimeType: 'application/json',
                        temperature: 0.1
                    }
                });

                const result = await model.generateContent([prompt, imagePart]);
                if (result && result.response) {
                    const responseText = result.response.text().trim();
                    let parsedData = null;

                    try {
                        parsedData = JSON.parse(responseText);
                    } catch (parseErr) {
                        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            parsedData = JSON.parse(jsonMatch[0]);
                        }
                    }

                    if (parsedData) {
                        return {
                            success: true,
                            data: {
                                tracking: (parsedData.tracking || '').trim(),
                                name: (parsedData.name || '').trim(),
                                mobile: (parsedData.mobile || '').replace(/[^0-9]/g, '').slice(-10),
                                pincode: (parsedData.pincode || '').replace(/[^0-9]/g, '').slice(0, 6)
                            },
                            modelUsed: modelName
                        };
                    }
                }
            } catch (err) {
                lastError = err;
                const errMsg = err.message || '';
                const isRateLimit = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');
                const isOverloaded = errMsg.includes('503') || errMsg.includes('demand');
                const isNotFound = errMsg.includes('404');

                console.warn(`⚠️ Model [${modelName}] failed (Key: ...${apiKey.slice(-4)}): ${errMsg.slice(0, 100)}`);

                if (isRateLimit) {
                    // Try next model or next key immediately
                    continue;
                } else if (isOverloaded) {
                    // Small delay then next model
                    await new Promise(r => setTimeout(r, 600));
                    continue;
                } else if (isNotFound) {
                    continue;
                }
            }
        }
    }

    throw lastError || new Error('All Gemini models and keys exhausted. Please check quota or try again in a few seconds.');
}

module.exports = {
    getApiKeys,
    getModelCascade,
    getNextGenAIInstance,
    getModel: (modelName, options = {}) => {
        const genAI = getNextGenAIInstance();
        return genAI.getGenerativeModel({
            model: modelName || process.env.GEMINI_MODEL || 'gemini-3.5-flash',
            ...options
        });
    },
    scanParcelLabel
};

