const mysql = require('mysql2/promise');
const config = require('./config');
const log = require('./lib/logger');

const pool = mysql.createPool({
    ...config.db,
    waitForConnections: true,
    connectionLimit: 10,
    supportBigNumbers: true, // les IDs Discord depassent la precision des nombres JS
    charset: 'utf8mb4', // emojis dans les bios
});

/** SELECT -> tableau de lignes */
async function q(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

/** UPDATE/INSERT/DELETE -> { affectedRows, insertId } */
async function exec(sql, params = [], conn = pool) {
    const [res] = await conn.query(sql, params);
    return res;
}

/**
 * Transaction : fn(conn) ; commit si ok, rollback si erreur.
 * Rejouee automatiquement en cas de deadlock (spam de commandes en parallele).
 */
async function tx(fn, attempts = 5) {
    for (let i = 1; ; i++) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const out = await fn(conn);
            await conn.commit();
            return out;
        } catch (e) {
            await conn.rollback().catch(() => {});
            const retry = (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') && i < attempts;
            if (!retry) throw e;
            await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * i));
        } finally {
            conn.release();
        }
    }
}

// ---------------------------------------------------------------------------
// Migrations : cree les tables si besoin et ajoute les colonnes manquantes
// sans toucher aux donnees existantes (compatible avec l'ancienne base "slip").
// ---------------------------------------------------------------------------

const COUNTERS = [
    'rb', 'wacount', 'insultcount', 'slavecount', 'cavecount', 'pertecount',
    'wincount', 'gamblecount', 'minecount', 'daily_last', 'daily_streak',
    'xp', 'level', 'remind', 'duelwins', 'maxwin', 'winstreak', 'bestwinstreak', 'last_seen', 'debt',
];

const PROFILE_EXTRA = {
    img: 'TEXT NULL',
    bio: 'TEXT NULL',
    acc: 'VARCHAR(100) NULL',
};

async function columns(table) {
    const rows = await q(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table],
    );
    return Object.fromEntries(rows.map((r) => [r.COLUMN_NAME, r]));
}

async function hasUniqueOn(table, column) {
    const rows = await q(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND NON_UNIQUE = 0 LIMIT 1`,
        [table, column],
    );
    return rows.length > 0;
}

async function ensureUnique(table, column) {
    if (await hasUniqueOn(table, column)) return;
    const dup = await q(`SELECT ${column} FROM ${table} GROUP BY ${column} HAVING COUNT(*) > 1 LIMIT 1`);
    if (dup.length) {
        log.warn(`[db] ${table}.${column} contient des doublons, index unique non ajoute (le bot marche quand meme).`);
        return;
    }
    await exec(`ALTER TABLE ${table} ADD UNIQUE INDEX uniq_${column} (${column})`);
    log.info(`[db] index unique ajoute sur ${table}.${column}`);
}

async function migrate() {
    await exec(`CREATE TABLE IF NOT EXISTS profile (
        id_user VARCHAR(32) NOT NULL PRIMARY KEY
    ) CHARACTER SET utf8mb4`);

    let cols = await columns('profile');
    for (const [name, def] of Object.entries(PROFILE_EXTRA)) {
        if (!cols[name]) await exec(`ALTER TABLE profile ADD COLUMN ${name} ${def}`);
    }
    for (const name of COUNTERS) {
        const c = cols[name];
        if (!c) {
            await exec(`ALTER TABLE profile ADD COLUMN ${name} BIGINT NOT NULL DEFAULT 0`);
        } else if (c.DATA_TYPE !== 'bigint' || c.IS_NULLABLE === 'YES' || c.COLUMN_DEFAULT === null) {
            // anciennes colonnes INT nullable -> BIGINT NOT NULL DEFAULT 0 (plus de NULL qui casse les calculs)
            await exec(`UPDATE profile SET ${name} = 0 WHERE ${name} IS NULL`);
            await exec(`ALTER TABLE profile MODIFY ${name} BIGINT NOT NULL DEFAULT 0`);
        }
    }
    await ensureUnique('profile', 'id_user');

    await exec(`CREATE TABLE IF NOT EXISTS motfav (
        id_user VARCHAR(32) NOT NULL PRIMARY KEY,
        mot VARCHAR(255) NULL
    ) CHARACTER SET utf8mb4`);

    await exec(`CREATE TABLE IF NOT EXISTS champions (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        title VARCHAR(255) NULL,
        lore TEXT NULL,
        tags VARCHAR(255) NULL,
        img TEXT NULL,
        belong VARCHAR(32) NULL
    ) CHARACTER SET utf8mb4`);
    cols = await columns('champions');
    if (!cols.ddid) await exec(`ALTER TABLE champions ADD COLUMN ddid VARCHAR(64) NULL`);

    await exec(`CREATE TABLE IF NOT EXISTS cooldowns (
        id_user VARCHAR(32) NOT NULL,
        name VARCHAR(32) NOT NULL,
        expires_at BIGINT NOT NULL DEFAULT 0,
        uses INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id_user, name)
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS quests (
        id_user VARCHAR(32) NOT NULL,
        day CHAR(10) NOT NULL,
        qtype VARCHAR(32) NOT NULL,
        target INT NOT NULL,
        progress INT NOT NULL DEFAULT 0,
        reward INT NOT NULL DEFAULT 0,
        done TINYINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id_user, day, qtype)
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS achievements (
        id_user VARCHAR(32) NOT NULL,
        ach VARCHAR(32) NOT NULL,
        at BIGINT NOT NULL,
        PRIMARY KEY (id_user, ach)
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS lottery (
        round_id INT NOT NULL,
        id_user VARCHAR(32) NOT NULL,
        tickets INT NOT NULL DEFAULT 0,
        PRIMARY KEY (round_id, id_user)
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS inventory (
        id_user VARCHAR(32) NOT NULL,
        item VARCHAR(32) NOT NULL,
        qty INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id_user, item)
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS weekly (
        week CHAR(10) NOT NULL,
        id_user VARCHAR(32) NOT NULL,
        net BIGINT NOT NULL DEFAULT 0,
        games INT NOT NULL DEFAULT 0,
        PRIMARY KEY (week, id_user)
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(64) NOT NULL PRIMARY KEY,
        v TEXT NULL
    ) CHARACTER SET utf8mb4`);

    await exec(`CREATE TABLE IF NOT EXISTS sport_matches (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        source VARCHAR(8) NOT NULL,
        ext_id VARCHAR(40) NOT NULL,
        competition VARCHAR(80) NOT NULL,
        home VARCHAR(80) NOT NULL,
        away VARCHAR(80) NOT NULL,
        start_at BIGINT NOT NULL,
        status VARCHAR(16) NOT NULL,
        home_score INT NULL,
        away_score INT NULL,
        odd_home DECIMAL(8,2) NULL,
        odd_draw DECIMAL(8,2) NULL,
        odd_away DECIMAL(8,2) NULL,
        detail VARCHAR(120) NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY uniq_src_ext (source, ext_id),
        KEY idx_list (status, start_at)
    ) CHARACTER SET utf8mb4`);

    await exec(`CREATE TABLE IF NOT EXISTS sport_bets (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        id_user VARCHAR(32) NOT NULL,
        match_id INT NOT NULL,
        pick VARCHAR(8) NOT NULL,
        stake BIGINT NOT NULL,
        odds DECIMAL(8,2) NOT NULL,
        status VARCHAR(16) NOT NULL,
        payout BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uniq_user_match (id_user, match_id),
        KEY idx_open (status, match_id)
    )`);

    // compte "banque du slip" (le casino) : recoit les pertes
    await ensureProfile(config.casinoId);
    log.info('[db] schema a jour');
}

/** Cree le profil s'il n'existe pas (marche meme sans index unique sur une vieille base) */
async function ensureProfile(userId, conn = pool) {
    await conn.query(
        `INSERT INTO profile (id_user)
         SELECT ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM profile WHERE id_user = ?)`,
        [String(userId), String(userId)],
    );
}

async function getProfile(userId) {
    await ensureProfile(userId);
    const rows = await q('SELECT * FROM profile WHERE id_user = ? LIMIT 1', [String(userId)]);
    const p = rows[0];
    for (const c of COUNTERS) p[c] = Number(p[c] || 0);
    p.id_user = String(p.id_user);
    return p;
}

async function getSetting(k, fallback = null) {
    const rows = await q('SELECT v FROM settings WHERE k = ?', [k]);
    return rows.length ? rows[0].v : fallback;
}

async function setSetting(k, v) {
    await exec('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, v === null ? null : String(v)]);
}

async function close() {
    await pool.end().catch(() => {});
}

module.exports = { pool, q, exec, tx, migrate, ensureProfile, getProfile, getSetting, setSetting, close, COUNTERS };
