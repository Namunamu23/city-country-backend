// routes/auth.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// "Guest" or "Simple" sign-up: just needs a username, no password/email required
router.post('/guest', async (req, res) => {
  try {
    const { name } = req.body;

    // Insert the new player row into `players` table
    // Assuming "players" has an auto-increment primary key "id",
    // and columns: name (VARCHAR), email (maybe null), total_score (default 0).
    const insertQuery = `
      INSERT INTO players (name, total_score)
      VALUES ($1, 0)
      RETURNING id, name
    `;
    const newPlayer = await pool.query(insertQuery, [name]);
    
    // Return the newly created player's id and name
    const player = newPlayer.rows[0];
    return res.json({ playerId: player.id, name: player.name });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error creating guest.' });
  }
});

// OPTIONAL: Another route if you want a "real" login with email
// e.g. if you're storing email/password in "players" table
// router.post('/login', async (req, res) => { ... });

module.exports = router;
