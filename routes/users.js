const express = require('express');
const { getUsers, getMessages } = require('../controllers/userController');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getUsers);
router.get('/messages/:userId', auth, getMessages);

module.exports = router;