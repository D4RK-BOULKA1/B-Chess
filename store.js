// store.js — stockage PostgreSQL pour B-Chess
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL manquante. Ajoute ta connexion PostgreSQL dans les variables d’environnement.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
});

const db = { users: {} };

function key(username) {
  return String(username).toLowerCase();
}

function rowToUser(r) {
  return {
    username: r.username,
    passwordHash: r.password_hash,
    eloBlitz: r.elo_blitz,
    eloNormal: r.elo_normal,
    country: r.country,
    avatar: r.avatar,
    friends: Array.isArray(r.friends) ? r.friends : [],
    createdAt: new Date(r.created_at).getTime(),
    stats: {
      wins: r.wins || 0,
      losses: r.losses || 0,
      draws: r.draws || 0
    }
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    eloBlitz: u.eloBlitz,
    eloNormal: u.eloNormal,
    country: u.country,
    avatar: u.avatar,
    stats: u.stats
  };
}

async function persistUser(u) {
  await pool.query(`
    UPDATE users SET
      username=$1,
      password_hash=$2,
      elo_blitz=$3,
      elo_normal=$4,
      country=$5,
      avatar=$6,
      friends=$7,
      wins=$8,
      losses=$9,
      draws=$10
    WHERE LOWER(username)=LOWER($1)
  `, [
    u.username, u.passwordHash, u.eloBlitz, u.eloNormal, u.country, u.avatar,
    u.friends, u.stats.wins, u.stats.losses, u.stats.draws
  ]);
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(18) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      elo_blitz INTEGER NOT NULL DEFAULT 200,
      elo_normal INTEGER NOT NULL DEFAULT 200,
      country CHAR(2),
      avatar TEXT,
      friends TEXT[] NOT NULL DEFAULT '{}',
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  for (const r of rows) db.users[key(r.username)] = rowToUser(r);
  console.log(`PostgreSQL connecté — ${rows.length} utilisateur(s) chargé(s).`);
}

function getUser(username) {
  return db.users[key(username)] || null;
}

function createUser(username, passwordHash) {
  const k = key(username);
  if (db.users[k]) throw new Error('Ce pseudo est déjà pris');

  const user = {
    username,
    passwordHash,
    eloBlitz: 200,
    eloNormal: 200,
    country: null,
    avatar: null,
    friends: [],
    createdAt: Date.now(),
    stats: { wins: 0, losses: 0, draws: 0 }
  };

  db.users[k] = user;

  pool.query(`
    INSERT INTO users
      (username,password_hash,elo_blitz,elo_normal,country,avatar,friends,wins,losses,draws)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [
    user.username, user.passwordHash, user.eloBlitz, user.eloNormal,
    user.country, user.avatar, user.friends,
    user.stats.wins, user.stats.losses, user.stats.draws
  ]).catch(err => console.error('Erreur PostgreSQL création utilisateur:', err.message));

  return user;
}

function updateUser(username, fields) {
  const user = getUser(username);
  if (!user) return null;
  Object.assign(user, fields);
  persistUser(user).catch(err => console.error('Erreur PostgreSQL update:', err.message));
  return user;
}

function renameUser(username, newUsername) {
  const oldKey = key(username);
  const newKey = key(newUsername);
  const user = db.users[oldKey];

  if (!user) throw new Error('Utilisateur introuvable');
  if (db.users[newKey]) throw new Error('Ce pseudo est déjà pris');

  delete db.users[oldKey];
  user.username = String(newUsername);
  db.users[newKey] = user;

  Object.values(db.users).forEach(u => {
    u.friends = u.friends.map(f => key(f) === oldKey ? user.username : f);
  });

  // Les changements sont ensuite écrits dans PostgreSQL depuis le cache mémoire.
  Object.values(db.users).forEach(u =>
    persistUser(u).catch(err => console.error('Erreur PostgreSQL renommage:', err.message))
  );
  return user;
}

function listUsers() {
  return Object.values(db.users).map(publicUser);
}

function addFriend(username, friendUsername) {
  const user = getUser(username);
  const friend = getUser(friendUsername);

  if (!user || !friend) throw new Error('Utilisateur introuvable');
  if (key(username) === key(friendUsername)) throw new Error('Impossible de s’ajouter soi-même');

  if (!user.friends.some(f => key(f) === key(friend.username))) user.friends.push(friend.username);
  if (!friend.friends.some(f => key(f) === key(user.username))) friend.friends.push(user.username);

  persistUser(user).catch(err => console.error('Erreur PostgreSQL amis:', err.message));
  persistUser(friend).catch(err => console.error('Erreur PostgreSQL amis:', err.message));

  return user.friends;
}

function applyEloChange(username, mode, delta, resultType) {
  const user = getUser(username);
  if (!user) return null;

  const field = mode === 'blitz' ? 'eloBlitz' : 'eloNormal';
  user[field] = Math.max(0, user[field] + delta);

  if (resultType === 'win') user.stats.wins++;
  else if (resultType === 'loss') user.stats.losses++;
  else if (resultType === 'draw') user.stats.draws++;

  persistUser(user).catch(err => console.error('Erreur PostgreSQL résultat:', err.message));
  return user[field];
}

async function close() {
  await pool.end();
}

module.exports = {
  init, close, getUser, createUser, updateUser, renameUser,
  listUsers, publicUser, addFriend, applyEloChange
};
