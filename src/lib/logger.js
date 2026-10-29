const ts = () => new Date().toLocaleString('fr-FR', { hour12: false });

module.exports = {
    info: (...a) => console.log(`[${ts()}]`, ...a),
    warn: (...a) => console.warn(`[${ts()}] ⚠️`, ...a),
    error: (...a) => console.error(`[${ts()}] ❌`, ...a),
};
