//backend/db.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://city_country_game_db_user:opL1uYCzjHoZFWahjBa8dm01Shfq0N2h@dpg-cu2196lsvqrc73f1d6f0-a.frankfurt-postgres.render.com/city_country_game_db',
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
