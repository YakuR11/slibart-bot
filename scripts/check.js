// Verifie que toutes les commandes se chargent et que les slash commands sont valides,
// sans se connecter a Discord. Usage : npm run check
process.env.DISCORD_TOKEN ||= 'check';
const handler = require('../src/lib/handler');
handler.load();
const body = handler.buildSlash();
console.log(`OK : ${handler.commands.size} commandes, ${body.length} slash commands valides.`);
for (const c of handler.commands.values()) {
    console.log(`  ${c.owner ? '🔒' : '  '} ${c.name.padEnd(12)} ${c.aliases.length ? `(${c.aliases.join(', ')})` : ''}`);
}
