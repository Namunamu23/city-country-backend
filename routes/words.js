//backend/routes/words.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// Validate if a word exists in the database
router.get('/validate/:word/:category', async (req, res) => {
  const { word, category } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM words WHERE word = $1 AND category = $2',
      [word.toLowerCase(), category.toLowerCase()]
    );

    if (result.rows.length > 0) {
      res.json({ valid: true, word: word });
    } else {
      res.json({ valid: false, word: word });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

module.exports = router;
